import { existsSync } from "node:fs";
import { SceleClient, matchCourses } from "./scele.js";
import {
  buildEmbeds,
  buildChangedEmbeds,
  buildRemovedEmbeds,
  buildContentAddedEmbeds,
  buildContentChangedEmbeds,
  buildContentRemovedEmbeds,
  postToDiscord,
  type DiscordEmbed,
} from "./discord.js";
import { loadState, saveState, loadContentState, saveContentState } from "./state.js";
import { diffEvents } from "./diff.js";
import { diffCourseContent } from "./content-diff.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}. See .env.example.`);
  return value;
}

export interface DiffCheckResult {
  posted: boolean;
  added: number;
  changed: number;
  removed: number;
  contentAdded: number;
  contentChanged: number;
  contentRemoved: number;
}

// The "only tell me what's new" mode: diffs this run's events against the state file
// committed by the last run, and only posts to Discord if something actually changed.
// Meant to be run often (e.g. every 15 min via GitHub Actions) without spamming the channel.
export async function runDiffCheck(): Promise<DiffCheckResult> {
  const baseUrl = process.env.SCELE_BASE_URL ?? "https://scele.cs.ui.ac.id";
  const username = requireEnv("SCELE_USERNAME");
  const password = requireEnv("SCELE_PASSWORD");
  const monitored = (process.env.MONITORED_COURSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Wider than the manual/full-report default: Moodle's per-call event cap (50) is what
  // actually limits cost here, not the window, so casting further out catches additions
  // (e.g. a quiz posted for next month) as soon as they appear instead of only once
  // they're within two weeks.
  const windowDays = Number(process.env.DEADLINE_WINDOW_DAYS ?? 30);
  const statePath = process.env.STATE_FILE_PATH ?? "state/seen-events.json";
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  const client = new SceleClient(baseUrl);
  await client.login(username, password);

  const allCourses = await client.getEnrolledCourses();
  const { matched } = monitored.length ? matchCourses(monitored, allCourses) : { matched: allCourses };
  const matchedIds = new Set(matched.map((c) => c.id));

  const allEvents = await client.getUpcomingEvents(windowDays);
  const events = allEvents.filter((e) => matchedIds.has(e.course.id)).sort((a, b) => a.timesort - b.timesort);

  const previousState = loadState(statePath);
  const nowUnix = Math.floor(Date.now() / 1000);
  const { added, changed, removed, newState } = diffEvents(previousState, events, nowUnix);

  saveState(statePath, newState);

  console.log(
    `Diff: +${added.length} new, ~${changed.length} moved, -${removed.length} removed/cancelled (${events.length} total upcoming)`,
  );

  // Full course-content watch (every page/file/link, not just items with a due date) —
  // same MONITORED_COURSES list, one state file per course so a change to one course
  // produces a small git diff. Set WATCH_COURSE_CONTENT=false to disable.
  const watchContent = (process.env.WATCH_COURSE_CONTENT ?? "true") !== "false";
  const contentEmbeds: DiscordEmbed[] = [];
  let contentAdded = 0;
  let contentChanged = 0;
  let contentRemoved = 0;

  if (watchContent) {
    for (const course of matched) {
      const contentPath = `state/course-content/${course.id}.json`;
      // First time watching this course: populate state silently instead of reporting
      // every existing module as "new" — that'd dump the whole course into Discord at once.
      const isFirstRun = !existsSync(contentPath);

      const previousContent = loadContentState(contentPath);
      const items = await client.getCourseContents(course.id);
      const diff = diffCourseContent(previousContent, items);
      saveContentState(contentPath, diff.newState);

      console.log(
        `Content diff [${course.shortname}]: +${diff.added.length} new, ~${diff.changed.length} changed, -${diff.removed.length} removed (${items.length} total)${isFirstRun ? " [first run, not posting]" : ""}`,
      );

      if (isFirstRun) continue;

      contentAdded += diff.added.length;
      contentChanged += diff.changed.length;
      contentRemoved += diff.removed.length;
      contentEmbeds.push(
        ...buildContentAddedEmbeds(diff.added, course.fullname),
        ...buildContentChangedEmbeds(diff.changed, course.fullname),
        ...buildContentRemovedEmbeds(diff.removed, course.fullname, `${baseUrl}/course/view.php?id=${course.id}`),
      );
    }
  }

  const totalChanges = added.length + changed.length + removed.length + contentAdded + contentChanged + contentRemoved;
  let posted = false;

  if (totalChanges > 0 && webhookUrl) {
    const parts: string[] = [];
    if (added.length) parts.push(`${added.length} new deadline(s)`);
    if (changed.length) parts.push(`${changed.length} moved`);
    if (removed.length) parts.push(`${removed.length} cancelled`);
    if (contentAdded) parts.push(`${contentAdded} new material(s)`);
    if (contentChanged) parts.push(`${contentChanged} material(s) updated`);
    if (contentRemoved) parts.push(`${contentRemoved} material(s) removed`);
    const summary = `🔔 **SCELE update** — ${parts.join(", ")}`;

    const embeds = [
      ...buildEmbeds(added),
      ...buildChangedEmbeds(changed),
      ...buildRemovedEmbeds(removed, baseUrl),
      ...contentEmbeds,
    ];
    await postToDiscord(webhookUrl, summary, embeds, process.env.DISCORD_USER_ID);
    posted = true;
  }

  return {
    posted,
    added: added.length,
    changed: changed.length,
    removed: removed.length,
    contentAdded,
    contentChanged,
    contentRemoved,
  };
}

async function main() {
  const result = await runDiffCheck();
  console.log(result);
}

if (process.argv[1] && process.argv[1].endsWith("run-diff.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
