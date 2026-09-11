import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runCheck, type CheckResult } from "../src/run.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #eef1f6; --surface: #fff; --surface-alt: #e6eaf1;
    --text: #182035; --text-muted: #5c6579; --text-faint: #8790a3;
    --border: #dbe0e9; --accent: #2d4fa3; --accent-soft: #e8edfa;
    --critical: #b8382c; --critical-soft: #fbe9e7;
    --soon: #a06a12; --soon-soft: #faf0dc;
    --later: #266a55; --later-soft: #e3f1ec;
    --shadow: 0 1px 2px rgba(24,32,53,.05), 0 8px 24px -12px rgba(24,32,53,.12);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12151d; --surface: #191d27; --surface-alt: #21262f;
      --text: #e8eaf0; --text-muted: #9aa2b4; --text-faint: #6b7385;
      --border: #2b3040; --accent: #7f9beb; --accent-soft: #212c47;
      --critical: #e08174; --critical-soft: #3a2320;
      --soon: #dcac53; --soon-soft: #3a2f18;
      --later: #6fc0a2; --later-soft: #1c332a;
      --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px -12px rgba(0,0,0,.5);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: "IBM Plex Sans", system-ui, sans-serif; padding: 0 20px; }
  .page { max-width: 760px; margin: 0 auto; padding: 40px 0 64px; display: flex; flex-direction: column; gap: 28px; }
  .mono { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
  header { display: flex; flex-direction: column; gap: 10px; }
  .eyebrow { display: flex; align-items: center; gap: 8px; font-family: "IBM Plex Mono", monospace; font-size: 12.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  .eyebrow .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--later); box-shadow: 0 0 0 3px var(--later-soft); }
  h1 { font-size: clamp(26px, 6vw, 34px); font-weight: 700; letter-spacing: -.01em; margin: 0; text-wrap: balance; }
  .lede { color: var(--text-muted); font-size: 14.5px; line-height: 1.55; max-width: 60ch; margin: 0; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .stat { background: var(--surface); padding: 14px 12px 16px; display: flex; flex-direction: column; gap: 4px; }
  .stat-value { font-family: "IBM Plex Mono", monospace; font-size: 21px; font-weight: 600; line-height: 1; }
  .stat-value.critical { color: var(--critical); }
  .stat-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; }
  section.group { display: flex; flex-direction: column; gap: 10px; }
  .group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding-inline: 2px; }
  .group-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
  .group-count { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--text-faint); }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .item { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; box-shadow: var(--shadow); }
  .urgency { font-family: "IBM Plex Mono", monospace; font-size: 12px; font-weight: 600; white-space: nowrap; padding: 5px 9px; border-radius: 6px; text-align: center; }
  .urgency.critical { color: var(--critical); background: var(--critical-soft); }
  .urgency.soon { color: var(--soon); background: var(--soon-soft); }
  .urgency.later { color: var(--later); background: var(--later-soft); }
  .item-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .item-title { font-size: 14.5px; font-weight: 500; line-height: 1.35; }
  .item-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12.5px; color: var(--text-muted); }
  .course-chip { font-family: "IBM Plex Mono", monospace; font-size: 11.5px; color: var(--accent); background: var(--accent-soft); padding: 2px 6px; border-radius: 4px; }
  .type-tag { color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; font-size: 11px; }
  .due { font-family: "IBM Plex Mono", monospace; font-size: 12.5px; color: var(--text-muted); }
  .item-link { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--accent); text-decoration: none; white-space: nowrap; border: 1px solid var(--border); padding: 7px 10px; border-radius: 7px; }
  .item-link:hover { border-color: var(--accent); background: var(--accent-soft); }
  .clear-note { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; font-size: 13px; color: var(--text-muted); }
  .clear-note .course-chip { color: var(--later); background: var(--later-soft); }
  .empty { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 14px; }
  footer { border-top: 1px solid var(--border); padding-top: 16px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-faint); line-height: 1.6; }
  footer code { font-family: "IBM Plex Mono", monospace; background: var(--surface-alt); padding: 1px 5px; border-radius: 4px; color: var(--text-muted); }
  @media (max-width: 560px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
    .item { grid-template-columns: 1fr; }
    .urgency, .item-link { justify-self: start; }
  }
</style>
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>`;
}

function unauthorizedPage(): string {
  return pageShell(
    "Deadline Watch",
    `<header>
      <div class="eyebrow"><span class="dot" style="background:var(--critical);box-shadow:0 0 0 3px var(--critical-soft)"></span> locked</div>
      <h1>Wrong or missing key</h1>
      <p class="lede">Add <code class="mono">?key=&lt;your CRON_SECRET&gt;</code> to the URL.</p>
    </header>`,
  );
}

function urgency(daysLeft: number): "critical" | "soon" | "later" {
  if (daysLeft <= 2) return "critical";
  if (daysLeft <= 7) return "soon";
  return "later";
}

function renderItem(e: CheckResult["events"][number]): string {
  const dueMs = e.timesort * 1000;
  const daysLeft = Math.ceil((dueMs - Date.now()) / 86400000);
  const cls = urgency(daysLeft);
  const label = daysLeft < 0 ? "overdue" : daysLeft === 0 ? "today" : daysLeft === 1 ? "1d left" : `${daysLeft}d left`;
  const due =
    new Date(dueMs).toLocaleString("en-GB", {
      timeZone: "Asia/Jakarta",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }) + " WIB";

  return `<div class="item">
    <span class="urgency ${cls}">${label}</span>
    <div class="item-body">
      <div class="item-title">${escapeHtml(e.name)}</div>
      <div class="item-meta">
        <span class="course-chip">${escapeHtml(e.course.shortname)}</span>
        <span class="type-tag">${escapeHtml(e.modulename)}</span>
        <span class="due mono">${due}</span>
      </div>
    </div>
    ${e.actionUrl ? `<a class="item-link" href="${escapeHtml(e.actionUrl)}" target="_blank" rel="noopener">Open →</a>` : "<span></span>"}
  </div>`;
}

function renderPage(result: CheckResult, windowDays: number): string {
  const now = Date.now();
  const events = [...result.events].sort((a, b) => a.timesort - b.timesort);
  const soonEvents = events.filter((e) => Math.ceil((e.timesort * 1000 - now) / 86400000) <= 7);
  const laterEvents = events.filter((e) => Math.ceil((e.timesort * 1000 - now) / 86400000) > 7);

  const coursesWithWork = new Set(events.map((e) => e.course.id));
  const clearCourses = result.matchedCourses.filter((c) => !coursesWithWork.has(c.id));

  const nearestDays = events.length ? Math.ceil((events[0].timesort * 1000 - now) / 86400000) : null;

  const generatedAt =
    new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Jakarta",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }) + " WIB";

  const body = `
  <header>
    <div class="eyebrow"><span class="dot"></span> scele · ${result.matchedCourses.length} course${result.matchedCourses.length === 1 ? "" : "s"} watched</div>
    <h1>Deadline Watch</h1>
    <p class="lede">Live from SCELE just now — <span class="mono">${generatedAt}</span>, next ${windowDays} days. Reload any time for a fresh check.</p>
  </header>

  <div class="stats">
    <div class="stat">
      <div class="stat-value${nearestDays !== null && nearestDays <= 2 ? " critical" : ""}">${nearestDays === null ? "—" : nearestDays <= 0 ? "now" : `${nearestDays}d`}</div>
      <div class="stat-label">Nearest due</div>
    </div>
    <div class="stat">
      <div class="stat-value">${events.length}</div>
      <div class="stat-label">Items open</div>
    </div>
    <div class="stat">
      <div class="stat-value">${coursesWithWork.size}</div>
      <div class="stat-label">Courses w/ work</div>
    </div>
    <div class="stat">
      <div class="stat-value">${clearCourses.length}</div>
      <div class="stat-label">Courses clear</div>
    </div>
  </div>

  ${
    events.length === 0
      ? `<div class="empty">Nothing due in the next ${windowDays} days. Enjoy it.</div>`
      : `
  ${
    soonEvents.length
      ? `<section class="group">
    <div class="group-head"><span class="group-title">Next 7 days</span><span class="group-count mono">${soonEvents.length} item${soonEvents.length === 1 ? "" : "s"}</span></div>
    <div class="list">${soonEvents.map(renderItem).join("\n")}</div>
  </section>`
      : ""
  }
  ${
    laterEvents.length
      ? `<section class="group">
    <div class="group-head"><span class="group-title">Later</span><span class="group-count mono">${laterEvents.length} item${laterEvents.length === 1 ? "" : "s"}</span></div>
    <div class="list">${laterEvents.map(renderItem).join("\n")}</div>
  </section>`
      : ""
  }`
  }

  ${
    clearCourses.length
      ? `<div class="clear-note">
    <span>Nothing due in the next ${windowDays} days for</span>
    ${clearCourses.map((c) => `<span class="course-chip">${escapeHtml(c.shortname)}</span>`).join("")}
  </div>`
      : ""
  }

  ${
    result.unmatchedNames.length
      ? `<div class="clear-note" style="color:var(--critical)">⚠️ No course matched: ${result.unmatchedNames.map(escapeHtml).join(", ")}</div>`
      : ""
  }

  <footer>
    <div>Source: SCELE's Timeline API, fetched fresh on every load of this page (not from the repo's diff cache) — takes a couple seconds.</div>
    <div>Only catches items with a due/close date on the Timeline. A deadline mentioned only in an announcement's text won't appear here — check Discord for those.</div>
  </footer>`;

  return pageShell("Deadline Watch", body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const key = typeof req.query.key === "string" ? req.query.key : "";
    if (key !== cronSecret) {
      res.status(401).setHeader("content-type", "text/html; charset=utf-8").send(unauthorizedPage());
      return;
    }
  }

  try {
    const result = await runCheck();
    const windowDays = Number(process.env.DEADLINE_WINDOW_DAYS ?? 14);
    res
      .status(200)
      .setHeader("content-type", "text/html; charset=utf-8")
      .setHeader("cache-control", "no-store")
      .send(renderPage(result, windowDays));
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .setHeader("content-type", "text/html; charset=utf-8")
      .send(pageShell("Deadline Watch", `<header><h1>Something broke</h1><p class="lede">${escapeHtml((err as Error).message)}</p></header>`));
  }
}
