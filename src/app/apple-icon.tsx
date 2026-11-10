import { ImageResponse } from "next/og";
import { AppIcon } from "./app-icon";

/** For "Add to Home Screen" on iPhones and iPads. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={size.width} />, size);
}
