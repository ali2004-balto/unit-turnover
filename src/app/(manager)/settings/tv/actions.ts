"use server";

import { refresh } from "next/cache";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { newTvLink, removeTvLink } from "@/server/queries/tv-board";

/** Turns the TV link on, or replaces it so the old one stops working. You become "you" on the board. */
export async function newTvLinkAction(): Promise<void> {
  const { person } = await requireManager();
  await newTvLink(await getDb(), person.id);
  refresh();
}

export async function removeTvLinkAction(): Promise<void> {
  await requireManager();
  await removeTvLink(await getDb());
  refresh();
}
