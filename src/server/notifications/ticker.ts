import { getDb } from "../db";
import { messageBaseUrl, runNotificationsSoon } from "./run";

const EVERY_MS = 60_000;
const state = globalThis as unknown as { __unitTurnoverTicker?: ReturnType<typeof setInterval> };

/** Checks for messages to send every minute, in this server process. */
export function startTicking(): void {
  if (state.__unitTurnoverTicker) return;
  const baseUrl = messageBaseUrl();
  const tick = () => void runNotificationsSoon(getDb, baseUrl);
  state.__unitTurnoverTicker = setInterval(tick, EVERY_MS);
  // Don't keep the process alive just for this.
  state.__unitTurnoverTicker.unref?.();
  setTimeout(tick, 5_000).unref?.();
}
