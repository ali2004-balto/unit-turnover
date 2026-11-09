/**
 * Runs once when the server starts. In development (and on any server where
 * IN_PROCESS_TICK=1) it checks for messages to send every minute, so morning
 * reminders and texts held overnight work without a scheduler. On Vercel the
 * scheduler calls /api/cron/tick instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production" && process.env.IN_PROCESS_TICK !== "1") return;
  if (process.env.IN_PROCESS_TICK === "0") return;

  const { startTicking } = await import("./server/notifications/ticker");
  startTicking();
}
