import { eq } from "drizzle-orm";
import type { Executor } from "./client";
import { appSettings } from "./schema";

export type AppSettings = typeof appSettings.$inferSelect;

export const DEFAULT_SETTINGS: Omit<AppSettings, "updatedAt"> = {
  id: 1,
  timezone: "America/Vancouver",
  dueSoonDays: 3,
  defaultTargetDays: 10,
  quietHoursStart: "20:00",
  quietHoursEnd: "07:00",
  digestTime: "07:00",
  lastMorningRunOn: null,
};

export async function getSettings(ex: Executor): Promise<AppSettings> {
  const [row] = await ex.select().from(appSettings).where(eq(appSettings.id, 1));
  return row ?? { ...DEFAULT_SETTINGS, updatedAt: new Date(0) };
}
