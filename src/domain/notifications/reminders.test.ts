import { describe, expect, it } from "vitest";
import type { DateOnly } from "../dates";
import { derive, isPastTarget } from "../derived";
import { turnoverDerivedInput } from "../workflow/engine";
import { PEOPLE, Scenario, templateSteps } from "../workflow/test-helpers";
import { renderMessage } from "./messages";
import { collectMorning, type MorningInput, type MorningPerson, planMorning, type TaskReminder } from "./reminders";

// A fixed UTC-8 zone: the test clock's 17:00 UTC is 9 am local.
const TZ = "Etc/GMT+8";
const { admin, admin2, inspector, crew, cleaner } = PEOPLE;
const LINK = "https://turnover.example.com/l/AbCdEfGhIjKlMnOpQrStUv";

const NAMES: Record<string, string> = {
  [admin]: "Manager",
  [admin2]: "Second Manager",
  [inspector]: "Inspector A",
  [crew]: "Crew A",
  [PEOPLE.crew2]: "Crew B",
  [cleaner]: "Cleaner A",
  [PEOPLE.photographer]: "Photographer A",
  [PEOPLE.leasing]: "Leasing A",
};

function team(inactive: string[] = []): Map<string, MorningPerson> {
  return new Map(
    Object.entries(NAMES).map(([id, name]) => [
      id,
      { id, name, roles: id.startsWith("admin") ? ["admin"] : ["crew"], active: !inactive.includes(id) },
    ]),
  );
}

/** The morning of `today` for these turnovers, labelled "Acadian 203", "Acadian 204"... */
function morningOf(today: DateOnly, scenarios: Scenario[], opts: { lastActivity?: Record<string, string>; inactive?: string[] } = {}): MorningInput {
  const lastActivity = new Map(Object.entries(opts.lastActivity ?? {}).map(([id, iso]) => [id, new Date(iso)]));
  return {
    today,
    timeZone: TZ,
    people: team(opts.inactive),
    turnovers: scenarios.map((s, i) => {
      const turnover = { ...s.t, id: `turnover-${i + 1}`, unit: String(203 + i) };
      const input = turnoverDerivedInput(turnover);
      const derived = derive(input, today, 3);
      return { turnover, label: `Acadian ${turnover.unit}`, derived, pastTarget: isPastTarget(input, derived.isComplete, today), lastActivity };
    }),
  };
}

const tasksOn = (today: DateOnly, s: Scenario, person: string, opts?: Parameters<typeof morningOf>[2]) =>
  (collectMorning(morningOf(today, [s], opts)).tasks.get(person) ?? []).map((t) => t.type);

/** Inspection and scope done, so in-house work is the crew's turn (from Mon Nov 2). */
function atWork(s: Scenario) {
  s.finish("inspection");
  s.run(admin, { type: "addChecklistItem", stepId: s.step("scope").id, text: "Touch up paint" });
  s.finish("scope");
  return s;
}

describe("morning reminders for people on steps", () => {
  it("says when a task is due today, and the morning after it's late, once each", () => {
    const s = new Scenario(); // inspection active Mon Nov 2, due Wed Nov 4
    expect(tasksOn("2026-11-03", s, inspector)).toEqual([]);
    expect(tasksOn("2026-11-04", s, inspector)).toEqual(["due"]);
    expect(tasksOn("2026-11-05", s, inspector)).toEqual(["late"]);
    expect(tasksOn("2026-11-06", s, inspector)).toEqual([]);
  });

  it("doesn't repeat a due date to someone who got the task this morning", () => {
    const s = new Scenario({ steps: templateSteps({ inspection: { dueDays: 0 } }) });
    expect(tasksOn("2026-11-02", s, inspector)).toEqual([]);
  });

  it("reminds people of a booking on the day, and asks the next day if it happened", () => {
    const s = atWork(new Scenario());
    s.run(admin, { type: "schedule", stepId: s.step("work").id, on: "2026-11-05", time: "09:30" });
    expect(tasksOn("2026-11-04", s, crew)).toEqual([]);
    expect(collectMorning(morningOf("2026-11-05", [s])).tasks.get(crew)).toEqual([
      { type: "booking", turnoverId: "turnover-1", stepId: s.step("work").id, unit: "Acadian 203", stepName: "In-house work", time: "09:30" },
    ]);
    expect(tasksOn("2026-11-06", s, crew)).toEqual(["missed"]);
    // Nov 7 is the work's due date, but booked work isn't nagged about it: the booking is the plan.
    expect(tasksOn("2026-11-07", s, crew)).toEqual([]);
  });

  it("doesn't send anyone to a booking whose unit isn't ready", () => {
    const s = new Scenario();
    s.run(admin, { type: "schedule", stepId: s.step("cleaning").id, on: "2026-11-05", time: "10:00" });
    expect(tasksOn("2026-11-05", s, cleaner)).toEqual([]);
  });

  it("leaves out blocked tasks", () => {
    const s = new Scenario();
    s.run(inspector, { type: "block", stepId: s.step("inspection").id, reason: "No keys" });
    expect(tasksOn("2026-11-04", s, inspector)).toEqual([]);
  });
});

describe("the morning summary for managers", () => {
  it("flags a booking today or tomorrow whose unit isn't ready", () => {
    const s = new Scenario();
    s.run(admin, { type: "schedule", stepId: s.step("cleaning").id, on: "2026-11-05", time: "10:00" });
    const before = collectMorning(morningOf("2026-11-04", [s])).digest;
    expect(before.attention).toEqual([
      expect.objectContaining({ type: "not_ready", unit: "Acadian 203", stepName: "Cleaning", when: "tomorrow", on: "2026-11-05", waitingOn: "Inspection", assigneeName: "Cleaner A" }),
    ]);
    const onTheDay = collectMorning(morningOf("2026-11-05", [s])).digest;
    expect(onTheDay.attention).toEqual([expect.objectContaining({ type: "not_ready", when: "today" })]);
    expect(onTheDay.bookedToday).toEqual([expect.objectContaining({ stepName: "Cleaning", time: "10:00", waitingOn: "Inspection" })]);
  });

  it("flags a step with no updates for longer than its limit, on that morning only", () => {
    const s = new Scenario(); // inspection active Mon Nov 2; alert after 3 days
    const on = (today: DateOnly, lastActivity?: Record<string, string>) => collectMorning(morningOf(today, [s], { lastActivity })).digest;
    expect(on("2026-11-05").attention).toEqual([]); // Tue and Wed were quiet: 2 days
    expect(on("2026-11-06").attention).toEqual([
      expect.objectContaining({ type: "stalled", stepName: "Inspection", since: "2026-11-02", assigneeName: "Inspector A", status: "Not started" }),
    ]);
    expect(on("2026-11-07").attention).toEqual([]);
    expect(on("2026-11-07").stalled).toEqual([expect.objectContaining({ stepName: "Inspection", since: "2026-11-02" })]);
    // Anything done on the step starts the count again.
    expect(on("2026-11-06", { [s.step("inspection").id]: "2026-11-04T18:00:00Z" }).attention).toEqual([]);
  });

  it("counts from the booking date for booked steps", () => {
    const s = atWork(new Scenario({ steps: templateSteps({ work: { escalateAfterDays: 1 } }) }));
    expect(collectMorning(morningOf("2026-11-05", [s])).digest.stalled).toHaveLength(1);
    s.run(admin, { type: "schedule", stepId: s.step("work").id, on: "2026-11-06" });
    expect(collectMorning(morningOf("2026-11-05", [s])).digest.stalled).toEqual([]);
  });

  it("lists what's blocked, unassigned, late and finished", () => {
    const blocked = new Scenario();
    blocked.run(inspector, { type: "block", stepId: blocked.step("inspection").id, reason: "No keys" });
    const unassigned = new Scenario({ assignees: { inspection: null } });
    const late = new Scenario({ moveOutDate: "2026-10-20" }); // target Oct 30
    const dueSoon = new Scenario({ moveOutDate: "2026-10-26" }); // target Nov 5
    const finished = new Scenario();
    finished.finish("inspection");

    const d = collectMorning(morningOf("2026-11-03", [blocked, unassigned, late, dueSoon, finished])).digest;
    expect(d.counts).toEqual({ active: 5, blocked: 1, pastTarget: 1, dueSoon: 1, unassigned: 1 });
    expect(d.blocked).toEqual([expect.objectContaining({ unit: "Acadian 203", reason: "No keys", since: "2026-11-02", assigneeName: "Inspector A" })]);
    expect(d.unassigned).toEqual([expect.objectContaining({ unit: "Acadian 204", stepName: "Inspection", since: "2026-11-02" })]);
    expect(d.pastTarget).toEqual([{ turnoverId: "turnover-3", unit: "Acadian 205", target: "2026-10-30", stage: "1. Inspection" }]);
    expect(d.dueSoon).toEqual([{ turnoverId: "turnover-4", unit: "Acadian 206", target: "2026-11-05", stage: "1. Inspection" }]);
    expect(d.doneYesterday).toEqual([expect.objectContaining({ unit: "Acadian 207", stepName: "Inspection", assigneeName: "Inspector A" })]);
  });
});

describe("planning the morning", () => {
  it("sends one message per person, and the summary to each active manager", () => {
    const due = new Scenario(); // inspection due Nov 4
    const booked = atWork(new Scenario());
    booked.run(admin, { type: "schedule", stepId: booked.step("work").id, on: "2026-11-04" });
    const messages = planMorning(morningOf("2026-11-04", [due, booked], { inactive: [admin2] }));

    expect(messages.map((m) => [m.kind, m.recipientId, m.dedupeKey])).toEqual([
      ["daily_tasks", inspector, `daily_tasks:2026-11-04:${inspector}`],
      ["daily_tasks", crew, `daily_tasks:2026-11-04:${crew}`],
      ["daily_digest", admin, `daily_digest:2026-11-04:${admin}`],
    ]);
    // A single reminder links straight to its task.
    expect(messages[0]).toMatchObject({ turnoverId: "turnover-1", stepId: due.step("inspection").id });
    expect(messages[2].data).toMatchObject({ day: "2026-11-04", urgent: false });
  });

  it("skips the summary when nothing is going on", () => {
    expect(planMorning(morningOf("2026-11-04", []))).toEqual([]);
  });
});

describe("morning messages", () => {
  const item = (fields: Partial<TaskReminder> & Pick<TaskReminder, "type">): TaskReminder =>
    ({ turnoverId: "t1", stepId: "s1", unit: "Acadian 203", stepName: "Cleaning", time: null, ...fields }) as TaskReminder;

  it("reads like the single reminder when there's one thing", () => {
    const m = renderMessage({ kind: "daily_tasks", unit: null, stepName: null, data: { items: [item({ type: "due" })] }, link: LINK });
    expect(m.sms).toBe(`Due today: Cleaning at Acadian 203. Open: ${LINK}`);
    expect(m.subject).toBe("Due today: Cleaning at Acadian 203");
  });

  it("lists several things in one text, and one email", () => {
    const items = [
      item({ type: "booking", unit: "Balwin 1", time: "10:00" }),
      item({ type: "due", stepName: "In-house work" }),
      item({ type: "late", unit: "Arbor 12", stepName: "In-house work", dueOn: "2026-11-08" }),
      item({ type: "missed", unit: "WR 315", stepName: "Photos", on: "2026-11-08" }),
    ];
    const m = renderMessage({ kind: "daily_tasks", unit: null, stepName: null, data: { items }, link: LINK });
    expect(m.sms).toBe(
      `Good morning. Booked today: Cleaning at Balwin 1 at 10:00; Due today: In-house work at Acadian 203; Late: In-house work at Arbor 12; Not marked done: Photos at WR 315 (booked Sun Nov 8). Open: ${LINK}`,
    );
    expect(m.subject).toBe("Your tasks today (4)");
    expect(m.text).toContain("Late\n- In-house work at Arbor 12 (was due Sun Nov 8)");
    expect(m.text).toContain(`Open your tasks: ${LINK}`);
  });

  it("keeps a long list to about two text messages", () => {
    const items = Array.from({ length: 12 }, (_, i) => item({ type: "due", unit: `Acadian ${100 + i}`, stepName: "In-house work" }));
    const m = renderMessage({ kind: "daily_tasks", unit: null, stepName: null, data: { items }, link: LINK });
    expect(m.sms.length).toBeLessThanOrEqual(300);
    expect(m.sms).toMatch(/; and \d+ more\. Open: /);
  });

  it("texts managers what needs them, with the summary by email", () => {
    const s = new Scenario();
    s.run(admin, { type: "schedule", stepId: s.step("cleaning").id, on: "2026-11-05" });
    const [digest] = planMorning(morningOf("2026-11-06", [s])).filter((m) => m.kind === "daily_digest");
    const m = renderMessage({ kind: "daily_digest", unit: null, stepName: null, data: digest.data, link: "https://app.example.com/", appUrl: "https://app.example.com" });
    // One thing: the text links straight to that turnover.
    expect(m.sms).toBe(
      "Acadian 203: no updates on Inspection since Mon Nov 2 (Inspector A, not started). Open: https://app.example.com/turnovers/turnover-1",
    );
    expect(m.subject).toBe("Morning summary: 1 thing needs you");
    expect(m.text).toContain("1 turnover in progress, all on track.");
    expect(m.text).toContain("NEEDS YOU\n- Acadian 203, Inspection: no updates since Mon Nov 2 (Inspector A, not started).");
    expect(m.text).toContain("NO UPDATES FOR A WHILE\n- Acadian 203, Inspection (Inspector A): nothing since Mon Nov 2");
    expect(m.text).toContain("Open the dashboard: https://app.example.com/");
  });
});
