import type { MetadataRoute } from "next";
import { ICON_BLUE } from "./app-icon";

/** Lets people add the app to their phone's home screen, where it opens like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Unit Turnover",
    short_name: "Turnover",
    description: "Move-out to rent-ready and listed: every unit turn, every step, every person.",
    // Managers land on the dashboard, everyone else on their tasks.
    start_url: "/start",
    display: "standalone",
    background_color: "#f7f7f8",
    theme_color: ICON_BLUE,
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
