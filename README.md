# Unit Turnover

A web app that replaces the **Unit_Turnover_Master_Tracker** Google Sheet. Each
unit turn (move-out to rent-ready and listed) moves through six steps:
Inspection → Scope of work → In-house work → Cleaning → Photos → Leasing
upload. Each person sees only their own tasks, and finishing a step hands the
unit to the next person automatically.

**Status: Phase 4 of 5.** Managers run everything from the dashboard. The
people who do each step (inspectors, crews, cleaners, photographers, leasing)
get a text or email with a link when it's their turn, and work from their
phones: their tasks, checklists, findings and photos. Morning reminders, a
managers' summary and alerts for stalled steps go out each day. It's ready to
deploy: see [Going live](docs/deploy.md).

| Phase | What it adds | State |
| --- | --- | --- |
| 1 | Data model, import from the sheet, demo data, workflow engine and tests | Done |
| 2 | Manager login, dashboard (board and list), turnover page, create and bulk add, settings | Done |
| 3 | Sign-in links, phone task screens, photos, inspection findings → draft scope | Done |
| 4 | Text and email notifications, reminders, escalation, going live | Done |
| 5 | Reports, Google Sheets export and sync, spreadsheet upload, polish | Next |

## Run it on your computer

You need [Node.js](https://nodejs.org) 22.12 or newer. Nothing else: no
database to install and no accounts to create.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and sign in as **manager@example.com** with the
password **turnover-demo**. The first run creates a local database in
`.data/pglite` and fills it with demo data.

### What you can do (Phase 2)

- **Dashboard** (`/`): the Summary tab's numbers as tiles (click one to filter),
  a board with a column per stage or a list, filters by property, person,
  stage, flag and text, and the pipeline and crew workload tables. It refreshes
  itself every 15 seconds.
- **Turnover page**: each step with who has it, its status, due date, booking,
  checklist and blockers, with buttons to start, book, mark done, block or
  unblock, mark N/A, send back, and reassign. You can edit, keep, drop or mark
  "to confirm" each scope item, then approve the scope. Every change appears in
  the timeline.
- **New turnover** (`/turnovers/new`): one unit, filled in from the property's
  default people and target date, or **Paste a list** (`Balwin 1-6, Nov 2`,
  rows copied from a spreadsheet, …) with a preview that flags problems.
- **Settings**: the due-soon window, default target, time zone, properties
  (with access notes), people, manager passwords, default assignees per
  property, and the workflow editor.
- **Master Tracker** (`/tracker`): your sheet's layout, calculated by the app.

### Trying the phone screens (Phase 3)

1. Sign in as the manager, open **Settings → People**, and press **Sign-in
   link** next to someone, for example Inspector A. On a turnover page,
   the step that's someone's turn has a **Sign-in link for …** button that
   opens straight to that task.
2. Open the link in a private window or another browser, ideally phone-sized.
   One browser can be signed in as the manager and as one task person at the
   same time.
3. As the inspector, open Rivergate 303. Add findings room by room ("needs
   work" or "just a note"), add photos, and press **Finish inspection**. The
   findings that need work appear on the manager's turnover page as the draft
   scope. Approve it, then open the in-house employee's link and tick off the
   checklist.

What each person sees:

- **Your tasks**: what's their turn now, most pressing first, plus anything a
  manager booked them for ahead of time (date only, no lockbox code yet).
- **A task**: address (tap for maps) and access notes, dates, the checklist
  with big checkboxes, photos (shrunk on the phone; the photographer's
  finals go up at full quality), links, and recent notes. **Mark complete**
  sits at the bottom; **More** has I've started, book a time, I'm blocked,
  send it back, and add a note.
- Nothing else: other people's tasks, and their own future steps that
  nobody booked, aren't available to them.

Sign-in links last 7 days, open only that person's tasks (never manager
screens), and stop working when you sign the person out or deactivate them
in Settings → People. Anyone can ask for a new link at `/signin` with their
phone number or email. Locally, the message with the link shows in
Settings → Messages and in the terminal running `npm run dev`.

### Texts, emails and reminders (Phase 4)

Locally the app runs in **dry-run mode**: nothing is sent, and every message
is kept in full, link included, under **Settings → Messages**. A "Messages: dry
run" badge at the top of the page says so.

1. Sign in as the manager and create a turnover. Open **Settings → Messages**:
   the inspector's text is there, sent a moment after you pressed Create.
2. Open its link in a private window, as the inspector would from their phone.
   Finish the inspection, approve the scope, and watch each handoff's message
   appear for the next person.
3. Press **Send this morning's messages now** to see the morning reminders and
   your summary straight away (normally they go at 7:00).

Who hears what:

- **People on steps** get a text (or email, as set in Settings → People) when
  a task becomes theirs, is booked, sent back, unblocked, given to someone
  else or no longer needed. Each has a fresh sign-in link that opens the task.
- **Each morning**, people with something on that day get one message:
  bookings today, tasks due today, tasks that went late yesterday, and
  yesterday's bookings that nobody marked done. Four or more things become
  counts plus the link.
- **Managers** get email: handoffs that need them (nobody assigned, send-backs,
  units complete) and a **morning summary** of what's blocked, late, due soon,
  stalled, booked today and done yesterday. They also get a **text** when a
  step is blocked, and in the morning when a booking today or tomorrow can't
  happen (the step before isn't done) or a step has had no updates for longer
  than its "alert me after" days.
- **Quiet hours:** no texts from 8 pm to 7 am; they wait for the morning.
  Emails go any time. Change both times in Settings → Messages.

Each reminder goes out once, on the morning it first applies. Failed sends are
retried after 1, 5, 15 and 60 minutes; a wrong number or missing setup isn't
retried. Settings → Messages shows why anything didn't go, with **Send again**.

### Managers

Managers sign in with an email and password. Ten wrong passwords in a row lock
the account for 15 minutes. To add a real manager (on your computer, or
against production with `DATABASE_URL` set):

```bash
npm run admin:create -- --email you@example.com --name "Your Name"
```

It prints a one-time password. Change it after signing in, under Settings →
People. Everyone else gets sign-in links instead of passwords. On a new
production server, the first manager can instead be created at `/setup` (see
[Going live](docs/deploy.md)).

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app at http://localhost:3000 (sets up the database first) |
| `npm test` | Run the unit and database tests |
| `npm run test:e2e` | Run the browser tests (starts its own server and database) |
| `npm run check` | Type-check, lint and test: run before every commit |
| `npm run admin:create -- --email … --name …` | Add a manager, or reset a manager's password |
| `npm run db:reset` | Wipe the local database and reload the demo data (refuses while `npm run dev` is running) |
| `npm run db:reset -- --empty` | Wipe it and start with no turnovers |
| `npm run db:import -- <file.csv>` | Import a CSV export of your Master Tracker tab |
| `npm run db:setup` | Bring the database up to date (Vercel runs it before each build) |
| `npm run db:migrate` | Apply database changes only |
| `npm run db:generate` | Write a new migration after changing `src/db/schema.ts` |

### The demo data

Your 17 real units with their real statuses, scope of work and notes, but with
made-up dates and placeholder people (Manager, Inspector A, Crew A/B/C,
Cleaner A, Photographer A, Leasing A). Three made-up Oakwood units show the
situations your sheet doesn't have yet: a blocked step (Oakwood 101), in-house
work skipped as N/A because the inspection found nothing (Oakwood 204), and a
send-back from Photos to In-house work (Oakwood 310). Every demo change was
played through the real workflow engine, so each unit has a full history.
Dates are relative to the day the demo was loaded; `npm run db:reset` refreshes
them.

### Importing your real sheet

1. In Google Sheets, open the **Master Tracker** tab.
2. File → Download → Comma-separated values (.csv).
3. Run the import (use the date you exported it, so notes like "Sat Nov 14"
   get the right year):

```bash
npm run db:reset -- --empty
```

```bash
npm run db:import -- ~/Downloads/Unit_Turnover_Master_Tracker\ -\ Master\ Tracker.csv --date 2026-11-09
```

Columns are found by their header names, so moved columns are fine. The import
keeps statuses, dates, scope (split into checklist items, with "(to confirm)"
items marked), notes and "Assigned to". It also reads bookings written in
notes, such as "Cleaning scheduled Sun Nov 8". It messages nobody, skips units
already in the app, and lists anything it couldn't read. A snapshot of your
sheet from 2026-11-09 is kept in `data/import/` and checked in the tests.

## How the workflow works

**Templates are data.** The six steps live in the database, not in code. Each
step has a name, order, role, whether it may be skipped (N/A), whether it runs
alongside the step before it, default due days, an escalation limit and a
default checklist. A new turnover copies its template, so editing a template
later never disturbs units in progress.

**Handoffs.** A step becomes *active* (someone's turn) when every step before
it is Done or N/A. Activating a step gives it a due date, notifies its
assignee and adds it to their task list. Steps marked "runs alongside the
previous step" start together, and the next step waits for all of them.

**Statuses** are the sheet's six: Not started, Scheduled, In progress,
Blocked, Done and N/A.

- **N/A:** managers can skip a step. Approving an empty scope skips in-house
  work automatically and the unit goes straight to cleaning.
- **Blocked:** needs a reason, alerts managers, and the clock keeps running.
  Unblocking restores the previous status and tells the assignee.
- **Scheduled:** a booking with a date and optional time. Managers can book a
  later step ahead (like Balwin's photos); the booked person sees it as
  upcoming and is told when the unit is ready for them.
- **Send-back:** the person on a later step (or a manager) sends the unit back
  to an earlier step with a reason. That step reopens with the reason added to
  its checklist. Steps in between reopen too unless the sender unticks them.
  The sender waits, and it counts toward the rework rate.
- **Reassign:** managers move a step to someone else. The old assignee loses
  it, and the new one is notified.
- **Scope → checklist:** approving the scope copies its items to the in-house
  work step as a checklist. The employee must tick off every item before
  marking work Done ("to confirm" items don't block it).

**Every change goes through one function** (`src/domain/workflow/engine.ts`),
which checks the rules and permissions and returns the new state plus timeline
entries and notifications. The server saves all three in one database
transaction (`src/server/workflow.ts`). A step can't be handed off without
its notification being queued, a double-tap on a slow connection is applied
once, and a change made from an out-of-date screen is refused.

**Messages go out from that outbox** (`src/server/notifications/`). Right
after a change, and every 5 minutes from Vercel's scheduler (every minute
inside `npm run dev`), the sender picks up what's due, works out how each
person hears, adds a fresh sign-in link and sends it. Two senders running at
once never take the same message. What each message says is in
`src/domain/notifications/messages.ts`; who gets what and when is in
`policy.ts` and `reminders.ts` next to it.

**Permissions are enforced by the engine on the server.** Assignees can only
act on steps assigned to them, and only when it's that step's turn. Marking
N/A, reassigning, editing checklists and changing dates are manager-only.

## The calculated columns

`src/domain/derived.ts` reproduces the sheet's four grey columns formula by
formula, and `src/domain/summary.ts` reproduces the Summary tab:

- **Current stage:** the first step not Done or N/A, or "Complete".
- **Days vacant:** move-out to today, never negative. Once complete it stops,
  at the latest step date. Blank without a move-out date.
- **Days in stage:** today minus the latest date on the row (move-out or
  any step date). Blank when complete or without a move-out date.
- **Flag**, in priority order: Complete, Blocked (any step), No target date,
  Overdue (after the target day), Due soon (within the due-soon window,
  target day included), On track.

The sheet relied on people typing step dates; the app records them itself.
Two things the sheet couldn't represent: a step marked N/A gets the date it
was skipped, and a send-back counts as a date on the row, so days in stage
restart from it. The Master Tracker page also marks blocked units that are
past their target date, which the sheet's flag hides.

## Project layout

```
src/
  domain/          Pure logic, no database: dates, statuses, calculated columns,
                   Summary tab, workflow engine and its rules, and what each
                   message says, who gets it and when (notifications/)
  db/              Schema, migrations, database connection, settings, seed data
  import/          Master Tracker CSV parser and importer
  server/          Runs workflow commands in transactions; sign-in and links;
                   settings; findings; files and photos (local or Supabase);
                   the message sender and morning run (notifications/);
                   first-time setup; queries for screens
  app/             Next.js pages: (manager)/ for the dashboard, turnovers and
                   settings; (tasks)/ for the phone task screens; login/,
                   signin/, setup/ and l/ (sign-in links); api/files for
                   photos; api/cron/tick for the scheduler
  components/      Shared UI (status and flag colours from the sheet)
  instrumentation.ts  Checks for messages every minute during development
scripts/           npm run db:* and admin:create commands
tests/e2e/         Browser tests
docs/deploy.md     Going live on Vercel and Supabase
data/import/       Snapshot of your sheet used by the tests
```

## Environment variables

Copy `.env.example` to `.env.local`. Nothing is required for local
development. [`.env.example`](.env.example) describes each one, and
[Going live](docs/deploy.md) says where to get the values.

| Variable | Needed | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Production | Postgres connection string (Supabase's transaction pooler). Empty = local embedded database |
| `APP_URL` | Production | The app's address, used in links in texts and emails |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Production | Photo storage. Empty = a local folder |
| `CRON_SECRET` | Production | Lets Vercel's scheduler run reminders and retries |
| `SETUP_TOKEN` | First deploy | Lets `/setup` create the first manager; remove it afterwards |
| `NOTIFICATIONS_MODE` | Going live | `dry-run` (default: nothing is sent) or `live` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Live texts | Twilio account and the number texts come from |
| `RESEND_API_KEY`, `EMAIL_FROM` | Live email | Resend key and the sender address on your verified domain |
| `SUPABASE_BUCKET`, `PGLITE_DATA_DIR`, `FILES_DIR`, `IN_PROCESS_TICK` | No | Rarely needed; see `.env.example` |

## Tests

```bash
npm test
```

They cover:

- the calculated columns, branch by branch against the sheet's formulas;
- all 17 rows of your sheet and its Summary tab;
- the workflow engine: sequential handoff, parallel steps and the join, N/A
  skips, blocked, send-back, reassignment, booking, overdue and permissions;
- the database layer on a real (embedded) Postgres: transactions,
  double-taps, conflicting edits;
- sign-in sessions, passwords and lockout; sign-in links (expiry, revoking,
  requests and their limit);
- inspection findings drafting the scope, and who can add, see and remove
  photos;
- what each person's task list shows, and that tasks aren't visible to
  anyone else;
- the dashboard's filters, the paste-a-list reader and the settings rules
  (for example, the app always keeps one active manager);
- the importer;
- the demo data;
- every message's wording, length and plain characters; who hears by text or
  email; quiet hours (including the night the clocks change);
- the morning rules: each reminder sent once, on the right morning, and what
  counts as "no updates";
- the sender: links that open the task, texts held overnight, retries and
  giving up, two senders at once, a crashed send picked up again, placeholder
  people never texted for real;
- the Twilio and Resend requests, and Supabase Storage (against a stand-in);
- uploads straight to storage (only addresses given out for that step, only
  files that really arrived), and the streamed photo zip;
- first-time setup (once only, needs the setup code).

```bash
npm run test:e2e
```

These drive a real browser: signing in, the dashboard, creating a turnover
and walking it through every step to Complete (including a block and a
send-back), and pasting a list. Then the whole thing again from the phones:
the inspector adds findings with a photo, the manager approves the scope,
and the crew, cleaner, photographer (full-quality photo and a folder link)
and leasing (zip download) each finish their step on their own phone, plus
checks that people can't open each other's tasks. And that creating a
turnover sends the inspector a text whose link opens the inspection. They use their own server on port 3100 and
their own database, so they don't touch your data. On a new computer, run
`npx playwright install chromium` once first.
