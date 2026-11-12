# Ops command center

- This app is becoming Ali's ops command center: same database, same logins, same 5-minute scheduler.
- Phase 1 is a read-only board for Ali, shown on a home TV at `/tv/<private link>`.
- Google data (calendar, Gmail label "Needs me", the DD Dates and Checklist sheet, a Feed sheet) will arrive later from an Apps Script that posts summaries to a secured endpoint. The app never stores Google tokens or email bodies.
- Read-only toward everything outside the app; it writes only its own tables and the turnover workflow.
- The TV page is server-rendered, works without JavaScript, uses plain CSS for old TV browsers, reloads every 5 minutes, and shows first names only, no contact details and no notes.
- Field staff never see anything beyond their own tasks.
- Migrations must be additive: merging to main migrates production during the Vercel build.
