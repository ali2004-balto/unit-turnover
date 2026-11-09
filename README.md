# Unit Turnover

A web app that replaces the **Unit_Turnover_Master_Tracker** Google Sheet. Each
unit turn (move-out to rent-ready and listed) moves through six steps:
Inspection → Scope of work → In-house work → Cleaning → Photos → Leasing
upload. Each person sees only their own tasks, and finishing a step hands the
unit to the next person automatically.

**Status: Phase 1 of 5** (data model, sheet import, workflow engine, tests).
There is no login and no editing screen yet. The one screen, **Master
Tracker**, is a read-only view for checking the app against your sheet.

| Phase | What it adds | State |
| --- | --- | --- |
| 1 | Data model, import from the sheet, demo data, workflow engine and tests | Done |
| 2 | Manager login, dashboard (board and list), create turnover, bulk add, settings | Next |
| 3 | Sign-in links for assignees, phone task screens, photos, inspection → scope | |
| 4 | Text and email notifications, reminders, escalation, going live | |
| 5 | Reports, Google Sheets export and sync, polish | |

## Run it on your computer

You need [Node.js](https://nodejs.org) 22.12 or newer. Nothing else: no
database to install and no accounts to create.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The first run creates a local database in
`.data/pglite` and fills it with demo data.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app at http://localhost:3000 (sets up the database first) |
| `npm test` | Run the tests |
| `npm run check` | Type-check, lint and test: run before every commit |
| `npm run db:reset` | Wipe the local database and reload the demo data (stop `npm run dev` first) |
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
  server/          Runs workflow commands in transactions; queries for screens
  app/             Next.js pages
  components/      Shared UI (status and flag colours from the sheet)
scripts/           npm run db:* commands
data/import/       Snapshot of your sheet used by the tests
```

## Environment variables

Copy `.env.example` to `.env.local`. Nothing is required for local
development.

| Variable | Needed | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Production | Postgres connection string (Supabase in production). Empty = local embedded database |
| `PGLITE_DATA_DIR` | No | Where the local database lives (default `.data/pglite`) |

Variables for sign-in links, file storage, email (Resend), text messages
(Twilio) and Google Sheets are added in the phases that use them.

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
- the importer;
- the demo data.
