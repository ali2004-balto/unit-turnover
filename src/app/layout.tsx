import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Unit Turnover", template: "%s · Unit Turnover" },
  description: "Move-out to rent-ready and listed: every unit turn, every step, every person.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-CA" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-6 px-4 sm:px-6">
            <Link href="/" className="font-semibold tracking-tight">
              Unit Turnover
            </Link>
            <nav aria-label="Main" className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/tracker" className="hover:text-foreground">
                Master Tracker
              </Link>
            </nav>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
