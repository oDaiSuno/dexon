import type { SessionInfo } from "./types";
import type { SessionRelation } from "@shared/session-orchestration";

// Pure projection used by the session sidebar: fold a flat session list into
// the derived session tree. Siblings keep the order they were created in, so a
// reader can remember where a session sits; whole trees are ordered by the
// newest activity anywhere inside them, because an old root with busy children
// is today's work.

export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
  /** Newest `modified` anywhere in this subtree. */
  activity: string;
}

/** Three steps of indent fit the 224px sidebar; deeper rows keep their place. */
export const MAX_TREE_INDENT_DEPTH = 3;

/** How this session came to exist; a parent without a recorded relation is a fork. */
export function sessionRelation(session: SessionInfo): SessionRelation | null {
  if (session.relation) return session.relation;
  return session.parentSessionId ? "fork" : null;
}

function creationOrder(left: SessionInfo, right: SessionInfo): number {
  const created = left.created.localeCompare(right.created);
  return created !== 0 ? created : left.id.localeCompare(right.id);
}

function newest(values: string[]): string {
  let latest = "";
  for (const value of values) if (value > latest) latest = value;
  return latest;
}

export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const session of sessions) byId.set(session.id, { session, children: [], activity: session.modified });

  const parentOf = new Map<string, string>();
  for (const session of sessions) {
    if (session.parentSessionId) parentOf.set(session.id, session.parentSessionId);
  }

  function resolveAncestor(id: string): string | null {
    let current = parentOf.get(id);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return null;
      visited.add(current);
      if (byId.has(current)) return current;
      current = parentOf.get(current);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) byId.get(ancestor)!.children.push(node);
    else roots.push(node);
  }

  const order = (left: SessionTreeNode, right: SessionTreeNode) => creationOrder(left.session, right.session);

  const arrange = (nodes: SessionTreeNode[]) => {
    nodes.sort(order);
    for (const node of nodes) {
      arrange(node.children);
      node.activity = newest([node.session.modified, ...node.children.map((child) => child.activity)]);
    }
  };
  arrange(roots);
  roots.sort((left, right) => right.activity.localeCompare(left.activity) || order(left, right));
  return roots;
}
