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
