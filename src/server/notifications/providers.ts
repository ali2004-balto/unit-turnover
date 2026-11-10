/**
 * Where messages actually go.
 *
 * - Dry run (the default): nothing leaves the app. Each message is written to
 *   the server log and kept in full in the Outbox, links included, so you can
 *   try everything without a Twilio or Resend account.
 * - Live (NOTIFICATIONS_MODE=live): texts through Twilio, email through
 *   Resend, using the keys in the environment.
 *
 * Both services are called over their plain HTTPS APIs, so swapping either
 * for another provider means changing one function here.
 */
import { redactLinks } from "@/domain/notifications/messages";
import { CHANNELS, type Channel } from "@/domain/notifications/policy";

export interface OutgoingSms {
  to: string;
  body: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** The same key on a retry stops the provider sending it twice. */
  idempotencyKey?: string;
}

export interface MessageProvider {
  readonly mode: "dry-run" | "live";
  /** The ways it can send. A dry run pretends both are set up. */
  readonly channels: readonly Channel[];
  sendSms(message: OutgoingSms): Promise<{ id: string }>;
  sendEmail(message: OutgoingEmail): Promise<{ id: string }>;
}

/** A failed send. Permanent ones (a bad number, missing keys) aren't retried. */
export class SendError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "SendError";
  }
}

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export function notificationMode(env: Env = process.env): "dry-run" | "live" {
  return env.NOTIFICATIONS_MODE?.trim().toLowerCase() === "live" ? "live" : "dry-run";
}

/** What's set up, for the Outbox page. Never returns the keys themselves. */
export function notificationSetup(env: Env = process.env) {
  return {
    mode: notificationMode(env),
    sms: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM),
    email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
  };
}

/** Server logs on a real deployment never show working sign-in links. */
const logLine = (line: string) => console.info(process.env.NODE_ENV === "production" ? redactLinks(line) : line);

export function dryRunProvider(log: (line: string) => void = logLine): MessageProvider {
  let count = 0;
  const id = () => `dry-run-${Date.now().toString(36)}-${(count += 1)}`;
  return {
    mode: "dry-run",
    channels: CHANNELS,
    async sendSms(m) {
      log(`[dry run] Text to ${m.to}: ${m.body}`);
      return { id: id() };
    },
    async sendEmail(m) {
      log(`[dry run] Email to ${m.to}: ${m.subject}`);
      return { id: id() };
    },
  };
}

/** Rate limits and server errors are worth retrying; other refusals aren't. */
const isPermanent = (status: number) => status !== 429 && status < 500;

async function post(fetchImpl: Fetch, service: string, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, method: "POST", signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new SendError(`${service} couldn't be reached: ${error instanceof Error ? error.message : String(error)}`, false);
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = body.code ? ` (code ${String(body.code)})` : "";
    const detail = typeof body.message === "string" ? body.message : response.statusText;
    throw new SendError(`${service} said no${code}: ${detail}`, isPermanent(response.status));
  }
  return body;
}

export function twilioSms(config: { accountSid: string; authToken: string; from: string }, fetchImpl: Fetch = fetch) {
  return async (m: OutgoingSms): Promise<{ id: string }> => {
    const form = new URLSearchParams({ To: m.to, Body: m.body });
    // TWILIO_FROM can be a phone number or a messaging service ("MG...").
    if (config.from.startsWith("MG")) form.set("MessagingServiceSid", config.from);
    else form.set("From", config.from);
    const body = await post(fetchImpl, "Twilio", `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    return { id: String(body.sid ?? "") };
  };
}

export function resendEmail(config: { apiKey: string; from: string }, fetchImpl: Fetch = fetch) {
  return async (m: OutgoingEmail): Promise<{ id: string }> => {
    const body = await post(fetchImpl, "Resend", "https://api.resend.com/emails", {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(m.idempotencyKey ? { "Idempotency-Key": m.idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: config.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    return { id: String(body.id ?? "") };
  };
}

export function liveProvider(env: Env = process.env, fetchImpl: Fetch = fetch): MessageProvider {
  const sms =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM
      ? twilioSms({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM.trim() }, fetchImpl)
      : null;
  const email = env.RESEND_API_KEY && env.EMAIL_FROM ? resendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM.trim() }, fetchImpl) : null;
  return {
    mode: "live",
    channels: CHANNELS.filter((c) => (c === "sms" ? sms : email) !== null),
    async sendSms(m) {
      if (!sms) throw new SendError("Texts aren't set up: add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.", true);
      return sms(m);
    },
    async sendEmail(m) {
      if (!email) throw new SendError("Email isn't set up: add RESEND_API_KEY and EMAIL_FROM.", true);
      return email(m);
    },
  };
}

export function providerFromEnv(env: Env = process.env): MessageProvider {
  return notificationMode(env) === "live" ? liveProvider(env) : dryRunProvider();
}
