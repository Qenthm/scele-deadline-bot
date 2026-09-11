import type { CourseContentItem } from "./scele.js";
import type { SceleEvent } from "./scele.js";
import type { TaggedForumDiscussion } from "./forum-diff.js";
import type { TrackedContentItem, TrackedEvent } from "./state.js";

const MODULE_TIPS: Record<string, string> = {
  assign: "Submit your work before the deadline — check if late submissions are even accepted.",
  quiz: "Attempt/finish the quiz before it closes. Most SCELE quizzes lock hard at the close time.",
  forum: "Post before the deadline if this is a graded discussion forum.",
  workshop: "Submit your work and/or complete peer assessment before the phase deadline.",
  choice: "Make your selection before the activity closes.",
  feedback: "Fill in the feedback/survey before it closes.",
};

function urgencyColor(hoursLeft: number): number {
  if (hoursLeft <= 24) return 0xed4245; // red
  if (hoursLeft <= 72) return 0xfaa61a; // orange
  if (hoursLeft <= 168) return 0xfee75c; // yellow
  return 0x57f287; // green
}

function formatDueDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) + " WIB";
}

function formatTimeLeft(hoursLeft: number): string {
  if (hoursLeft < 0) return "overdue";
  if (hoursLeft < 1) return `${Math.round(hoursLeft * 60)} min left`;
  if (hoursLeft < 48) return `${Math.round(hoursLeft)} h left`;
  return `${Math.round(hoursLeft / 24)} days left`;
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  url?: string;
}

export function buildEmbeds(events: SceleEvent[]): DiscordEmbed[] {
  const now = Date.now() / 1000;
  return events.map((e) => {
    const hoursLeft = (e.timesort - now) / 3600;
    const tip = MODULE_TIPS[e.modulename] ?? "Check the activity page for what's required.";
    return {
      title: `${e.overdue ? "⚠️ OVERDUE — " : ""}${e.name}`,
      description: `**${e.course.fullname}**\n${tip}`,
      color: urgencyColor(hoursLeft),
      url: e.actionUrl ?? undefined,
      fields: [
        { name: "Type", value: e.modulename, inline: true },
        { name: "Due", value: formatDueDate(e.timesort), inline: true },
        { name: "Time left", value: formatTimeLeft(hoursLeft), inline: true },
        ...(e.actionName ? [{ name: "Action", value: e.actionName, inline: true }] : []),
      ],
    };
  });
}

export function buildChangedEmbeds(
  changes: { event: SceleEvent; previousTimesort: number }[],
): DiscordEmbed[] {
  const now = Date.now() / 1000;
  return changes.map(({ event: e, previousTimesort }) => {
    const hoursLeft = (e.timesort - now) / 3600;
    return {
      title: `🔁 Deadline moved — ${e.name}`,
      description: `**${e.course.fullname}**\n${formatDueDate(previousTimesort)} → **${formatDueDate(e.timesort)}**`,
      color: urgencyColor(hoursLeft),
      url: e.actionUrl ?? undefined,
      fields: [
        { name: "Type", value: e.modulename, inline: true },
        { name: "New time left", value: formatTimeLeft(hoursLeft), inline: true },
      ],
    };
  });
}

export function buildRemovedEmbeds(
  removed: { id: number; previous: TrackedEvent }[],
  baseUrl: string,
): DiscordEmbed[] {
  return removed.map(({ previous }) => ({
    title: `❌ Removed/cancelled — ${previous.name}`,
    description: `**${previous.courseFullname}**\nWas previously due ${formatDueDate(previous.timesort)}, but no longer appears on SCELE — likely cancelled or replaced. Check the course page to confirm.`,
    color: 0x99aab5,
    url: `${baseUrl}/course/view.php?id=${previous.courseId}`,
    fields: [{ name: "Type", value: previous.modulename, inline: true }],
  }));
}

export function buildContentAddedEmbeds(items: CourseContentItem[], courseFullname: string): DiscordEmbed[] {
  return items.map((item) => ({
    title: `🆕 ${item.name}`,
    description: `**${courseFullname}**\n${item.section}`,
    color: 0x5865f2,
    url: item.url ?? undefined,
    fields: [{ name: "Type", value: item.type, inline: true }],
  }));
}

export function buildContentChangedEmbeds(
  changes: { item: CourseContentItem; previous: TrackedContentItem }[],
  courseFullname: string,
): DiscordEmbed[] {
  return changes.map(({ item, previous }) => ({
    title: `✏️ Content updated — ${item.name}`,
    description:
      previous.name !== item.name
        ? `**${courseFullname}**\nRenamed from "${previous.name}"\n${item.section}`
        : `**${courseFullname}**\nMoved from "${previous.section}" to "${item.section}"`,
    color: 0xfee75c,
    url: item.url ?? undefined,
    fields: [{ name: "Type", value: item.type, inline: true }],
  }));
}

export function buildContentRemovedEmbeds(
  removed: { cmid: number; previous: TrackedContentItem }[],
  courseFullname: string,
  courseViewUrl: string,
): DiscordEmbed[] {
  return removed.map(({ previous }) => ({
    title: `🗑️ Removed — ${previous.name}`,
    description: `**${courseFullname}**\nWas in "${previous.section}", no longer on the course page.`,
    color: 0x99aab5,
    url: courseViewUrl,
    fields: [{ name: "Type", value: previous.type, inline: true }],
  }));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildForumPostEmbeds(
  posts: { discussion: TaggedForumDiscussion; body: string }[],
  courseFullname: string,
): DiscordEmbed[] {
  return posts.map(({ discussion, body }) => ({
    title: `📢 ${discussion.subject}`,
    description: `**${courseFullname}** — ${discussion.forumName}\n${body ? truncate(body, 600) : "_(couldn't read the post body — check the link)_"}`,
    color: 0x5865f2,
    url: discussion.url,
    fields: [
      { name: "Posted by", value: discussion.authorName || "Unknown", inline: true },
      { name: "Posted", value: formatDueDate(discussion.timestamp), inline: true },
    ],
  }));
}

async function postMessage(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
    });
    if (res.ok) return;
    if (res.status === 429) {
      const retryAfterHeader = Number(res.headers.get("retry-after"));
      let retryAfterSeconds = Number.isFinite(retryAfterHeader) ? retryAfterHeader : 1;
      try {
        const body = (await res.clone().json()) as { retry_after?: number };
        if (typeof body.retry_after === "number") retryAfterSeconds = body.retry_after;
      } catch {
        // body wasn't JSON — fall back to the header value already parsed above
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfterSeconds, 1) * 1000));
      continue;
    }
    throw new Error(`Discord webhook post failed: HTTP ${res.status} ${await res.text()}`);
  }
  throw new Error("Discord webhook post failed: gave up after repeated rate-limiting (HTTP 429).");
}

// One Discord message per deadline (plus a short summary message up front) — easier to
// read/react to on mobile than one message packed with several embeds.
export async function postToDiscord(
  webhookUrl: string,
  summary: string,
  embeds: DiscordEmbed[],
  mentionUserId?: string,
): Promise<void> {
  // Mentions only ping from the plain `content` field — text inside an embed never pings,
  // even if it contains "<@id>". allowed_mentions.users scopes it to just this one id, so
  // nothing in a course/activity name (e.g. a stray "@everyone") can trigger a mass ping.
  const mention = mentionUserId ? `<@${mentionUserId}> ` : "";
  const allowed_mentions = mentionUserId ? { users: [mentionUserId] } : { parse: [] };

  if (summary) await postMessage(webhookUrl, { content: `${mention}${summary}`, allowed_mentions });
  for (const embed of embeds) {
    await postMessage(webhookUrl, {
      content: mention || undefined,
      embeds: [embed],
      allowed_mentions,
    });
  }
}
