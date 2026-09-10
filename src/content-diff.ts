import type { CourseContentItem } from "./scele.js";
import type { CourseContentState, TrackedContentItem } from "./state.js";

export interface ContentDiffResult {
  added: CourseContentItem[];
  changed: { item: CourseContentItem; previous: TrackedContentItem }[];
  removed: { cmid: number; previous: TrackedContentItem }[];
  newState: CourseContentState;
}

// Compares this run's course content (every activity/resource, not just ones with a
// deadline) against the last-committed per-course state. Unlike diffEvents(), anything
// missing from `current` counts as removed — a module either exists on the course page or
// it doesn't, there's no "fell out of the window" case here.
export function diffCourseContent(previous: CourseContentState, current: CourseContentItem[]): ContentDiffResult {
  const currentIds = new Set(current.map((i) => i.cmid));
  const added: CourseContentItem[] = [];
  const changed: { item: CourseContentItem; previous: TrackedContentItem }[] = [];

  for (const item of current) {
    const prev = previous[String(item.cmid)];
    if (!prev) {
      added.push(item);
    } else if (prev.name !== item.name || prev.section !== item.section) {
      changed.push({ item, previous: prev });
    }
  }

  const removed: { cmid: number; previous: TrackedContentItem }[] = [];
  for (const [cmidStr, prev] of Object.entries(previous)) {
    if (!currentIds.has(Number(cmidStr))) {
      removed.push({ cmid: Number(cmidStr), previous: prev });
    }
  }

  const newState: CourseContentState = {};
  for (const item of current) {
    newState[String(item.cmid)] = { name: item.name, section: item.section, type: item.type, url: item.url };
  }

  return { added, changed, removed, newState };
}
