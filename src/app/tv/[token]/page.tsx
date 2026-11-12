import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { loadTvBoard, tvLinkOwner } from "@/server/queries/tv-board";
import { Board } from "./board";

/**
 * The TV board. The link's secret is the only key, and it's checked before
 * anything streams, so a wrong or turned-off link gets a real 404. Server
 * components only: it works with JavaScript off and reloads itself with a
 * meta tag.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Turnover board",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function TvPage(props: PageProps<"/tv/[token]">) {
  await connection();
  const { token } = await props.params;
  const db = await getDb();
  const link = await tvLinkOwner(db, token);
  if (!link) notFound();
  return <Board board={await loadTvBoard(db, link.ownerId)} />;
}
