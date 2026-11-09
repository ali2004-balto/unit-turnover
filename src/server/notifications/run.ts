/**
 * One pass of the notification work: write the morning's messages when it's
 * time, then send whatever is due. It runs:
 *
 * - right after any change that queues a message (so texts go out in seconds),
 * - every few minutes from the scheduler (/api/cron/tick), for reminders,
 *   retries and texts held overnight,
 * - every minute inside `npm run dev`, so it all works locally too.
 */
import type { DB } from "@/db/client";
import { runMorning } from "./morning";
import { type MessageProvider, providerFromEnv } from "./providers";
import { type SendReport, sendDue } from "./sender";

export interface RunReport {
  morning: { ran: boolean; queued: number };
  sent: SendReport;
}

export async function runNotifications(db: DB, opts: { baseUrl: string; provider?: MessageProvider; now?: Date }): Promise<RunReport> {
  const now = opts.now ?? new Date();
  const morning = await runMorning(db, now);
  const sent = await sendDue(db, { provider: opts.provider ?? providerFromEnv(), baseUrl: opts.baseUrl, now });
  return { morning, sent };
}

/** The address links in messages point to: APP_URL, or the address of the request that triggered it. */
export function messageBaseUrl(fromRequest?: string | null): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return (fromRequest ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
}

const state = globalThis as unknown as { __unitTurnoverSend?: { running: boolean; again: boolean } };

/**
 * Runs a pass soon, without overlapping another pass in this server process:
 * calls that arrive during a pass make one more pass afterwards.
 */
export async function runNotificationsSoon(getDb: () => Promise<DB>, baseUrl: string): Promise<void> {
  const s = (state.__unitTurnoverSend ??= { running: false, again: false });
  if (s.running) {
    s.again = true;
    return;
  }
  s.running = true;
  try {
    do {
      s.again = false;
      await runNotifications(await getDb(), { baseUrl });
    } while (s.again);
  } catch (error) {
    console.error("Sending notifications failed", error);
  } finally {
    s.running = false;
  }
}
