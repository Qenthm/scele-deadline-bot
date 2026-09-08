import { SceleClient, matchCourses } from "./scele.js";
import { buildEmbeds, buildChangedEmbeds, buildRemovedEmbeds, postToDiscord } from "./discord.js";
import { loadState, saveState } from "./state.js";
import { diffEvents } from "./diff.js";

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
}

// The "only tell me what's new" mode: diffs this run's events against the state file
// committed by the last run, and only posts to Discord if something actually changed.
// Meant to be run often (e.g. 3x/day via GitHub Actions) without spamming the channel.
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

  const totalChanges = added.length + changed.length + removed.length;
  let posted = false;

  if (totalChanges > 0 && webhookUrl) {
    const parts: string[] = [];
    if (added.length) parts.push(`${added.length} new`);
    if (changed.length) parts.push(`${changed.length} moved`);
    if (removed.length) parts.push(`${removed.length} cancelled`);
    const summary = `🔔 **SCELE update** — ${parts.join(", ")}`;

    const embeds = [...buildEmbeds(added), ...buildChangedEmbeds(changed), ...buildRemovedEmbeds(removed, baseUrl)];
    await postToDiscord(webhookUrl, summary, embeds, process.env.DISCORD_USER_ID);
    posted = true;
  }

  return { posted, added: added.length, changed: changed.length, removed: removed.length };
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
