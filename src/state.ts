import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function saveJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export interface TrackedEvent {
  name: string;
  courseId: number;
  courseFullname: string;
  modulename: string;
  timesort: number;
}

export type EventState = Record<string, TrackedEvent>;

export function loadState(path: string): EventState {
  return loadJson(path, {});
}

export function saveState(path: string, state: EventState): void {
  saveJson(path, state);
}

export interface TrackedContentItem {
  name: string;
  section: string;
  type: string;
  url: string | null;
}

// Keyed by cmid. One file per course (see run-diff.ts) rather than one big file, so a
// change to one course's content produces a small, readable git diff.
export type CourseContentState = Record<string, TrackedContentItem>;

export function loadContentState(path: string): CourseContentState {
  return loadJson(path, {});
}

export function saveContentState(path: string, state: CourseContentState): void {
  saveJson(path, state);
}

export interface TrackedForumPost {
  subject: string;
  authorName: string;
  timestamp: number;
  forumName: string;
  forumCmid: number;
}

// Keyed by discussion id. One file per course, same reasoning as CourseContentState —
// covers every forum in that course, discussion ids are already globally unique.
export type ForumPostState = Record<string, TrackedForumPost>;

export function loadForumState(path: string): ForumPostState {
  return loadJson(path, {});
}

export function saveForumState(path: string, state: ForumPostState): void {
  saveJson(path, state);
}

export interface RemindedEvent {
  name: string;
  timesort: number;
}

// Keyed by event id (same key as EventState) — records which deadlines already got a
// "due soon" reminder ping, so a deadline sitting inside the reminder window for several
// runs in a row (checked every 15 min) only pings once instead of on every run.
export type ReminderState = Record<string, RemindedEvent>;

export function loadReminderState(path: string): ReminderState {
  return loadJson(path, {});
}

export function saveReminderState(path: string, state: ReminderState): void {
  saveJson(path, state);
}
