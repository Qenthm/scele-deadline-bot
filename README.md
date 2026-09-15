# SCELE Deadline Bot

Logs into [SCELE](https://scele.cs.ui.ac.id) (FASILKOM UI's Moodle), tracks due dates for a
set of courses you choose, and pings a Discord webhook — **only when something actually
changes**: a new assignment/quiz appears, a due date moves, or one gets cancelled. Runs
3x/day via GitHub Actions. A Vercel deployment is also included for an on-demand full report.

How it works: it logs in with a plain username/password POST (SCELE has no CAS/SSO), then
calls Moodle's own dashboard-timeline API (`core_calendar_get_action_events_by_timesort`) —
the same data behind the "Timeline" block — to get due dates. Each scheduled run diffs the
result against the last-known state (committed to this repo as `state/seen-events.json`) and
only messages Discord about what's new, moved, or removed.

It also watches full course content (every page, file, and link — not just items with a due
date) via Moodle's `core_course_get_contents` service, diffed per-course against
`state/course-content/<courseId>.json`. This catches things the deadline-only Timeline view
never surfaces, e.g. a new reading/lesson page with no due date attached. Set
`WATCH_COURSE_CONTENT=false` to disable. A course's first-ever run just populates its state
file without posting (otherwise the whole course would dump into Discord at once).

On top of that, it watches each course's announcement-style forums (Announcements, Class
Administration, a one-off "Lab N" notice, ...) for new discussion threads, diffed per-course
against `state/forum-posts/<courseId>.json`. Unlike the plain content watch above, a new
discussion also gets its opening post's body text pulled in and posted to Discord — this is
what catches something like a lab instruction with no due date configured anywhere in
Moodle, only mentioned in the announcement text. Graded "post your own discussion" forums
(weekly participation forums where every student starts their own thread) are deliberately
excluded — see `isAnnouncementForum()` in `src/scele.ts` — otherwise every classmate's
submission would ping Discord. Set `WATCH_FORUM_POSTS=false` to disable (implied by
`WATCH_COURSE_CONTENT=false`, since it reuses that loop's course-content fetch). Same
first-run-is-silent behavior as the content watch.

It also sends a one-time **"due soon" reminder** ping for each deadline as it enters the
last `DEADLINE_REMINDER_DAYS` days (default 2) before its due date — independent of the
new/moved/removed diff above, so it fires even on a run where nothing changed. Tracked per
event id in `state/reminded-deadlines.json` so it only pings once per deadline rather than
on every run while it sits inside the window. Unlike the content/forum watches, there's no
"first run silent" behavior here: a deadline that's already due soon the first time this
runs is exactly what's worth pinging about.

**Section filtering**: a course that runs parallel sections (e.g. Komputer & Masyarakat's
A/B/C/D) posts near-duplicate items per section. `belongsToMySection()` in `src/scele.ts`
keeps only the student's own section — add an entry to the `MY_SECTION` map there for any
other course that needs it. Applies to Timeline events, course content, and forum posts
alike; anything without a "SECTION X:"-style tag in its name is shared and always kept.

**Deadlines with no calendar entry**: some courses never put a due date on Moodle's calendar
at all. Komputasi Awan announces each week's lab only as a forum post ("Lab N, <date>"), due
the following Monday 23:59 WIB by course convention — there's no assignment/quiz object to
read a due date from. `LAB_DEADLINE_PATTERNS` in `src/scele.ts` matches forums like that per
course id; `deriveLabDeadline()` computes the Monday deadline from the post's own timestamp,
and the result is merged into the same event list as real Timeline deadlines — so it gets a
"new deadline" ping, due-soon reminders, and moved/cancelled detection exactly like any other
assignment. Add an entry there for another course that announces deadlines the same way.

## 1. Local setup

```
npm install
cp .env.example .env.local
```

Fill in `.env.local`:
- `SCELE_USERNAME` / `SCELE_PASSWORD` — your SCELE login.
- `MONITORED_COURSES` — comma-separated course ids (from a `course/view.php?id=NNNN` URL,
  exact match) or name/code substrings, case-insensitive. Run this first to check:

  ```
  npm run list-courses
  ```

- `DISCORD_WEBHOOK_URL` — Channel Settings → Integrations → Webhooks → New Webhook.
- `DISCORD_USER_ID` — optional; if set, every message pings you (enable Developer Mode in
  Discord, right-click your name → Copy User ID).

Two ways to run it locally:

```
npm run check         # full report of everything upcoming, every time (no memory)
npm run check:diff    # the "only tell me what changed" mode, using state/seen-events.json
```

## 2. Scheduled runs — GitHub Actions (primary)

`.github/workflows/check-deadlines.yml` runs `npm run check:diff`-equivalent logic 3x/day
(00:00, 08:00, 16:00 UTC = 07:00, 15:00, 23:00 WIB) via `workflow_dispatch`/`schedule`, then
commits `state/seen-events.json` back to the repo if it changed. GitHub Actions has no
per-day cron cap, unlike Vercel Hobby, which is why scheduling lives here instead.

Required repo secrets (Settings → Secrets and variables → Actions, or `gh secret set`):
`SCELE_USERNAME`, `SCELE_PASSWORD`, `MONITORED_COURSES`, `DISCORD_WEBHOOK_URL`,
`DISCORD_USER_ID` (optional).

To change the schedule, edit the `cron:` line in the workflow (UTC) and push. To run it
immediately without waiting: Actions tab → "SCELE deadline check" → Run workflow, or
`gh workflow run check-deadlines.yml`.

## 3. Vercel deployment (secondary — on-demand only)

Kept around for a manual full-report check anytime, independent of the diff state:

```
npm i -g vercel
vercel link
vercel env add SCELE_USERNAME production
vercel env add SCELE_PASSWORD production
vercel env add MONITORED_COURSES production
vercel env add DISCORD_WEBHOOK_URL production
vercel env add CRON_SECRET production   # any random string — locks down the endpoint
vercel deploy --prod
```

`vercel env add` prompts interactively and doesn't echo the value, so secrets never hit
shell history. There's intentionally **no** `crons` entry in `vercel.ts` — GitHub Actions
owns scheduling, so running both would double-post. Trigger a manual full report with:

```
curl -H "Authorization: Bearer <your CRON_SECRET>" https://<your-project>.vercel.app/api/check-deadlines
```

Or just open **`https://<your-project>.vercel.app/deadlines?key=<your CRON_SECRET>`** in a
browser — a live-rendered page instead of raw JSON, good for bookmarking or saving as a
phone home-screen shortcut. Same `runCheck()` call underneath (so it also posts the usual
report to Discord on every load), fetched fresh from SCELE on each request — no caching.

## Notes / limitations

- **Course matching** is by numeric id (exact) or substring against full/short name — check
  `npm run list-courses` if a course silently doesn't match.
- **What counts as a deadline**: anything Moodle's Timeline API surfaces — assignments,
  quizzes, and other activities with a due/close date — plus any course listed in
  `LAB_DEADLINE_PATTERNS` (`src/scele.ts`), whose deadline is derived from a forum post
  instead. A deadline mentioned only in an announcement's text otherwise won't be caught
  unless that course is added to that map.
- **"Removed/cancelled" detection**: an event only counts as removed if it was still in the
  future last time it was seen — one that simply passed its due date and fell out of the
  window is not flagged.
- If SCELE ever adds real SSO/CAPTCHA, the login step in `src/scele.ts` will need rework.
