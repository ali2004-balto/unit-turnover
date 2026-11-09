import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/db/settings";
import type { Deliveries } from "@/db/schema";
import { dateInZone } from "@/domain/dates";
import { MESSAGE_LABELS } from "@/domain/notifications/messages";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { listOutbox, OUTBOX_VIEWS, type OutboxEntry, type OutboxView, parseOutboxView } from "@/server/notifications/outbox";
import { notificationSetup } from "@/server/notifications/providers";
import { Section } from "../section";
import { MessageSettingsForm, RetryButton, RunMorningButton } from "./outbox-controls";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage(props: PageProps<"/settings/messages">) {
  return (
    <Section
      title="Messages"
      path="/settings/messages"
      description="Every text and email the app sends: who it went to, what it said, and whether it got there."
    >
      {async () => {
        const params = await props.searchParams;
        const view = parseOutboxView(params.view);
        const page = Math.max(1, Number(params.page) || 1);
        const db = await getDb();
        const [settings, outbox] = await Promise.all([getSettings(db), listOutbox(db, { view, page })]);
        const setup = notificationSetup();
        const now = new Date();
        return (
          <div className="space-y-6">
            <ModeBanner setup={setup} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
              <MessageSettingsForm quietHoursStart={settings.quietHoursStart} quietHoursEnd={settings.quietHoursEnd} digestTime={settings.digestTime} />
              <div className="space-y-2 rounded-lg border border-border bg-card p-5 text-sm">
                <h3 className="font-medium">Morning messages</h3>
                <p className="text-muted-foreground">
                  Each morning, people with something on today get one message listing it: bookings, tasks due, tasks that went late, and bookings
                  nobody marked done. Managers get a summary by email, and a text when something needs them.
                </p>
                <p className="text-muted-foreground">
                  {settings.lastMorningRunOn === dateInZone(now, settings.timezone)
                    ? "Today's went out this morning."
                    : `Today's go out at ${settings.digestTime}.`}
                </p>
                <RunMorningButton />
              </div>
            </div>

            <div>
              <nav aria-label="Messages to show" className="flex flex-wrap gap-1">
                {(Object.keys(OUTBOX_VIEWS) as OutboxView[]).map((v) => (
                  <Link
                    key={v}
                    href={v === "all" ? "/settings/messages" : `/settings/messages?view=${v}`}
                    aria-current={v === view ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                      v === view && "bg-muted font-medium text-foreground",
                    )}
                  >
                    {OUTBOX_VIEWS[v]} <span className="tabular-nums">({outbox.counts[v]})</span>
                  </Link>
                ))}
              </nav>
              {outbox.entries.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {view === "all" ? "No messages yet. They appear here as soon as something happens." : "Nothing here."}
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
                  {outbox.entries.map((e) => (
                    <Entry key={e.id} entry={e} timeZone={settings.timezone} now={now} />
                  ))}
                </ul>
              )}
              <Pager view={view} page={page} hasMore={outbox.hasMore} />
            </div>
          </div>
        );
      }}
    </Section>
  );
}

function ModeBanner({ setup }: { setup: ReturnType<typeof notificationSetup> }) {
  if (setup.mode === "dry-run") {
    return (
      <div className="rounded-lg border border-border bg-st-progress-bg px-4 py-3 text-sm text-st-progress-fg">
        <p className="font-medium">Dry run: no texts or emails leave the app.</p>
        <p className="mt-1">
          Each message is shown below in full, sign-in link included, so you can try everything. To send for real, set NOTIFICATIONS_MODE=live
          with your Twilio and Resend keys (see the deploy guide).
        </p>
      </div>
    );
  }
  const missing = [!setup.sms && "texts (Twilio keys)", !setup.email && "email (Resend key)"].filter(Boolean);
  return (
    <div
      className={cn(
        "rounded-lg border border-border px-4 py-3 text-sm",
        missing.length ? "bg-st-blocked-bg text-st-blocked-fg" : "bg-st-done-bg text-st-done-fg",
      )}
    >
      <p className="font-medium">Live: messages are being sent.</p>
      <p className="mt-1">
        {missing.length ? `Not set up yet: ${missing.join(" and ")}. Those messages fail until the keys are added.` : "Texts go through Twilio and email through Resend."}
      </p>
    </div>
  );
}

const CHANNEL_NAMES = { sms: "text", email: "email" } as const;

function sentBy(deliveries: Deliveries): string {
  const sent = (["sms", "email"] as const).filter((c) => deliveries[c]?.status === "sent").map((c) => CHANNEL_NAMES[c]);
  return sent.length ? ` by ${sent.join(" and ")}` : "";
}

function when(instant: Date, timeZone: string, now: Date): string {
  const sameDay = dateInZone(instant, timeZone) === dateInZone(now, timeZone);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

function badge(e: OutboxEntry, timeZone: string, now: Date): { label: string; tone: string } {
  switch (e.status) {
    case "sent":
      return { label: `Sent${sentBy(e.deliveries)}`, tone: "bg-st-done-bg text-st-done-fg" };
    case "failed":
      return { label: "Failed", tone: "bg-st-blocked-bg text-st-blocked-fg font-semibold" };
    case "skipped":
      return { label: "Not sent", tone: "bg-st-na-bg text-st-na-fg" };
    case "sending":
      return { label: "Sending", tone: "bg-st-progress-bg text-st-progress-fg" };
    case "pending": {
      if (e.sendAfter <= now) return { label: "About to send", tone: "bg-st-progress-bg text-st-progress-fg" };
      const at = when(e.sendAfter, timeZone, now);
      const partly = sentBy(e.deliveries);
      if (e.lastError) return { label: `Trying again at ${at}`, tone: "bg-st-progress-bg text-st-progress-fg" };
      return { label: partly ? `Sent${partly}; text waits until ${at}` : `Waits until ${at}`, tone: "bg-st-scheduled-bg text-st-scheduled-fg" };
    }
  }
}

/** Shows links as links, so a dry-run sign-in link can be opened from here. */
function WithLinks({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-2">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Entry({ entry: e, timeZone, now }: { entry: OutboxEntry; timeZone: string; now: Date }) {
  const b = badge(e, timeZone, now);
  const canRetry = e.status === "failed" || e.status === "skipped" || (e.status === "pending" && e.lastError !== null);
  const deliveries = (["sms", "email"] as const).filter((c) => e.deliveries[c]);
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("rounded-md px-2 py-0.5 text-xs whitespace-nowrap", b.tone)}>{b.label}</span>
        <span className="font-medium">{MESSAGE_LABELS[e.kind] ?? e.kind}</span>
        {e.unit && e.turnoverId ? (
          <Link href={`/turnovers/${e.turnoverId}`} className="underline-offset-2 hover:underline">
            {e.unit}
          </Link>
        ) : null}
        <span className="text-muted-foreground">to {e.recipientName}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatDateTime(e.createdAt, timeZone)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-muted-foreground">{e.message.sms}</p>
      {e.lastError ? <p className="mt-1 text-xs text-st-blocked-fg">{e.lastError}</p> : null}
      <div className="mt-1 flex flex-wrap items-start gap-3">
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer text-xs text-muted-foreground select-none">
            {e.isPreview ? "Preview the message (the link is added when it's sent)" : "Show the text and email"}
          </summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Text</p>
              <p className="mt-1 rounded-md bg-muted px-3 py-2 whitespace-pre-wrap">
                <WithLinks text={e.message.sms} />
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Email: {e.message.subject}</p>
              <p className="mt-1 max-h-80 overflow-y-auto rounded-md bg-muted px-3 py-2 text-xs whitespace-pre-wrap">
                <WithLinks text={e.message.text} />
              </p>
            </div>
          </div>
          {deliveries.length ? (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {deliveries.map((c) => {
                const d = e.deliveries[c]!;
                return (
                  <li key={c}>
                    {c === "sms" ? "Text" : "Email"} to {d.to ?? "?"}: {d.status === "sent" ? "sent" : `failed (${d.error})`},{" "}
                    {formatDateTime(new Date(d.at), timeZone)}
                    {d.providerId ? ` · ${d.providerId}` : ""}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </details>
        {canRetry ? <RetryButton id={e.id} label={e.status === "pending" ? "Try now" : "Send again"} /> : null}
      </div>
    </li>
  );
}

function Pager({ view, page, hasMore }: { view: OutboxView; page: number; hasMore: boolean }) {
  if (page === 1 && !hasMore) return null;
  const href = (p: number) => `/settings/messages?${new URLSearchParams({ ...(view === "all" ? {} : { view }), ...(p > 1 ? { page: String(p) } : {}) })}`;
  return (
    <div className="mt-3 flex justify-between text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="text-primary underline-offset-2 hover:underline">
          Newer
        </Link>
      ) : (
        <span />
      )}
      {hasMore ? (
        <Link href={href(page + 1)} className="text-primary underline-offset-2 hover:underline">
          Older
        </Link>
      ) : null}
    </div>
  );
}
