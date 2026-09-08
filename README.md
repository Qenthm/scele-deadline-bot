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

## Notes / limitations

- **Course matching** is by numeric id (exact) or substring against full/short name — check
  `npm run list-courses` if a course silently doesn't match.
- **What counts as a deadline**: anything Moodle's Timeline API surfaces — assignments,
  quizzes, and other activities with a due/close date. It won't catch a deadline mentioned
  only in an announcement's text.
- **"Removed/cancelled" detection**: an event only counts as removed if it was still in the
  future last time it was seen — one that simply passed its due date and fell out of the
  window is not flagged.
- If SCELE ever adds real SSO/CAPTCHA, the login step in `src/scele.ts` will need rework.
