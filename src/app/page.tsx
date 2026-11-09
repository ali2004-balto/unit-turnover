import { redirect } from "next/navigation";

// Phase 1: the only screen is the read-only Master Tracker. The dashboard replaces this in Phase 2.
export default function Home() {
  redirect("/tracker");
}
