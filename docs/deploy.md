# Going live

How to put Unit Turnover on the internet for your team: the app on **Vercel**,
the database and photos on **Supabase**, texts through **Twilio** and email
through **Resend**. Plan on an afternoon for the first three, plus however
long Twilio and Resend take to approve your number and domain (start those
early; it can be a few days).

You'll go live in two stages:

1. **Dry run.** Everything works, but texts and emails aren't sent. Each one
   shows in Settings → Messages, so you can check the wording and try the links.
2. **Live.** Switch messages on once the team's real phone numbers are in.

## 1. Supabase: the database and photo storage

1. Create a project at [supabase.com](https://supabase.com). For data kept in
   Canada, choose the **Canada (Central)** region. Save the database password
   it asks you to set. Letters and numbers only is simplest: symbols like `@`
   or `#` have to be specially encoded in the connection string.
2. Copy three things (keep them somewhere safe, like a password manager):
   - **The database connection string.** Click **Connect** at the top of the
     project page and copy the **Transaction pooler** string (it ends in
     `:6543/postgres`). Put your database password in place of `[YOUR-PASSWORD]`.
   - **The project URL**, like `https://abcdefgh.supabase.co` (Project Settings → Data API).
   - **The secret key** (Project Settings → API Keys): the `sb_secret_…` key, or
     the older `service_role` key. It can read and change everything, so it only
     ever goes in Vercel's settings, never in an email or a chat.

You don't need to create any tables or storage buckets: the app does that on
its first deploy. The photo bucket it makes is private; photos are only ever
shown through links that last five minutes, after the app checks who's asking.

Supabase's paid plan includes daily backups of the database. Turn on the paid
plan before you rely on the app.

## 2. Vercel: the app

1. Sign in to [vercel.com](https://vercel.com) with GitHub, and use the **Pro**
   plan: the free plan is for non-commercial use only, and the Pro plan lets
   the reminders run every 5 minutes.
2. **Add New → Project**, and import `ali2004-balto/unit-turnover`. If it isn't
   listed, give Vercel's GitHub app access to that repository.
3. Before the first deploy, open **Environment Variables** and add the settings
   below for the **Production** environment.
4. Deploy. Near the top of the build log you should see "Database ready…" and
   "Created the private bucket for photos."
5. Under **Settings → Domains**, add the address you want (for example
   `turnover.yourcompany.com`) and follow the DNS instructions. Then set
   `APP_URL` to that address and redeploy, so links in texts use it.

### Settings for Vercel

Make up the two random values with a password manager's generator (32+ characters).

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Supabase's Transaction pooler connection string |
| `SUPABASE_URL` | Supabase's project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase's secret key |
| `APP_URL` | The app's address, e.g. `https://turnover.yourcompany.com` (no slash at the end) |
| `SETUP_TOKEN` | A random value, for creating the first manager (remove it afterwards) |
| `CRON_SECRET` | A random value. Vercel's scheduler uses it to run reminders |
| `NOTIFICATIONS_MODE` | `dry-run` for now |

Later, for live messages (step 6): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM`, `RESEND_API_KEY`, `EMAIL_FROM`, and `NOTIFICATIONS_MODE=live`.
Every setting is also described in [`.env.example`](../.env.example).

After changing any setting, redeploy (Deployments → ⋯ → Redeploy) for it to take effect.

**Preview deployments.** Vercel also builds every branch you push. Those builds
fail unless they have their own database settings. That's on purpose: a
preview must never touch the real data. Either ignore them, or give the
Preview environment a separate Supabase project.

## 3. Your account and your team

1. Go to `https://<your address>/setup`, enter the `SETUP_TOKEN`, and create
   your manager account. Then delete `SETUP_TOKEN` from Vercel and redeploy.
2. **Settings → People**: add everyone, with their mobile number and email, and
   choose how each hears from the app (text, email, both). Other managers get the
   Manager role; give them a password from their row.
3. **Settings → Default assignees**: who does each step at each property.
4. **Settings → Properties** and **Settings → General**: check they match your sheet.

## 4. Bring in the current sheet (optional)

1. In Google Sheets, open the Master Tracker tab: File → Download → Comma-separated values.
2. In the app, **Settings → Google Sheet → Import from your sheet**: choose the
   file and press **Check the file**. You see exactly what it would add, which
   units are already in the app, and anything worth a look.
3. Press **Import**. Nobody is sent a message. Units already in the app are
   skipped, so it's safe to do again.

Then add phone numbers for any new in-house employees it found in "Assigned to".

### Keep your Google Sheet showing the tracker (optional)

If people still like looking at the sheet, it can keep showing the Master
Tracker from the app:

1. In the app, **Settings → Google Sheet → Make a link**, and copy the formula.
2. In your Google Sheet, add a tab (for example "From the app"), click cell A1
   and paste the formula.

Google Sheets fills the tab and refreshes it about once an hour, with the
columns where they are on the Master Tracker tab, so the Summary tab's
formulas can point at it. Make changes in the app, not in that tab. Anyone with
the link can read the tracker, so keep it inside the sheet; **Make a new link**
stops the old one at once.

## 5. Try it in dry-run mode

1. Create a turnover for a test unit, with yourself or a colleague as the inspector.
2. Open **Settings → Messages**: the inspector's text is there in full. Open its
   link on a phone and walk the unit through every step.
3. The next morning after 7:00, check that the morning reminders and your
   summary are in Messages.
4. Upload a few photos, and download the zip from the leasing step.

## 6. Switch messages on

**Email (Resend)**

1. At [resend.com](https://resend.com), **Domains → Add domain**, and add the DNS
   records it shows at your domain host. Wait until it says Verified.
2. Create an API key (sending access is enough).
3. In Vercel: `RESEND_API_KEY`, and `EMAIL_FROM` such as
   `Unit Turnover <turnover@yourcompany.com>` (on the verified domain).

**Texts (Twilio)**

1. At [twilio.com](https://www.twilio.com), buy a local number that can send SMS
   (a 604, 778 or 236 number). Twilio may ask for your business details before
   texts are delivered reliably; do that straight away, since it can take days.
2. From the Twilio console's home page, copy the Account SID and Auth Token.
3. In Vercel: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` (the
   number, like `+16045550123`).

Then set `NOTIFICATIONS_MODE` to `live` and redeploy. The "Messages: dry run"
badge disappears from the top of the page. Send yourself a sign-in link from the
sign-in page to check a text arrives.

Email can go live before texts. Until the Twilio settings are in, people who
chose texts get email instead, and Settings → People and Settings → Messages
say so. Anyone with no email address can't be reached until texts are added:
their messages show as failed in Messages, with what to fix.

## Day to day

- **Someone didn't get a text?** Settings → Messages shows every message: when it
  went, by text or email, or why it didn't (no phone number, a wrong number, they
  chose no messages). Fix the problem and press **Send again**.
- **Quiet hours.** No texts between 8 pm and 7 am; they go at 7. Emails go any
  time. Change it in Settings → Messages.
- **Someone replied STOP.** Twilio blocks further texts to them, and their
  messages show as failed. Switch them to email in Settings → People.
- **A lost phone.** Settings → People → Sign out, on their row. Their sign-in
  links stop working; they get a new one with their next task.

## If something goes wrong

| What you see | What it means |
| --- | --- |
| The build stops with "DATABASE_URL isn't set" | Add it for the environment being built (Production or Preview). |
| "Photo storage isn't set up yet" when adding photos | `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing. Add it and redeploy. |
| Messages show "Texts aren't set up yet" | Texts aren't on, and that person has no email address. Give them one in Settings → People, then **Send again**. Or add the Twilio settings and redeploy. |
| No morning reminders | Check `CRON_SECRET` is set. Vercel's project page, under Settings → Cron Jobs, shows each run. |
| Links in texts point to a `vercel.app` address | Set `APP_URL` and redeploy. |
