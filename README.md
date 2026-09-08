# SCELE Deadline Bot

Logs into [SCELE](https://scele.cs.ui.ac.id) (FASILKOM UI's Moodle), pulls upcoming
due dates for a set of courses you choose, and posts a report to a Discord webhook.
Runs on a Vercel Cron once a day (Hobby-plan crons are daily-max), or on demand from your machine.

How it works: it logs in with a plain username/password POST (SCELE has no CAS/SSO),
then calls Moodle's own dashboard-timeline API (`core_calendar_get_action_events_by_timesort`)
to get due dates — the same data that powers the "Timeline" block on your SCELE dashboard.

## 1. Local setup

```
npm install
cp .env.example .env.local
```

Fill in `.env.local`:
- `SCELE_USERNAME` / `SCELE_PASSWORD` — your SCELE login.
- `MONITORED_COURSES` — comma-separated substrings to match against your course names,
  e.g. `MONITORED_COURSES=Struktur Data,Jaringan Komputer`. Run this first to check names:

  ```
  npm run list-courses
  ```

- `DISCORD_WEBHOOK_URL` — optional for local testing; leave blank to just print to the
  terminal. Create one in Discord: Channel Settings → Integrations → Webhooks → New Webhook.

Then run a check:

```
npm run check
```

## 2. Deploy to Vercel (so it runs even when your PC is off)

```
npm i -g vercel      # if you don't have it yet
vercel link           # creates/links the Vercel project
vercel env add SCELE_USERNAME
vercel env add SCELE_PASSWORD
vercel env add MONITORED_COURSES
vercel env add DISCORD_WEBHOOK_URL
vercel env add CRON_SECRET       # any random string — locks down the cron endpoint
vercel deploy --prod
```

`vercel env add` prompts interactively and does not echo the value back, so secrets never
end up in your shell history. Vercel Cron automatically sends
`Authorization: Bearer <CRON_SECRET>` when calling `/api/check-deadlines`, so once
`CRON_SECRET` is set, nobody else can trigger your bot by hitting the URL directly.

The schedule lives in `vercel.ts` (`0 0 * * *` = 00:00 UTC = 07:00 WIB daily). Hobby-plan
projects are capped at one cron run per day; edit and redeploy to change the time, or
upgrade to Pro to run more often. To trigger a run manually after deploying:

```
curl -H "Authorization: Bearer <your CRON_SECRET>" https://<your-project>.vercel.app/api/check-deadlines
```

## Notes / limitations

- **No dedup**: every run reports *all* upcoming items in the window (default 14 days), not
  just new ones — so you'll see the same deadline again on the next run(s) as it approaches.
  This is intentional for v1 (simplicity, no extra storage to provision); if the repetition
  gets noisy, a follow-up would add a small state store (e.g. Vercel Blob) to only notify on
  new events or when they cross urgency thresholds (7d/3d/1d).
- **Course matching** is substring-based against full name + short name — check
  `npm run list-courses` output if a course silently doesn't match.
- **What counts as a deadline**: anything Moodle's own Timeline API surfaces — assignments,
  quizzes, and other activities with a due/close date. It won't catch a deadline mentioned
  only in an announcement's text.
- If SCELE ever adds real SSO/CAPTCHA, the login step in `src/scele.ts` will need rework.
