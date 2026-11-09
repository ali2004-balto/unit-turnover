import { describe, expect, it } from "vitest";
import { plainText, redactLinks, renderMessage } from "./messages";
import { chooseChannels, inQuietHours, localTime, quietHoursEnd, type Recipient } from "./policy";

const LINK = "https://turnover.example.com/l/AbCdEfGhIjKlMnOpQrStUv";
const msg = (kind: string, data: Record<string, unknown> = {}, extra: Partial<Parameters<typeof renderMessage>[0]> = {}) =>
  renderMessage({ kind, unit: "Acadian 203", stepName: "In-house work", data, link: LINK, ...extra });

describe("messages", () => {
  it("tells people their unit is ready, with the due date and their link", () => {
    expect(msg("step_assigned", { dueOn: "2026-11-11" }).sms).toBe(
      `Acadian 203: In-house work is ready for you, due Wed Nov 11. Open: ${LINK}`,
    );
  });

  it("explains send-backs, blocks and bookings in a sentence", () => {
    expect(msg("step_sent_back", { fromStepName: "Photos", reason: "Scuff on the bedroom wall" }).sms).toBe(
      `Acadian 203 was sent back to you from Photos: Scuff on the bedroom wall. Open: ${LINK}`,
    );
    expect(msg("step_blocked", { reason: "Waiting on the fridge" }).sms).toBe(
      `Blocked: Acadian 203, In-house work: Waiting on the fridge. Open: ${LINK}`,
    );
    expect(renderMessage({ kind: "booking_created", unit: "Balwin 1", stepName: "Photos", data: { on: "2026-11-14", time: "10:00" }, link: LINK }).sms).toBe(
      `You're booked for Photos at Balwin 1 on Sat Nov 14 at 10:00. We'll text you when it's ready. Open: ${LINK}`,
    );
    expect(msg("booking_missed", { on: "2026-11-08" }).sms).toBe(
      `Did In-house work at Acadian 203 happen on Sun Nov 8? Mark it done, or book a new time. Open: ${LINK}`,
    );
  });

  it("leaves out the link when there's nothing to do", () => {
    expect(msg("step_unassigned", {}, { link: null }).sms).toBe("In-house work at Acadian 203 has been given to someone else. Nothing to do.");
  });

  it("keeps texts to plain characters and a sensible length", () => {
    const long = msg("step_blocked", { reason: `“Waiting” — ${"x".repeat(400)} 🙂` }).sms;
    expect(long).toMatch(/^[\x20-\x7E]*$/);
    expect(long.length).toBeLessThan(320);
    expect(plainText("It’s “done” – … · ok")).toBe(`It's "done" - ... - ok`);
  });

  it("builds an email with a subject and the link on its own line", () => {
    const m = msg("step_assigned", { dueOn: "2026-11-11" });
    expect(m.subject).toBe("Acadian 203: In-house work is ready for you");
    expect(m.text).toBe(`Acadian 203: In-house work is ready for you, due Wed Nov 11.\n\nOpen it here: ${LINK}\n\nUnit Turnover`);
  });

  it("hides the secret part of links in the outbox", () => {
    expect(redactLinks(msg("step_assigned").sms)).toBe("Acadian 203: In-house work is ready for you. Open: https://turnover.example.com/l/[link]");
  });
});

const person = (fields: Partial<Recipient> = {}): Recipient => ({
  roles: ["crew"],
  phone: "+16045550102",
  email: "crew@example.com",
  notifyChannel: "sms",
  active: true,
  ...fields,
});

describe("who hears how", () => {
  it("sends people messages the way they chose", () => {
    expect(chooseChannels(person(), "step_assigned")).toEqual({ channels: ["sms"] });
    expect(chooseChannels(person({ notifyChannel: "both" }), "step_assigned")).toEqual({ channels: ["sms", "email"] });
    expect(chooseChannels(person({ notifyChannel: "email" }), "step_assigned")).toEqual({ channels: ["email"] });
  });

  it("emails managers, and texts them only for urgent things", () => {
    const manager = person({ roles: ["admin"], notifyChannel: "both" });
    expect(chooseChannels(manager, "send_back_alert")).toEqual({ channels: ["email"] });
    expect(chooseChannels(manager, "step_blocked")).toEqual({ channels: ["sms", "email"] });
    expect(chooseChannels(manager, "escalation")).toEqual({ channels: ["sms", "email"] });
  });

  it("uses whatever it can reach, and says why when it can't", () => {
    expect(chooseChannels(person({ phone: null }), "step_assigned")).toEqual({ channels: ["email"] });
    expect(chooseChannels(person({ phone: null, email: null }), "step_assigned")).toEqual({ skip: "No phone number or email" });
    expect(chooseChannels(person({ notifyChannel: "none" }), "step_assigned")).toEqual({ skip: "They chose not to get messages" });
    expect(chooseChannels(person({ active: false }), "step_assigned")).toMatchObject({ skip: expect.any(String) });
  });
});

describe("quiet hours", () => {
  // A fixed UTC-8 zone, so these don't depend on the machine's time zone
  // rules (B.C. stopped changing its clocks in 2026; older data disagrees).
  const TZ = "Etc/GMT+8";
  const quiet = (iso: string) => inQuietHours(new Date(iso), TZ, "20:00", "07:00");

  it("reads the local time in the company's time zone", () => {
    expect(localTime(new Date("2026-11-10T03:00:00Z"), TZ)).toBe("19:00");
    expect(localTime(new Date("2026-11-10T08:05:00Z"), TZ)).toBe("00:05");
  });

  it("runs from 8 pm to 7 am, across midnight", () => {
    expect(quiet("2026-11-10T03:59:00Z")).toBe(false); // 19:59
    expect(quiet("2026-11-10T04:00:00Z")).toBe(true); // 20:00
    expect(quiet("2026-11-10T05:00:00Z")).toBe(true); // 21:00
    expect(quiet("2026-11-10T08:00:00Z")).toBe(true); // 00:00
    expect(quiet("2026-11-10T14:00:00Z")).toBe(true); // 06:00
    expect(quiet("2026-11-10T15:00:00Z")).toBe(false); // 07:00
    expect(quiet("2026-11-10T20:00:00Z")).toBe(false); // 12:00
  });

  it("handles a window within one day, and none at all", () => {
    expect(inQuietHours(new Date("2026-11-10T21:30:00Z"), TZ, "13:00", "14:00")).toBe(true); // 13:30
    expect(inQuietHours(new Date("2026-11-10T22:00:00Z"), TZ, "13:00", "14:00")).toBe(false); // 14:00
    expect(inQuietHours(new Date("2026-11-10T05:00:00Z"), TZ, "07:00", "07:00")).toBe(false);
  });

  it("holds texts until 7 am, before or after midnight", () => {
    expect(quietHoursEnd(new Date("2026-11-10T05:30:45Z"), TZ, "07:00").toISOString()).toBe("2026-11-10T15:00:00.000Z"); // 21:30
    expect(quietHoursEnd(new Date("2026-11-10T14:00:00Z"), TZ, "07:00").toISOString()).toBe("2026-11-10T15:00:00.000Z"); // 06:00
  });

  it("still means 7 am on the night the clocks go forward", () => {
    // 10 pm Saturday March 7 2026 in New York; clocks went forward at 2 am.
    expect(quietHoursEnd(new Date("2026-03-08T03:00:00Z"), "America/New_York", "07:00").toISOString()).toBe("2026-03-08T11:00:00.000Z");
  });
});
