import { Suspense } from "react";
import { SettingsNav, SettingsNavFallback } from "./settings-nav";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-5 grid gap-6 md:grid-cols-[12rem_1fr]">
        <Suspense fallback={<SettingsNavFallback />}>
          <SettingsNav />
        </Suspense>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
