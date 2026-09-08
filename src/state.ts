import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface TrackedEvent {
  name: string;
  courseId: number;
  courseFullname: string;
  modulename: string;
  timesort: number;
}

export type EventState = Record<string, TrackedEvent>;

export function loadState(path: string): EventState {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as EventState;
  } catch {
    return {};
  }
}

export function saveState(path: string, state: EventState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
