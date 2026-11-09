# Unit Turnover

A web app that replaces the **Unit_Turnover_Master_Tracker** Google Sheet. Each
unit turn (move-out to rent-ready and listed) moves through six steps:
Inspection → Scope of work → In-house work → Cleaning → Photos → Leasing
upload. Each person sees only their own tasks, and finishing a step hands the
unit to the next person automatically.

**Status: Phase 3 of 5.** Managers run everything from the dashboard. The
people who do each step (inspectors, crews, cleaners, photographers, leasing)
sign in with a link and work from their phones: their tasks, checklists,
findings and photos. Texts and emails aren't sent yet (Phase 4); until then a
manager copies a person's link and sends it themselves.

| Phase | What it adds | State |
| --- | --- | --- |
| 1 | Data model, import from the sheet, demo data, workflow engine and tests | Done |
| 2 | Manager login, dashboard (board and list), turnover page, create and bulk add, settings | Done |
| 3 | Sign-in links, phone task screens, photos, inspection findings → draft scope | Done |
| 4 | Text and email notifications, reminders, escalation, going live | Next |
| 5 | Reports, Google Sheets export and sync, polish | |

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
phone number or email; in development the link is printed in the terminal
running `npm run dev`, because texts aren't sent until Phase 4.

### Managers

Managers sign in with an email and password. Ten wrong passwords in a row lock
the account for 15 minutes. To add a real manager (on your computer, or
against production with `DATABASE_URL` set):

```bash
npm run admin:create -- --email you@example.com --name "Your Name"
```

It prints a one-time password. Change it after signing in, under Settings →
People. Everyone else will get sign-in links instead of passwords
(Phase 3).

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
| `npm run db:migrate` | Apply database changes (production deploys) |
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
once, and a change made from an out-of-date screen is refused. Notifications
wait in an outbox table until the sender (Phase 4) delivers them.

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
                   Summary tab, workflow engine and its rules
  db/              Schema, migrations, database connection, settings, seed data
  import/          Master Tracker CSV parser and importer
  server/          Runs workflow commands in transactions; sign-in and links;
                   settings; findings; files and photos; queries for screens
  app/             Next.js pages: (manager)/ for the dashboard, turnovers and
                   settings; (tasks)/ for the phone task screens; login/,
                   signin/ and l/ (sign-in links); api/files for photos
  components/      Shared UI (status and flag colours from the sheet)
scripts/           npm run db:* and admin:create commands
tests/e2e/         Browser tests
data/import/       Snapshot of your sheet used by the tests
```

## Environment variables

Copy `.env.example` to `.env.local`. Nothing is required for local
development.

| Variable | Needed | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Production | Postgres connection string (Supabase in production). Empty = local embedded database |
| `PGLITE_DATA_DIR` | No | Where the local database lives (default `.data/pglite`) |
| `APP_URL` | Production | The app's address, used in sign-in links, e.g. `https://turnover.example.com`. Locally it's worked out from the browser's address |
| `FILES_DIR` | No | Where uploaded photos are kept locally (default `.data/uploads`). Production will use Supabase Storage (Phase 4) |

Variables for email (Resend), text messages (Twilio), Supabase Storage and
Google Sheets are added in the phases that use them.

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
- the demo data.

```bash
npm run test:e2e
```

These drive a real browser: signing in, the dashboard, creating a turnover
and walking it through every step to Complete (including a block and a
send-back), and pasting a list. Then the whole thing again from the phones:
the inspector adds findings with a photo, the manager approves the scope,
and the crew, cleaner, photographer (full-quality photo and a folder link)
and leasing (zip download) each finish their step on their own phone, plus
checks that people can't open each other's tasks. They use their own server on port 3100 and
their own database, so they don't touch your data. On a new computer, run
`npx playwright install chromium` once first.
