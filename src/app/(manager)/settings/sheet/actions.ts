"use server";

import { refresh } from "next/cache";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { newSheetLink, removeSheetLink } from "@/server/queries/tracker-export";

/** Turns the live link on, or replaces it so the old one stops working. */
export async function newSheetLinkAction(): Promise<void> {
  await requireManager();
  await newSheetLink(await getDb());
  refresh();
}

export async function removeSheetLinkAction(): Promise<void> {
  await requireManager();
  await removeSheetLink(await getDb());
  refresh();
}
