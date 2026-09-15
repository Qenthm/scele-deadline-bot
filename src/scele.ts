// Minimal client for a plain Moodle instance (SCELE FASILKOM UI has no CAS/SSO —
// it's a direct username/password form at /login/index.php).

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#039": "'",
  "#39": "'",
  nbsp: " ",
};

// Moodle's AJAX API returns course/event names pre-escaped as HTML, so plain text
// consumers (console, Discord embeds) need this decoded back to normal characters.
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#?\w+);/g, (match, entity) => HTML_ENTITIES[entity] ?? match);
}

export interface SceleCourse {
  id: number;
  fullname: string;
  shortname: string;
  viewurl: string;
}

export interface CourseContentItem {
  cmid: number;
  name: string;
  section: string;
  type: string; // modname: "page", "url", "resource", "assign", ...
  url: string | null;
}

export interface ForumDiscussion {
  discussionId: number;
  subject: string;
  authorName: string;
  timestamp: number; // unix seconds, when the discussion was started
  url: string;
}

// Some courses (e.g. Komputer & Masyarakat) run parallel sections (A/B/C/D, sometimes
// combined as "A & B") that each post near-identical items — only the student's own
// section is actually relevant. The lecturer marks which section an item belongs to by
// putting "SECTION <letters>" (or the abbreviation "SECT") at the very front of its name,
// but inconsistently: colon, dash, or nothing as the separator, "&"/"and"/"," between
// combined letters (see state/course-content/4234.json for the range of real examples).
// An item with no such tag at all applies to everyone and always passes through.
const SECTION_TAG_RE = /^sect(?:ion)?\s+([a-z](?:\s*(?:&|and|,)\s*[a-z])*)\b\s*[:-]?/i;

// Course id -> the student's own section letter. Add an entry here for any other course
// that splits items by section the same way.
const MY_SECTION: Record<number, string> = {
  4234: "D", // [Reg] Komputer & Masyarakat — I'm in section D
};

export function belongsToMySection(courseId: number, name: string): boolean {
  const mySection = MY_SECTION[courseId];
  if (!mySection) return true;
  const tag = name.match(SECTION_TAG_RE)?.[1];
  if (!tag) return true;
  const letters: string[] = tag.toUpperCase().match(/[A-Z]/g) ?? [];
  return letters.includes(mySection);
}

// A forum where students each start their own new discussion as coursework (a weekly
// graded "post your own topic" forum) produces a fresh discussion every few days from
// routine classmate activity — not worth a ping. An announcement forum ("Announcements",
// "Class Administration", a one-off "Lab N" notice) only ever gets new discussions from
// the teacher, so those stay watched. Keyed by course id, matched by substring against the
// forum's name — add an entry here if another course's participation forums slip through.
const PARTICIPATION_FORUM_PATTERNS: Record<number, RegExp> = {
  4234: /discussion forum/i, // [Reg] Komputer & Masyarakat — weekly graded discussion forums
};

export function isAnnouncementForum(courseId: number, forumName: string): boolean {
  const pattern = PARTICIPATION_FORUM_PATTERNS[courseId];
  return !pattern || !pattern.test(forumName);
}

// Some courses never put a due date on Moodle's calendar at all — the "deadline" only
// exists as plain text in a forum announcement. Komputasi Awan announces each week's lab
// as a new "Lab N, <date>" forum (no assignment/submission page), with the unwritten but
// consistent course rule that it's due the following Monday 23:59 WIB. Keyed by course id,
// matched by forum name — add an entry here for another course that follows the same
// "new forum post = implicit deadline" pattern.
const LAB_DEADLINE_PATTERNS: Record<number, RegExp> = {
  4256: /^lab\s*\d+/i, // [Reg] Komputasi Awan — "Lab N, DD Month YYYY" forums
};

export function isLabDeadlinePost(courseId: number, forumName: string): boolean {
  const pattern = LAB_DEADLINE_PATTERNS[courseId];
  return Boolean(pattern?.test(forumName));
}

const WIB_OFFSET_SECONDS = 7 * 3600;

// Derives "the following Monday, 23:59 WIB" from a lab post's own timestamp, since that's
// the only place the deadline exists for courses in LAB_DEADLINE_PATTERNS. If the post
// itself landed on a Monday, that's not "the following Monday" — roll a full week ahead
// instead of treating it as due same-day.
export function deriveLabDeadline(postTimestampUnix: number): number {
  const wibShifted = new Date((postTimestampUnix + WIB_OFFSET_SECONDS) * 1000);
  const year = wibShifted.getUTCFullYear();
  const month = wibShifted.getUTCMonth();
  const day = wibShifted.getUTCDate();
  const weekday = wibShifted.getUTCDay(); // 0=Sun..6=Sat, WIB-local since we shifted first

  const daysAhead = ((1 - weekday + 7) % 7) || 7;
  const deadlineWibAsUtcMs = Date.UTC(year, month, day + daysAhead, 23, 59, 0);
  return Math.floor(deadlineWibAsUtcMs / 1000) - WIB_OFFSET_SECONDS;
}

export interface SceleEvent {
  id: number;
  name: string;
  modulename: string; // "assign", "quiz", "forum", ...
  eventtype: string; // "due", "open", "close", ...
  timesort: number; // unix seconds
  overdue: boolean;
  actionName: string | null; // e.g. "Add submission", "Attempt quiz"
  actionUrl: string | null;
  course: { id: number; fullname: string; shortname: string };
}

function parseSetCookiePairs(res: Response): Record<string, string> {
  const raw =
    typeof (res.headers as any).getSetCookie === "function"
      ? ((res.headers as any).getSetCookie() as string[])
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  const pairs: Record<string, string> = {};
  for (const line of raw) {
    const [nameValue] = line.split(";");
    const eq = nameValue.indexOf("=");
    if (eq === -1) continue;
    const name = nameValue.slice(0, eq).trim();
    const value = nameValue.slice(eq + 1).trim();
    if (name) pairs[name] = value;
  }
  return pairs;
}

function cookieHeader(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export class SceleClient {
  private baseUrl: string;
  private cookies: Record<string, string> = {};
  private sesskey: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async fetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (Object.keys(this.cookies).length) headers.set("cookie", cookieHeader(this.cookies));
    return fetch(`${this.baseUrl}${path}`, { ...init, headers, redirect: "manual" });
  }

  private absorbCookies(res: Response) {
    Object.assign(this.cookies, parseSetCookiePairs(res));
  }

  async login(username: string, password: string): Promise<void> {
    const loginPage = await this.fetchRaw("/login/index.php");
    this.absorbCookies(loginPage);
    const html = await loginPage.text();
    const logintoken = html.match(/name="logintoken"\s+value="([^"]*)"/)?.[1] ?? "";

    const body = new URLSearchParams({
      username,
      password,
      logintoken,
      rememberusername: "0",
    });

    const loginRes = await this.fetchRaw("/login/index.php", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    this.absorbCookies(loginRes);

    let location = loginRes.headers.get("location") ?? "";
    // A failed login bounces straight back to a plain login/index.php. A successful one
    // redirects to login/index.php?testsession=<id> first — Moodle's own cookie-persisted
    // check — before continuing on to the real dashboard, so that specific shape is fine.
    const isFailureBounce = location.includes("/login/index.php") && !location.includes("testsession=");
    if (loginRes.status >= 400 || !location || isFailureBounce) {
      throw new Error(
        "SCELE login failed — double-check SCELE_USERNAME/SCELE_PASSWORD (and that the account has no extra verification step).",
      );
    }

    // Follow redirects (testsession hop, then the real wantsurl/dashboard) until we land
    // on a non-redirect page that should embed sesskey.
    let landingHtml = "";
    for (let hops = 0; hops < 5; hops++) {
      const path = location.startsWith("http") ? new URL(location).pathname + new URL(location).search : location;
      const res = await this.fetchRaw(path);
      this.absorbCookies(res);
      const nextLocation = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && nextLocation) {
        location = nextLocation;
        continue;
      }
      landingHtml = await res.text();
      break;
    }

    const sesskey = landingHtml.match(/"sesskey":"([^"]+)"/)?.[1];
    if (!sesskey) {
      throw new Error("Logged in, but could not find a sesskey on the landing page — SCELE's page structure may have changed.");
    }
    this.sesskey = sesskey;
  }

  private async ajax<T>(methodname: string, args: Record<string, unknown>): Promise<T> {
    if (!this.sesskey) throw new Error("Not logged in yet.");
    const res = await this.fetchRaw(
      `/lib/ajax/service.php?sesskey=${encodeURIComponent(this.sesskey)}&info=${encodeURIComponent(methodname)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      },
    );
    this.absorbCookies(res);
    if (res.status >= 400) throw new Error(`SCELE ajax call ${methodname} failed with HTTP ${res.status}`);
    const json = (await res.json()) as Array<{ error: boolean; data?: T; exception?: { message: string } }>;
    const entry = json[0];
    if (!entry || entry.error) {
      throw new Error(`SCELE ajax call ${methodname} returned an error: ${entry?.exception?.message ?? "unknown"}`);
    }
    return entry.data as T;
  }

  async getEnrolledCourses(): Promise<SceleCourse[]> {
    const data = await this.ajax<{ courses: SceleCourse[] }>(
      "core_course_get_enrolled_courses_by_timeline_classification",
      { classification: "all", limit: 0, offset: 0, sort: "fullname" },
    );
    return data.courses.map((c) => ({
      ...c,
      fullname: decodeHtmlEntities(c.fullname),
      shortname: decodeHtmlEntities(c.shortname),
    }));
  }

  async getUpcomingEvents(windowDays: number): Promise<SceleEvent[]> {
    const now = Math.floor(Date.now() / 1000);
    const data = await this.ajax<{
      events: Array<{
        id: number;
        name: string;
        modulename: string;
        eventtype: string;
        timesort: number;
        overdue?: boolean;
        action?: { name: string; url: string } | null;
        course: { id: number; fullname: string; shortname: string };
      }>;
    }>("core_calendar_get_action_events_by_timesort", {
      timesortfrom: now,
      timesortto: now + windowDays * 86400,
      limitnum: 50, // Moodle server-side cap: must be between 1 and 50
      limittononsuspendedevents: true,
    });

    return data.events.map((e) => ({
      id: e.id,
      name: decodeHtmlEntities(e.name),
      modulename: e.modulename,
      eventtype: e.eventtype,
      timesort: e.timesort,
      overdue: Boolean(e.overdue),
      actionName: e.action?.name ?? null,
      actionUrl: e.action?.url ?? null,
      course: {
        ...e.course,
        fullname: decodeHtmlEntities(e.course.fullname),
        shortname: decodeHtmlEntities(e.course.shortname),
      },
    }));
  }

  // Flattens every activity/resource in a course (pages, files, links, assignments, ...)
  // regardless of whether it has a due date. SCELE runs Moodle 3.11, where
  // `core_course_get_contents` exists as a webservice function but isn't registered for the
  // internal sesskey-authenticated ajax endpoint (`servicenotavailable`), and there's no
  // `core_courseformat_get_state` either (that's Moodle 4.0+, server-rendered 3.11 has no
  // client-side "state" to fetch). So this scrapes the same server-rendered course page a
  // browser sees instead. Used for the "tell me about any content change" watch, as opposed
  // to getUpcomingEvents()'s deadline-only view.
  async getCourseContents(courseId: number): Promise<CourseContentItem[]> {
    const res = await this.fetchRaw(`/course/view.php?id=${courseId}`);
    this.absorbCookies(res);
    if (res.status >= 400) throw new Error(`Failed to load course page for course ${courseId} (HTTP ${res.status})`);
    return parseCourseContentHtml(await res.text());
  }

  // Lists the discussion threads in one forum activity (an "Announcements" forum, a
  // per-topic "Lab N" forum, etc). Same scraping approach as getCourseContents() and for
  // the same reason: no forum webservice is registered for the sesskey ajax endpoint on
  // this Moodle version. Used to catch things a due-date-only Timeline never surfaces —
  // announcements, "class moves online today" notices, a lab posted with no due date set.
  async getForumDiscussions(forumCmid: number): Promise<ForumDiscussion[]> {
    const res = await this.fetchRaw(`/mod/forum/view.php?id=${forumCmid}`);
    this.absorbCookies(res);
    if (res.status >= 400) throw new Error(`Failed to load forum page for cmid ${forumCmid} (HTTP ${res.status})`);
    return parseForumDiscussionListHtml(await res.text(), this.baseUrl);
  }

  // Fetches just the opening post's body text of one discussion, plain-text (tags
  // stripped). Only called for discussions not already in state, so this is cheap.
  async getDiscussionBody(discussionId: number): Promise<string> {
    const res = await this.fetchRaw(`/mod/forum/discuss.php?d=${discussionId}`);
    this.absorbCookies(res);
    if (res.status >= 400) throw new Error(`Failed to load discussion ${discussionId} (HTTP ${res.status})`);
    return parseFirstPostBody(await res.text());
  }
}

// Section headings look like: <h3 id="sectionid-NNNN-title" class="sectionname ..."><span>NAME</span></h3>
const SECTION_RE = /<li id="section-\d+" class="section[^"]*"[\s\S]{0,800}?<h3[^>]*class="[^"]*\bsectionname\b[^"]*"[^>]*>(?:<span>([^<]*)<\/span>)?/g;

// Each activity is a non-nested <li ... id="module-CMID">...</li> (verified against live
// SCELE course pages: no activity type — assign, resource, forum, page, url — nests another
// <li> inside its own, so the first "</li>" after the opener is always its own closing tag).
const ACTIVITY_RE = /<li class="activity ([\w-]+) modtype_[\w-]+[^"]*" id="module-(\d+)"[\s\S]*?<\/li>/g;

// Activities without a direct link (e.g. "label" — a plain text/heading block with no
// mod/*/view.php page of its own) are skipped: there's nothing to diff a URL/section move
// against, and they're not what students think of as "course material".
function parseCourseContentHtml(html: string): CourseContentItem[] {
  const containerStart = html.indexOf('<div class="course-content">');
  const container = containerStart === -1 ? html : html.slice(containerStart);

  const sections: { index: number; name: string }[] = [];
  for (const m of container.matchAll(SECTION_RE)) {
    sections.push({ index: m.index, name: m[1] ? decodeHtmlEntities(m[1].trim()) : "General" });
  }

  const items: CourseContentItem[] = [];
  for (const m of container.matchAll(ACTIVITY_RE)) {
    const [block, modname, cmidStr] = m;
    const hrefMatch = block.match(/<a class="aalink"[^>]*\shref="([^"]+)"/);
    const nameMatch = block.match(/<span class="instancename">([^<]*)/);
    if (!hrefMatch || !nameMatch) continue;

    let sectionName = sections[0]?.name ?? "General";
    for (const s of sections) {
      if (s.index > m.index) break;
      sectionName = s.name;
    }

    items.push({
      cmid: Number(cmidStr),
      name: decodeHtmlEntities(nameMatch[1].trim()),
      section: sectionName,
      type: modname,
      url: decodeHtmlEntities(hrefMatch[1]),
    });
  }

  return items;
}

// Each discussion row looks like:
// <tr class="discussion" data-region="discussion-list-item" data-discussionid="62895" ...>
//   <a ... href=".../discuss.php?d=62895" title="Lab 3, 11 September 2026" ...>
//   ... <div class="mb-1 line-height-3 text-truncate">RIZAL FATHONI AJI -</div>
//   ... <time id="time-created-62895" ... data-timestamp="1789080225" ...>
// (verified against live SCELE forum pages). Split into per-row chunks first, then pull
// each field out of its own chunk — safer than one long regex spanning the whole table.
const DISCUSSION_ROW_RE = /<tr class="discussion"[\s\S]*?(?=<tr class="discussion"|<\/tbody>)/g;
const DISCUSSION_ID_RE = /data-discussionid="(\d+)"/;
const DISCUSSION_SUBJECT_RE = /discuss\.php\?d=\d+"[^>]*title="([^"]*)"/;
const DISCUSSION_AUTHOR_RE = /class="mb-1 line-height-3 text-truncate">([^<]*)<\/div>/;
const DISCUSSION_TIME_RE = /data-timestamp="(\d+)"/;

function parseForumDiscussionListHtml(html: string, baseUrl: string): ForumDiscussion[] {
  const bodyStart = html.indexOf("<tbody>");
  const container = bodyStart === -1 ? html : html.slice(bodyStart);

  const discussions: ForumDiscussion[] = [];
  for (const rowMatch of container.matchAll(DISCUSSION_ROW_RE)) {
    const row = rowMatch[0];
    const id = row.match(DISCUSSION_ID_RE)?.[1];
    const subject = row.match(DISCUSSION_SUBJECT_RE)?.[1];
    const author = row.match(DISCUSSION_AUTHOR_RE)?.[1];
    const time = row.match(DISCUSSION_TIME_RE)?.[1];
    if (!id || !subject || !time) continue;

    discussions.push({
      discussionId: Number(id),
      subject: decodeHtmlEntities(subject.trim()),
      authorName: author ? decodeHtmlEntities(author.trim()) : "",
      timestamp: Number(time),
      url: `${baseUrl}/mod/forum/discuss.php?d=${id}`,
    });
  }

  return discussions;
}

// The opening post's body sits in <div id="post-content-<id>" class="post-content-container">
// ...</div>, immediately followed by the post-actions toolbar
// (<div class="d-flex flex-wrap">) — used as the closing boundary instead of trying to
// balance nested divs, since a post body can itself contain arbitrary markup.
const FIRST_POST_BODY_RE = /<div[^>]*class="post-content-container"[^>]*>([\s\S]*?)<div class="d-flex flex-wrap">/;

function parseFirstPostBody(html: string): string {
  const raw = html.match(FIRST_POST_BODY_RE)?.[1];
  if (!raw) return "";
  const text = raw
    .replace(/\r/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
  return decodeHtmlEntities(text).replace(/\n{3,}/g, "\n\n");
}

export function matchCourses(
  monitoredNames: string[],
  courses: SceleCourse[],
): { matched: SceleCourse[]; unmatchedNames: string[] } {
  const matched: SceleCourse[] = [];
  const unmatchedNames: string[] = [];
  for (const raw of monitoredNames) {
    const token = raw.trim();
    if (!token) continue;

    // A pure number (e.g. from a course/view.php?id=4234 URL) matches by course id —
    // unambiguous, so it skips substring matching entirely.
    let hits: SceleCourse[];
    if (/^\d+$/.test(token)) {
      const id = Number(token);
      hits = courses.filter((c) => c.id === id);
    } else {
      const needle = token.toLowerCase();
      hits = courses.filter(
        (c) => c.fullname.toLowerCase().includes(needle) || c.shortname.toLowerCase().includes(needle),
      );
    }

    if (hits.length === 0) {
      unmatchedNames.push(token);
    } else {
      for (const c of hits) if (!matched.some((m) => m.id === c.id)) matched.push(c);
    }
  }
  return { matched, unmatchedNames };
}
