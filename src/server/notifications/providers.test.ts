import { describe, expect, it } from "vitest";
import { notificationSetup, providerFromEnv, resendEmail, SendError, twilioSms } from "./providers";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const TWILIO = { accountSid: "AC123", authToken: "token", from: "+16045550000" };
const TEXT = { to: "+16045550101", body: "Acadian 203: Inspection is ready for you." };

describe("Twilio", () => {
  it("sends a text from the company number", async () => {
    const calls: Call[] = [];
    expect(await twilioSms(TWILIO, fakeFetch(201, { sid: "SM1" }, calls))(TEXT)).toEqual({ id: "SM1" });
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(calls[0].init.method).toBe("POST");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Basic ${Buffer.from("AC123:token").toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toEqual({ To: TEXT.to, Body: TEXT.body, From: "+16045550000" });
  });

  it("can send from a messaging service instead", async () => {
    const calls: Call[] = [];
    await twilioSms({ ...TWILIO, from: "MG0123" }, fakeFetch(201, { sid: "SM1" }, calls))(TEXT);
    expect(new URLSearchParams(String(calls[0].init.body)).get("MessagingServiceSid")).toBe("MG0123");
  });

  it("gives up on a bad number, but retries an outage or a rate limit", async () => {
    const refused = twilioSms(TWILIO, fakeFetch(400, { code: 21211, message: "Invalid 'To' Phone Number" }))(TEXT);
    await expect(refused).rejects.toEqual(new SendError("Twilio said no (code 21211): Invalid 'To' Phone Number", true));
    await expect(twilioSms(TWILIO, fakeFetch(503, {}))(TEXT)).rejects.toMatchObject({ permanent: false });
    await expect(twilioSms(TWILIO, fakeFetch(429, {}))(TEXT)).rejects.toMatchObject({ permanent: false });
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(twilioSms(TWILIO, offline)(TEXT)).rejects.toEqual(new SendError("Twilio couldn't be reached: fetch failed", false));
  });
});

describe("Resend", () => {
  it("sends a plain-text email, with a key that stops a retry sending it twice", async () => {
    const calls: Call[] = [];
    const send = resendEmail({ apiKey: "re_123", from: "Unit Turnover <turnover@example.com>" }, fakeFetch(200, { id: "em_1" }, calls));
    expect(await send({ to: "manager@example.com", subject: "Morning summary", text: "Hello", idempotencyKey: "n1-email" })).toEqual({ id: "em_1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("authorization")).toBe("Bearer re_123");
    expect(headers.get("idempotency-key")).toBe("n1-email");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: "Unit Turnover <turnover@example.com>",
      to: ["manager@example.com"],
      subject: "Morning summary",
      text: "Hello",
    });
  });
});

describe("choosing the provider", () => {
  it("does a dry run unless told to go live", () => {
    expect(providerFromEnv({}).mode).toBe("dry-run");
    expect(providerFromEnv({ NOTIFICATIONS_MODE: "LIVE" }).mode).toBe("live");
  });

  it("says what's missing when live keys aren't set", async () => {
    const live = providerFromEnv({ NOTIFICATIONS_MODE: "live", RESEND_API_KEY: "re_123", EMAIL_FROM: "turnover@example.com" });
    await expect(live.sendSms(TEXT)).rejects.toMatchObject({ permanent: true, message: expect.stringContaining("TWILIO_ACCOUNT_SID") });
    expect(live.channels).toEqual(["email"]);
    expect(providerFromEnv({}).channels).toEqual(["sms", "email"]);
    expect(notificationSetup({ NOTIFICATIONS_MODE: "live", RESEND_API_KEY: "re_123", EMAIL_FROM: "turnover@example.com" })).toEqual({
      mode: "live",
      sms: false,
      email: true,
    });
  });
});
