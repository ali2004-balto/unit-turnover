/**
 * The TV board: its private link, and everything it shows. Numbers come from
 * the dashboard, summary and report code, so the board always agrees with the
 * rest of the app. It reads only: nothing here writes except the link itself.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { desc, eq, gte } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { appSettings, events, people, properties, turnovers, turnoverSteps } from "@/db/schema";
import { getSettings } from "@/db/settings";
import { addDays, dateInZone } from "@/domain/dates";
import type { Flag } from "@/domain/derived";
import { DEFAULT_TEMPLATE_STEPS } from "@/domain/workflow/default-template";
import { WorkflowError } from "@/domain/workflow/errors";
import { firstName, needsYou, type NeedsYouItem, overnightStart } from "@/domain/tv-board";
import { loadTemplate } from "../workflow";
import { buildDashboard, type CardView } from "./dashboard";
import { loadReport } from "./reports";
import { listTurnovers } from "./turnovers";

export async function newTvLink(ex: Executor, ownerId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await ex.update(appSettings).set({ tvLinkToken: token, tvLinkOwnerId: ownerId, updatedAt: new Date() }).where(eq(appSettings.id, 1));
  return token;
}

export async function removeTvLink(ex: Executor): Promise<void> {
  await ex.update(appSettings).set({ tvLinkToken: null, tvLinkOwnerId: null, updatedAt: new Date() }).where(eq(appSettings.id, 1));
}

/** Who the link belongs to, or null when the link is wrong, replaced or turned off. */
export async function tvLinkOwner(ex: Executor, given: string): Promise<{ ownerId: string | null } | null> {
  const { tvLinkToken, tvLinkOwnerId } = await getSettings(ex);
  if (!tvLinkToken || !given) return null;
  // Compare digests so the comparison takes the same time whatever the token is.
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(given), digest(tvLinkToken)) ? { ownerId: tvLinkOwnerId } : null;
}

export const tvLinkUrl = (baseUrl: string, token: string) => `${baseUrl.replace(/\/+$/, "")}/tv/${token}`;

export interface TvTurn {
  id: string;
  label: string;
  stage: string;
  /** First names of whoever has it now. */
  who: string;
  daysInStage: number | null;
  flag: Flag;
}

export interface TvNeed {
  id: string;
  label: string;
  flag: Flag;
  yourSteps: string[];
}

export interface TvDone {
  id: number;
  what: string;
  label: string;
  who: string | null;
  at: Date;
}

export interface TvBoard {
  today: string;
  now: Date;
  timezone: string;
  metrics: {
    active: number;
    needYou: number;
    overdue: number;
    avgDaysVacant: number | null;
    finished30: number;
    /** 0 to 1, or null when no finished turn had a target date. */
    onTime90: number | null;
  };
  stages: Array<{ label: string; units: number }>;
  turns: TvTurn[];
  needs: TvNeed[];
  overnight: TvDone[];
}

const label = (c: { propertyName: string; unit: string }) => `${c.propertyName} ${c.unit}`;

function turn(c: CardView): TvTurn {
  const names = [...new Set(c.activeSteps.map((s) => firstName(s.assigneeName)))];
  return {
    id: c.id,
    label: label(c),
    stage: c.currentStage,
    who: names.map((n) => n ?? "Unassigned").join(", ") || "Unassigned",
    daysInStage: c.daysInStage,
    flag: c.flag,
  };
}

export async function loadTvBoard(ex: Executor, ownerId: string | null, now = new Date()): Promise<TvBoard> {
  const today = dateInZone(now, (await getSettings(ex)).timezone);
  const [list, steps, report] = await Promise.all([
    listTurnovers(ex, { today }),
    loadTemplate(ex).then(
      (t) => t.steps,
      (error: unknown) => {
        if (error instanceof WorkflowError && error.code === "NOT_FOUND") return DEFAULT_TEMPLATE_STEPS;
        throw error;
      },
    ),
    loadReport(ex, { period: "90d", today }).then((r) => r.report),
  ]);
  const { settings } = list;
  const dashboard = buildDashboard(list, steps, {});
  const needs: NeedsYouItem[] = needsYou(dashboard.cards, ownerId);
  const flagOf = new Map(dashboard.cards.map((c) => [c.id, c.flag]));

  const since = overnightStart(now, settings.timezone);
  const rows = await ex
    .select({
      id: events.id,
      type: events.type,
      at: events.at,
      stepName: turnoverSteps.name,
      unit: turnovers.unit,
      property: properties.name,
      actor: people.name,
    })
    .from(events)
    .innerJoin(turnovers, eq(turnovers.id, events.turnoverId))
    .innerJoin(properties, eq(properties.id, turnovers.propertyId))
    .leftJoin(turnoverSteps, eq(turnoverSteps.id, events.stepId))
    .leftJoin(people, eq(people.id, events.actorId))
    .where(gte(events.at, since))
    .orderBy(desc(events.at));
  const overnight = rows
    .filter((r) => r.type === "step_completed" || r.type === "turnover_completed")
    .map(
      (r): TvDone => ({
        id: r.id,
        what: r.type === "turnover_completed" ? "Turn finished" : `${r.stepName ?? "A step"} done`,
        label: label({ propertyName: r.property, unit: r.unit }),
        who: firstName(r.actor),
        at: r.at,
      }),
    );

  const finished30From = addDays(today, -29);
  return {
    today,
    now,
    timezone: settings.timezone,
    metrics: {
      active: dashboard.summary.activeTurns,
      needYou: needs.length,
      overdue: dashboard.summary.overdue,
      avgDaysVacant: dashboard.summary.avgDaysVacantActive,
      finished30: report.completed.filter((c) => c.readyOn >= finished30From).length,
      onTime90: report.totals.onTimeRate,
    },
    stages: dashboard.summary.pipeline.map((p) => ({ label: p.stage, units: p.unitsNow })),
    turns: dashboard.cards.map(turn),
    needs: needs.map((n) => ({ id: n.id, label: label(n), flag: (flagOf.get(n.id) ?? "On track") as Flag, yourSteps: n.yourSteps })),
    overnight,
  };
}
