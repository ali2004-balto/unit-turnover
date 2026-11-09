import "server-only";
import { after } from "next/server";
import { appBaseUrl } from "../auth/current";
import { getDb } from "../db";
import { runNotificationsSoon } from "./run";

/**
 * Sends the messages a change just queued, once the response is on its way
 * to the browser, so the person who made the change never waits on Twilio.
 * Call it from a server action after the change is saved.
 */
export async function sendQueuedMessages(): Promise<void> {
  const baseUrl = await appBaseUrl();
  after(() => runNotificationsSoon(getDb, baseUrl));
}
