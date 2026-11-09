/**
 * Database tables. Change this file, then run `npm run db:generate` to write a
 * new migration in src/db/migrations.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { STEP_STATUSES } from "@/domain/status";
import { CHECKLIST_SOURCES, CHECKLIST_STATES, ROLES, STEP_KINDS } from "@/domain/workflow/types";

export const stepStatus = pgEnum("step_status", STEP_STATUSES);
export const role = pgEnum("role", ROLES);
export const stepKind = pgEnum("step_kind", STEP_KINDS);
export const checklistState = pgEnum("checklist_state", CHECKLIST_STATES);
export const checklistSource = pgEnum("checklist_source", CHECKLIST_SOURCES);
export const notifyChannel = pgEnum("notify_channel", ["sms", "email", "both", "none"]);
export const notificationStatus = pgEnum("notification_status", ["pending", "sent", "failed", "skipped"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const day = (name: string) => date(name, { mode: "string" });

/** One row of settings for the whole app (the sheet's Setup tab settings). */
export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    timezone: text("timezone").notNull().default("America/Vancouver"),
    dueSoonDays: integer("due_soon_days").notNull().default(3),
    /** New turnovers get a target ready date this many days after move-out. */
    defaultTargetDays: integer("default_target_days").default(10),
    /** No texts between these local times; they wait until morning. */
    quietHoursStart: text("quiet_hours_start").notNull().default("20:00"),
    quietHoursEnd: text("quiet_hours_end").notNull().default("07:00"),
    digestTime: text("digest_time").notNull().default("07:00"),
    updatedAt: updatedAt(),
  },
  (t) => [check("app_settings_single_row", sql`${t.id} = 1`)],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    address: text("address"),
    /** Lockbox, keys, parking: shown only to whoever has the active task. */
    accessNotes: text("access_notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("properties_name_unique").on(sql`lower(${t.name})`)],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"),
    /** E.164, e.g. +16045550123. */
    phone: text("phone"),
    roles: role("roles").array().notNull().default(sql`'{}'`),
    /** For outside companies (cleaning, photography). */
    company: text("company"),
    notifyChannel: notifyChannel("notify_channel").notNull().default("sms"),
    /** Seeded stand-in, to be renamed in Settings. */
    isPlaceholder: boolean("is_placeholder").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("people_email_unique").on(sql`lower(${t.email})`).where(sql`${t.email} is not null`),
    uniqueIndex("people_phone_unique").on(t.phone).where(sql`${t.phone} is not null`),
  ],
);

export const workflowTemplates = pgTable("workflow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workflowTemplateSteps = pgTable(
  "workflow_template_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    parallelWithPrevious: boolean("parallel_with_previous").notNull().default(false),
    role: role("role").notNull(),
    kind: stepKind("kind").notNull().default("standard"),
    allowNa: boolean("allow_na").notNull().default(true),
    requireChecklist: boolean("require_checklist").notNull().default(false),
    dueDays: integer("due_days"),
    escalateAfterDays: integer("escalate_after_days"),
    checklist: jsonb("checklist").$type<string[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex("template_steps_key_unique").on(t.templateId, t.key),
    uniqueIndex("template_steps_position_unique").on(t.templateId, t.position),
  ],
);

/** Who does each step at each property by default ("default assignees per property and step"). */
export const propertyStepDefaults = pgTable(
  "property_step_defaults",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.stepKey] })],
);

export interface ImportSource {
  file: string;
  rowNumber: number;
  importedAt: string;
  /** The sheet's own calculated values at export time. */
  sheetComputed: { currentStage: string; daysVacant: number | null; daysInStage: number | null; flag: string };
}

/** One unit turn: a row of the Master Tracker. */
export const turnovers = pgTable(
  "turnovers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    unit: text("unit").notNull(),
    moveOutDate: day("move_out_date"),
    targetReadyDate: day("target_ready_date"),
    templateId: uuid("template_id").references(() => workflowTemplates.id, { onDelete: "set null" }),
    templateName: text("template_name").notNull(),
    /** The sheet's "Notes / blockers". */
    notes: text("notes"),
    completedAt: ts("completed_at"),
    archivedAt: ts("archived_at"),
    /** Goes up with every change; used to spot edits that crossed. */
    version: integer("version").notNull().default(1),
    createdById: uuid("created_by_id").references(() => people.id, { onDelete: "set null" }),
    importSource: jsonb("import_source").$type<ImportSource>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("turnovers_property_unit").on(t.propertyId, t.unit)],
);

/** A turnover's copy of each template step, with its live status. */
export const turnoverSteps = pgTable(
  "turnover_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnoverId: uuid("turnover_id")
      .notNull()
      .references(() => turnovers.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    parallelWithPrevious: boolean("parallel_with_previous").notNull().default(false),
    role: role("role").notNull(),
    kind: stepKind("kind").notNull().default("standard"),
    allowNa: boolean("allow_na").notNull().default(true),
    requireChecklist: boolean("require_checklist").notNull().default(false),
    dueDays: integer("due_days"),
    escalateAfterDays: integer("escalate_after_days"),
    status: stepStatus("status").notNull().default("not_started"),
    assigneeId: uuid("assignee_id").references(() => people.id, { onDelete: "set null" }),
    scheduledOn: day("scheduled_on"),
    scheduledTime: text("scheduled_time"),
    dueOn: day("due_on"),
    activatedAt: ts("activated_at"),
    activationCount: integer("activation_count").notNull().default(0),
    startedAt: ts("started_at"),
    completedOn: day("completed_on"),
    completedAt: ts("completed_at"),
    reopenedOn: day("reopened_on"),
    reopenedAt: ts("reopened_at"),
    blockedReason: text("blocked_reason"),
    blockedAt: ts("blocked_at"),
    blockedPrevStatus: stepStatus("blocked_prev_status"),
    reworkCount: integer("rework_count").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("turnover_steps_key_unique").on(t.turnoverId, t.key),
    index("turnover_steps_assignee").on(t.assigneeId, t.status),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stepId: uuid("step_id")
      .notNull()
      .references(() => turnoverSteps.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    state: checklistState("state").notNull().default("open"),
    source: checklistSource("source").notNull().default("manual"),
    sourceItemId: uuid("source_item_id"),
    position: integer("position").notNull(),
    doneById: uuid("done_by_id").references(() => people.id, { onDelete: "set null" }),
    doneAt: ts("done_at"),
    createdAt: createdAt(),
  },
  (t) => [index("checklist_items_step").on(t.stepId)],
);

/** The timeline / audit log. Rows are only ever added. */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    turnoverId: uuid("turnover_id")
      .notNull()
      .references(() => turnovers.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => turnoverSteps.id, { onDelete: "set null" }),
    /** null = the system (imports, scheduled jobs). */
    actorId: uuid("actor_id").references(() => people.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    fromStatus: stepStatus("from_status"),
    toStatus: stepStatus("to_status"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_turnover_at").on(t.turnoverId, t.at)],
);

/**
 * Outbox of messages to send. Rows are written in the same transaction as
 * the change that causes them; a sender delivers them (Phase 4).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    turnoverId: uuid("turnover_id").references(() => turnovers.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => turnoverSteps.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key"),
    status: notificationStatus("status").notNull().default("pending"),
    channel: text("channel"),
    sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_unique").on(t.dedupeKey),
    index("notifications_pending").on(t.status, t.sendAfter),
  ],
);

/** Manager passwords (argon2id). Assignees never have one; they sign in with links. */
export const credentials = pgTable("credentials", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => people.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  updatedAt: updatedAt(),
});

export const sessionKind = pgEnum("session_kind", ["password", "link"]);

/** Signed-in browsers. Only a hash of the cookie's token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: sessionKind("kind").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_person").on(t.personId)],
);

/** Commands already applied, so a double-tap on a slow connection applies once. */
export const processedRequests = pgTable("processed_requests", {
  requestId: text("request_id").primaryKey(),
  turnoverId: uuid("turnover_id").references(() => turnovers.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

// Relations, for loading a turnover with its steps in one query.
export const turnoversRelations = relations(turnovers, ({ one, many }) => ({
  property: one(properties, { fields: [turnovers.propertyId], references: [properties.id] }),
  steps: many(turnoverSteps),
  events: many(events),
}));

export const turnoverStepsRelations = relations(turnoverSteps, ({ one, many }) => ({
  turnover: one(turnovers, { fields: [turnoverSteps.turnoverId], references: [turnovers.id] }),
  assignee: one(people, { fields: [turnoverSteps.assigneeId], references: [people.id] }),
  checklist: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  step: one(turnoverSteps, { fields: [checklistItems.stepId], references: [turnoverSteps.id] }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  turnover: one(turnovers, { fields: [events.turnoverId], references: [turnovers.id] }),
  step: one(turnoverSteps, { fields: [events.stepId], references: [turnoverSteps.id] }),
  actor: one(people, { fields: [events.actorId], references: [people.id] }),
}));

export const workflowTemplatesRelations = relations(workflowTemplates, ({ many }) => ({
  steps: many(workflowTemplateSteps),
}));

export const workflowTemplateStepsRelations = relations(workflowTemplateSteps, ({ one }) => ({
  template: one(workflowTemplates, { fields: [workflowTemplateSteps.templateId], references: [workflowTemplates.id] }),
}));

export const propertiesRelations = relations(properties, ({ many }) => ({
  turnovers: many(turnovers),
  defaults: many(propertyStepDefaults),
}));
