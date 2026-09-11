import type { ForumDiscussion } from "./scele.js";
import type { ForumPostState, TrackedForumPost } from "./state.js";

export type TaggedForumDiscussion = ForumDiscussion & { forumName: string; forumCmid: number };

export interface ForumDiffResult {
  added: TaggedForumDiscussion[];
  removed: { discussionId: number; previous: TrackedForumPost }[];
  newState: ForumPostState;
}

// Compares this run's discussions (across every forum in one course) against the last
// committed state. Like diffCourseContent(), anything missing from `current` counts as
// removed — a discussion either exists or it doesn't, no "fell out of the window" case.
export function diffForumDiscussions(
  previous: ForumPostState,
  current: TaggedForumDiscussion[],
): ForumDiffResult {
  const currentIds = new Set(current.map((d) => d.discussionId));
  const added = current.filter((d) => !previous[String(d.discussionId)]);

  const removed: { discussionId: number; previous: TrackedForumPost }[] = [];
  for (const [idStr, prev] of Object.entries(previous)) {
    if (!currentIds.has(Number(idStr))) removed.push({ discussionId: Number(idStr), previous: prev });
  }

  const newState: ForumPostState = {};
  for (const d of current) {
    newState[String(d.discussionId)] = {
      subject: d.subject,
      authorName: d.authorName,
      timestamp: d.timestamp,
      forumName: d.forumName,
      forumCmid: d.forumCmid,
    };
  }

  return { added, removed, newState };
}
