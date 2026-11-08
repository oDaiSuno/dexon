import type { SessionTreeNode } from "./session-tree";
import {
  descendantActivity,
  indicatedPulseActivity,
  isPulseActivity,
  ownActivity,
  type SessionActivity,
  type SessionActivitySignals,
} from "./session-tree-status";

function containsSession(node: SessionTreeNode, sessionId: string | null): boolean {
  return node.session.id === sessionId || node.children.some((child) => containsSession(child, sessionId));
}

export function partitionSessionRoots(
  roots: readonly SessionTreeNode[],
  {
    now,
    signals,
    selectedSessionId,
  }: {
    now: number;
    signals: SessionActivity | SessionActivitySignals;
    selectedSessionId: string | null;
  },
): {
  visible: readonly SessionTreeNode[];
  hiddenCount: number;
} {
  const cutoff = now - 72 * 3_600_000;
  const visible = roots.filter(
    (node, index) =>
      index < 5 ||
      Date.parse(node.activity) >= cutoff ||
      (selectedSessionId !== null && containsSession(node, selectedSessionId)) ||
      isPulseActivity(indicatedPulseActivity(ownActivity(node.session.id, signals), descendantActivity(node, signals))),
  );
  return { visible, hiddenCount: roots.length - visible.length };
}
