import { SceleClient, matchCourses, belongsToMySection, type SceleEvent, type SceleCourse } from "./scele.js";
import { buildEmbeds, postToDiscord } from "./discord.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}. See .env.example.`);
  return value;
}

export interface CheckResult {
  allCourses: SceleCourse[];
  matchedCourses: SceleCourse[];
  unmatchedNames: string[];
  events: SceleEvent[];
}

export async function runCheck(): Promise<CheckResult> {
  const baseUrl = process.env.SCELE_BASE_URL ?? "https://scele.cs.ui.ac.id";
  const username = requireEnv("SCELE_USERNAME");
  const password = requireEnv("SCELE_PASSWORD");
  const monitored = (process.env.MONITORED_COURSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const windowDays = Number(process.env.DEADLINE_WINDOW_DAYS ?? 14);

  const client = new SceleClient(baseUrl);
  await client.login(username, password);

  const allCourses = await client.getEnrolledCourses();
  const { matched, unmatchedNames } = monitored.length
    ? matchCourses(monitored, allCourses)
    : { matched: allCourses, unmatchedNames: [] };

  const allEvents = await client.getUpcomingEvents(windowDays);
  const matchedIds = new Set(matched.map((c) => c.id));
  const events = allEvents
    .filter((e) => matchedIds.has(e.course.id) && belongsToMySection(e.course.id, e.name))
    .sort((a, b) => a.timesort - b.timesort);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (webhookUrl) {
    const summary = events.length
      ? `**SCELE deadline check** — ${events.length} upcoming item(s) in the next ${windowDays} day(s) for: ${matched.map((c) => c.shortname).join(", ")}`
      : `**SCELE deadline check** — nothing due in the next ${windowDays} day(s) for: ${matched.map((c) => c.shortname).join(", ")}`;
    const warn = unmatchedNames.length
      ? `\n⚠️ No course matched: ${unmatchedNames.join(", ")}. Run \`npm run list-courses\` to check spelling.`
      : "";
    await postToDiscord(webhookUrl, summary + warn, buildEmbeds(events), process.env.DISCORD_USER_ID);
  }

  return { allCourses, matchedCourses: matched, unmatchedNames, events };
}

async function main() {
  const listOnly = process.argv.includes("--list-courses");

  if (listOnly) {
    const baseUrl = process.env.SCELE_BASE_URL ?? "https://scele.cs.ui.ac.id";
    const client = new SceleClient(baseUrl);
    await client.login(requireEnv("SCELE_USERNAME"), requireEnv("SCELE_PASSWORD"));
    const courses = await client.getEnrolledCourses();
    console.log(`Enrolled in ${courses.length} course(s):\n`);
    for (const c of courses) console.log(`  [${c.id}] ${c.fullname}  (${c.shortname})`);
    return;
  }

  const result = await runCheck();
  console.log(`Matched ${result.matchedCourses.length} course(s):`);
  for (const c of result.matchedCourses) console.log(`  - ${c.fullname}`);
  if (result.unmatchedNames.length) {
    console.log(`\n⚠️  No match for: ${result.unmatchedNames.join(", ")}`);
  }
  console.log(`\n${result.events.length} upcoming item(s):\n`);
  for (const e of result.events) {
    const due = new Date(e.timesort * 1000).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    console.log(`  - [${e.course.shortname}] ${e.name} (${e.modulename}) — due ${due} WIB`);
    if (e.actionUrl) console.log(`      ${e.actionUrl}`);
  }
  if (process.env.DISCORD_WEBHOOK_URL) console.log("\nAlso posted to Discord.");
}

// Only auto-run when this file is executed directly (`npm run check`), not when imported.
if (process.argv[1] && process.argv[1].endsWith("run.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
