/**
 * Demo data for clicking around: your 17 real units with their real statuses,
 * scope and notes, plus three made-up Oakwood units that show a block, an N/A
 * skip and a send-back. Dates and people are invented (placeholders you can
 * rename), and every change is played through the real workflow engine, so
 * each unit has a believable timeline.
 */
import { eq } from "drizzle-orm";
import { addDays, type DateOnly, dateInZone, formatShort } from "@/domain/dates";
import type { Actor, Role, StepState } from "@/domain/workflow/types";
import { splitScope } from "@/import/master-tracker";
import { setPassword } from "@/server/auth/sessions";
import { loadTurnover } from "@/server/turnover-store";
import { createTurnover, runCommand } from "@/server/workflow";
import type { DB } from "../client";
import { people, propertyStepDefaults } from "../schema";
import { getSettings } from "../settings";
import { seedBase } from "./base";

/** Demo sign-in for the local demo data only. Real managers are added with `npm run admin:create`. */
export const DEMO_LOGIN = { email: "manager@example.com", password: "turnover-demo" } as const;

export const DEMO_PEOPLE: Array<{ key: string; name: string; role: Role; phone: string; email: string; company?: string }> = [
  { key: "manager", name: "Manager", role: "admin", phone: "+16045550100", email: "manager@example.com" },
  { key: "inspector", name: "Inspector A", role: "inspector", phone: "+16045550101", email: "inspector@example.com" },
  { key: "crewA", name: "Crew A", role: "crew", phone: "+16045550102", email: "crew.a@example.com" },
  { key: "crewB", name: "Crew B", role: "crew", phone: "+16045550103", email: "crew.b@example.com" },
  { key: "crewC", name: "Crew C", role: "crew", phone: "+16045550104", email: "crew.c@example.com" },
  { key: "cleaner", name: "Cleaner A", role: "cleaner", phone: "+16045550105", email: "cleaner@example.com", company: "Cleaning company" },
  { key: "photographer", name: "Photographer A", role: "photographer", phone: "+16045550106", email: "photos@example.com" },
  { key: "leasing", name: "Leasing A", role: "leasing", phone: "+16045550107", email: "leasing@example.com" },
];

/** Which in-house employee does work at each property, by default. */
const CREW_BY_PROPERTY: Record<string, string> = {
  Acadian: "crewA",
  Arbor: "crewA",
  Courts: "crewA",
  Grandview: "crewA",
  Oakwood: "crewB",
  Parkdale: "crewB",
  Pioneer: "crewB",
  Rivergate: "crewC",
  WR: "crewC",
  Balwin: "crewC",
};

/** Days relative to today (negative = in the past). */
type Act =
  | { do: "done"; step: string; day: number }
  | { do: "start"; step: string; day: number }
  | { do: "tick"; step: string; day: number; count: number }
  | { do: "book"; step: string; day: number; on: number }
  | { do: "block"; step: string; day: number; reason: string }
  | { do: "sendBack"; from: string; to: string; day: number; reason: string }
  | { do: "note"; step: string; day: number; text: string };

interface DemoUnit {
  property: string;
  unit: string;
  moveOut: number | null;
  /** Days from today; leave out for move-out + 10 days. */
  target?: number | null;
  /** The sheet's "Scope of work" text. */
  scope?: string;
  notes?: string | ((day: (n: number) => DateOnly) => string);
  /** One of your real rows (checked against the sheet in tests), or a made-up example. */
  fromSheet: boolean;
  acts: Act[];
}

const NOT_ITEMISED = "General touch-ups (not itemised in the sheet)";

const balwin = (unit: string): DemoUnit => ({
  property: "Balwin",
  unit,
  moveOut: -6,
  scope: NOT_ITEMISED,
  fromSheet: true,
  notes: (d) => `Cleaning scheduled ${formatShort(d(-1))}; photos scheduled ${formatShort(d(5))}`,
  acts: [
    { do: "done", step: "inspection", day: -5 },
    { do: "done", step: "scope", day: -4 },
    { do: "done", step: "work", day: -2 },
    { do: "book", step: "cleaning", day: -2, on: -1 },
    { do: "book", step: "photos", day: -2, on: 5 },
  ],
});

/**
 * About six months of finished turns (made up), so the reports have a history
 * to show: in-house work is slower at Oakwood, Parkdale and WR, a few units are
 * sent back from Photos, and most targets are 10 to 14 days. The same history
 * every time, so tests and screenshots don't shift.
 */
function finishedHistory(): DemoUnit[] {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const slowerWork: Record<string, number> = { Oakwood: 3, Parkdale: 2, WR: 2 };
  const units: Record<string, string[]> = {
    Acadian: ["104", "110", "214"],
    Arbor: ["103", "108", "205"],
    Courts: ["12", "18", "31"],
    Grandview: ["108", "204", "306"],
    Oakwood: ["105", "208", "312"],
    Parkdale: ["102", "210", "308"],
    Pioneer: ["101A", "204B", "305A"],
    Rivergate: ["101", "207", "311"],
    WR: ["104", "210", "318"],
    Balwin: ["8", "11", "14"],
  };
  const scopes = [
    "Touch up paint; replace blinds",
    "Patch and paint living room; new outlet covers",
    "Replace bedroom carpet",
    "Junk removal; touch up paint",
    "Fix closet door; replace light bulbs",
    "Repaint kitchen cabinets; new hardware",
  ];
  const properties = Object.keys(units);
  const history: DemoUnit[] = [];
  let moveOut = -200;
  for (let i = 0; i < 24; i++) {
    moveOut += between(5, 8);
    const property = properties[i % properties.length];
    const unit = units[property][Math.floor(i / properties.length)];
    let d = moveOut;
    const acts: Act[] = [];
    acts.push({ do: "done", step: "inspection", day: (d += between(1, 2)) });
    acts.push({ do: "done", step: "scope", day: (d += between(0, 1)) });
    acts.push({ do: "done", step: "work", day: (d += between(2, 5) + (slowerWork[property] ?? 0)) });
    acts.push({ do: "done", step: "cleaning", day: (d += between(1, 2)) });
    if (i % 6 === 4) {
      // Photos spots something: back to in-house work, then cleaning again.
      acts.push({ do: "start", step: "photos", day: (d += 1) });
      acts.push({ do: "sendBack", from: "photos", to: "work", day: d, reason: pick(["Paint drips on the trim", "Scuff on the hallway wall", "Missing outlet cover"]) });
      acts.push({ do: "done", step: "work", day: (d += between(1, 2)) });
      acts.push({ do: "done", step: "cleaning", day: (d += 1) });
    }
    acts.push({ do: "done", step: "photos", day: (d += between(1, 3)) });
    acts.push({ do: "done", step: "leasing", day: (d += between(0, 1)) });
    history.push({ property, unit, moveOut, target: moveOut + pick([10, 12, 14, 14]), scope: pick(scopes), fromSheet: false, acts });
  }
  return history;
}

export const DEMO_UNITS: DemoUnit[] = [
  {
    property: "Acadian",
    unit: "203",
    moveOut: -7,
    scope: "Junk removal; touch up paint",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -3 },
      { do: "done", step: "scope", day: -3 },
    ],
  },
  {
    property: "Parkdale",
    unit: "405",
    moveOut: -11,
    scope:
      "New light switch covers; touch up paint where required; stain bedroom door; sand and repaint vanity cupboards (to confirm); patio door repair (replace if needed); replace light bulbs (fixtures if needed)",
    notes: "Vanity cupboards sand and repaint to be confirmed. Photos scheduled",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -4 },
      { do: "done", step: "scope", day: -4 },
      { do: "done", step: "work", day: -2 },
      { do: "done", step: "cleaning", day: -1 },
      { do: "book", step: "photos", day: -1, on: 1 },
    ],
  },
  {
    property: "Arbor",
    unit: "201",
    moveOut: -5,
    scope: "Junk removal; paint; touch ups",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -3 },
      { do: "done", step: "scope", day: -2 },
    ],
  },
  {
    property: "Pioneer",
    unit: "202B",
    moveOut: -9,
    scope: "Basic touch ups",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -7 },
      { do: "done", step: "scope", day: -6 },
      { do: "start", step: "work", day: -5 },
    ],
  },
  {
    property: "Courts",
    unit: "26",
    moveOut: -30,
    scope: NOT_ITEMISED,
    notes: "All steps complete",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -29 },
      { do: "done", step: "scope", day: -28 },
      { do: "done", step: "work", day: -24 },
      { do: "done", step: "cleaning", day: -22 },
      { do: "done", step: "photos", day: -21 },
      { do: "done", step: "leasing", day: -20 },
    ],
  },
  {
    property: "Rivergate",
    unit: "305",
    moveOut: null,
    notes: "Awaiting inspection results",
    fromSheet: true,
    acts: [{ do: "start", step: "inspection", day: -1 }],
  },
  {
    property: "Rivergate",
    unit: "303",
    moveOut: -2,
    notes: "Awaiting inspection results",
    fromSheet: true,
    acts: [{ do: "start", step: "inspection", day: -1 }],
  },
  {
    property: "WR",
    unit: "315",
    moveOut: -16,
    scope: "3 doors, 1 drawer, new stove",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -15 },
      { do: "done", step: "scope", day: -14 },
      { do: "start", step: "work", day: -13 },
      { do: "tick", step: "work", day: -8, count: 2 },
      { do: "note", step: "work", day: -8, text: "Doors and drawer done. New stove ordered, delivery not confirmed yet." },
    ],
  },
  ...["1", "2", "3", "4", "5", "6"].map(balwin),
  {
    property: "Grandview",
    unit: "102",
    moveOut: -6,
    scope: NOT_ITEMISED,
    notes: "Cleaning and photos not scheduled yet",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -5 },
      { do: "done", step: "scope", day: -4 },
      { do: "done", step: "work", day: -1 },
    ],
  },
  {
    property: "Grandview",
    unit: "105",
    moveOut: -6,
    scope: "Replace 1 window",
    notes: "Cleaning and photos not scheduled yet",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -5 },
      { do: "done", step: "scope", day: -4 },
    ],
  },
  {
    property: "Grandview",
    unit: "302",
    moveOut: -6,
    scope: NOT_ITEMISED,
    notes: "Cleaning and photos not scheduled yet",
    fromSheet: true,
    acts: [
      { do: "done", step: "inspection", day: -5 },
      { do: "done", step: "scope", day: -4 },
      { do: "done", step: "work", day: -2 },
    ],
  },
  // Made-up examples, so every situation is on the board.
  {
    property: "Oakwood",
    unit: "101",
    moveOut: -11,
    scope: "Replace fridge; patch and paint hallway",
    fromSheet: false,
    acts: [
      { do: "done", step: "inspection", day: -10 },
      { do: "done", step: "scope", day: -9 },
      { do: "start", step: "work", day: -8 },
      { do: "tick", step: "work", day: -4, count: 1 },
      { do: "block", step: "work", day: -3, reason: "Waiting on the replacement fridge (delivery not booked yet)" },
    ],
  },
  {
    property: "Oakwood",
    unit: "204",
    moveOut: -4,
    target: 6,
    fromSheet: false,
    acts: [
      { do: "note", step: "inspection", day: -3, text: "Unit is in great shape. Nothing to fix." },
      { do: "done", step: "inspection", day: -3 },
      // Approving an empty scope skips in-house work (N/A) and goes to cleaning.
      { do: "done", step: "scope", day: -3 },
      { do: "start", step: "cleaning", day: -1 },
    ],
  },
  {
    property: "Oakwood",
    unit: "310",
    moveOut: -14,
    target: 2,
    scope: "Fill nail holes; paint bedroom; replace outlet covers",
    fromSheet: false,
    acts: [
      { do: "done", step: "inspection", day: -13 },
      { do: "done", step: "scope", day: -12 },
      { do: "done", step: "work", day: -8 },
      { do: "done", step: "cleaning", day: -6 },
      { do: "start", step: "photos", day: -2 },
      { do: "sendBack", from: "photos", to: "work", day: -2, reason: "Scuff on the bedroom wall and a missing outlet cover" },
      { do: "start", step: "work", day: -1 },
    ],
  },
  ...finishedHistory(),
];

export interface DemoResult {
  peopleIds: Map<string, string>;
  turnoverIds: Map<string, string>;
  today: DateOnly;
}

export async function seedDemo(db: DB, opts: { today?: DateOnly } = {}): Promise<DemoResult> {
  const { propertyIds } = await seedBase(db);

  const peopleIds = new Map<string, string>();
  const rolesById = new Map<string, Role>();
  for (const p of DEMO_PEOPLE) {
    const [row] = await db
      .insert(people)
      .values({
        name: p.name,
        roles: [p.role],
        phone: p.phone,
        email: p.email,
        company: p.company ?? null,
        isPlaceholder: true,
      })
      .returning();
    peopleIds.set(p.key, row.id);
    rolesById.set(row.id, p.role);
  }
  const person = (key: string) => peopleIds.get(key)!;
  await setPassword(db, person("manager"), DEMO_LOGIN.password);

  for (const [name, propertyId] of propertyIds) {
    const byStep: Record<string, string> = {
      inspection: person("inspector"),
      scope: person("manager"),
      work: person(CREW_BY_PROPERTY[name] ?? "crewA"),
      cleaning: person("cleaner"),
      photos: person("photographer"),
      leasing: person("leasing"),
    };
    await db
      .insert(propertyStepDefaults)
      .values(Object.entries(byStep).map(([stepKey, personId]) => ({ propertyId, stepKey, personId })))
      .onConflictDoNothing();
  }

  const settings = await getSettings(db);
  const today = opts.today ?? dateInZone(new Date(), settings.timezone);
  const day = (n: number) => addDays(today, n);
  const manager: Actor = { personId: person("manager"), roles: ["admin"] };
  const actorFor = (s: StepState): Actor =>
    s.assigneeId ? { personId: s.assigneeId, roles: [rolesById.get(s.assigneeId) ?? "admin"] } : manager;

  const turnoverIds = new Map<string, string>();
  for (const unit of DEMO_UNITS) {
    const propertyId = propertyIds.get(unit.property);
    if (!propertyId) throw new Error(`Unknown property ${unit.property}`);
    const firstDay = Math.min(unit.moveOut ?? 0, ...unit.acts.map((a) => a.day));
    // Noon-ish UTC lands on the same calendar day across North American time zones.
    let seq = 0;
    const at = (d: number) => new Date(Date.parse(`${day(d)}T17:00:00Z`) + seq++ * 60_000);

    const created = await createTurnover(
      db,
      {
        propertyId,
        unit: unit.unit,
        moveOutDate: unit.moveOut === null ? null : day(unit.moveOut),
        targetReadyDate: unit.target === undefined ? undefined : unit.target === null ? null : day(unit.target),
        notes: typeof unit.notes === "function" ? unit.notes(day) : unit.notes,
      },
      { actor: manager, now: at(firstDay), suppressNotifications: true },
    );
    const id = created.turnover.id;
    turnoverIds.set(`${unit.property} ${unit.unit}`, id);

    const step = async (key: string) => {
      const t = await loadTurnover(db, id);
      const s = t!.steps.find((x) => x.key === key);
      if (!s) throw new Error(`No step ${key}`);
      return s;
    };
    const run = (by: Actor, d: number, command: Parameters<typeof runCommand>[2]) =>
      runCommand(db, id, command, { actor: by, now: at(d), suppressNotifications: true });

    for (const act of unit.acts) {
      if (act.do === "done") {
        const s = await step(act.step);
        if (s.kind === "scope") {
          for (const item of splitScope(unit.scope ?? "")) {
            await run(manager, act.day, { type: "addChecklistItem", stepId: s.id, text: item.text, state: item.toConfirm ? "to_confirm" : "open" });
          }
          await run(manager, act.day, { type: "complete", stepId: s.id });
        } else {
          const by = actorFor(s);
          for (const item of s.checklist.filter((c) => c.state === "open")) {
            await run(by, act.day, { type: "setChecklistItemState", stepId: s.id, itemId: item.id, state: "done" });
          }
          await run(by, act.day, { type: "complete", stepId: s.id });
        }
      } else if (act.do === "start") {
        const s = await step(act.step);
        await run(actorFor(s), act.day, { type: "start", stepId: s.id });
      } else if (act.do === "tick") {
        const s = await step(act.step);
        for (const item of s.checklist.filter((c) => c.state === "open").slice(0, act.count)) {
          await run(actorFor(s), act.day, { type: "setChecklistItemState", stepId: s.id, itemId: item.id, state: "done" });
        }
      } else if (act.do === "book") {
        const s = await step(act.step);
        await run(manager, act.day, { type: "schedule", stepId: s.id, on: day(act.on) });
      } else if (act.do === "block") {
        const s = await step(act.step);
        await run(actorFor(s), act.day, { type: "block", stepId: s.id, reason: act.reason });
      } else if (act.do === "sendBack") {
        const from = await step(act.from);
        const to = await step(act.to);
        await run(actorFor(from), act.day, { type: "sendBack", fromStepId: from.id, toStepId: to.id, reason: act.reason });
      } else if (act.do === "note") {
        const s = await step(act.step);
        await run(actorFor(s), act.day, { type: "addNote", stepId: s.id, text: act.text });
      }
    }
  }

  return { peopleIds, turnoverIds, today };
}

/** True when the database has no turnovers or people yet. */
export async function isEmpty(db: DB): Promise<boolean> {
  const rows = await db.select({ id: people.id }).from(people).where(eq(people.active, true)).limit(1);
  return rows.length === 0;
}
