import type { SceleEvent } from "./scele.js";
import type { EventState, TrackedEvent } from "./state.js";

export interface DiffResult {
  added: SceleEvent[];
  changed: { event: SceleEvent; previousTimesort: number }[];
  removed: { id: number; previous: TrackedEvent }[];
  newState: EventState;
}

// Compares this run's events against the last-committed state. An event missing from
// `current` only counts as "removed" if it was still supposed to be in the future
// (previous.timesort > now) — otherwise it just fell out of the window because its due
// date already passed, which is normal and not worth flagging.
export function diffEvents(previous: EventState, current: SceleEvent[], nowUnix: number): DiffResult {
  const currentIds = new Set(current.map((e) => e.id));
  const added: SceleEvent[] = [];
  const changed: { event: SceleEvent; previousTimesort: number }[] = [];

  for (const e of current) {
    const prev = previous[String(e.id)];
    if (!prev) {
      added.push(e);
    } else if (prev.timesort !== e.timesort) {
      changed.push({ event: e, previousTimesort: prev.timesort });
    }
  }

  const removed: { id: number; previous: TrackedEvent }[] = [];
  for (const [idStr, prev] of Object.entries(previous)) {
    const id = Number(idStr);
    if (!currentIds.has(id) && prev.timesort > nowUnix) {
      removed.push({ id, previous: prev });
    }
  }

  const newState: EventState = {};
  for (const e of current) {
    newState[String(e.id)] = {
      name: e.name,
      courseId: e.course.id,
      courseFullname: e.course.fullname,
      modulename: e.modulename,
      timesort: e.timesort,
    };
  }

  return { added, changed, removed, newState };
}
