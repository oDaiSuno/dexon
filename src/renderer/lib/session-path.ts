import type { SessionInfo } from "./types";

// The chain from a root session down to the one on screen, resolved from the
// session list the sidebar already holds. A parent that is not listed (another
// project, a deleted session) ends the chain instead of inventing a step.

export const SESSION_PATH_VISIBLE_HEAD = 1;
export const SESSION_PATH_VISIBLE_TAIL = 3;

export interface SessionPathSegment {
  session: SessionInfo;
  isCurrent: boolean;
}

export function sessionPath(
  session: SessionInfo,
  catalog: readonly SessionInfo[],
  { maxVisible = SESSION_PATH_VISIBLE_HEAD + SESSION_PATH_VISIBLE_TAIL + 1 } = {},
): { segments: SessionPathSegment[]; truncated: boolean } {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const ancestors: SessionInfo[] = [];
  const visited = new Set<string>([session.id]);
  let parentId = session.parentSessionId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parentSessionId;
  }
  const chain = [...ancestors, session];
  const truncated = chain.length > maxVisible;
  const visible = truncated
    ? [...chain.slice(0, SESSION_PATH_VISIBLE_HEAD), ...chain.slice(-SESSION_PATH_VISIBLE_TAIL)]
    : chain;
  return {
    segments: visible.map((item) => ({ session: item, isCurrent: item.id === session.id })),
    truncated,
  };
}
