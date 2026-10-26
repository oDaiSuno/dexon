import { useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { MAX_TREE_INDENT_DEPTH, sessionRelation, type SessionTreeNode } from "@/lib/session-tree";
import { descendantActivity, ownActivity, type SessionActivitySignals } from "@/lib/session-tree-status";
import type { SessionRelation } from "@shared/session-orchestration";
import { SessionItem } from "./session-item";

const ROW_HEIGHT = 30;
const CONNECTOR_WIDTH = 10;
const FIRST_LEVEL_INDENT = 25;
const DEEPER_LEVEL_STEP = 4;

function branchIndent(depth: number): number {
  if (depth <= 0) return 0;
  return FIRST_LEVEL_INDENT + (Math.min(depth, MAX_TREE_INDENT_DEPTH) - 1) * DEEPER_LEVEL_STEP;
}

function connectorTone(relation: SessionRelation | null): string {
  return relation === "delegate" ? "var(--fx-accent-blue-text)" : "var(--fx-line-strong)";
}

function countDescendants(node: SessionTreeNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

function BranchConnector({ tone, nextTone }: { tone: string; nextTone: string | null }) {
  return (
    <span
      aria-hidden="true"
      data-session-connector
      style={{ display: "flex", flexDirection: "column", width: CONNECTOR_WIDTH, height: ROW_HEIGHT, flexShrink: 0 }}
    >
      <span
        style={{
          flex: 1,
          borderLeft: `1px dashed ${tone}`,
          borderBottom: `1px dashed ${tone}`,
          borderBottomLeftRadius: nextTone ? 0 : "var(--radius-brand-xs)",
        }}
      />
      <span style={{ flex: 1, borderLeft: nextTone ? `1px dashed ${nextTone}` : undefined }} />
    </span>
  );
}

export function SessionTreeItem({
  node,
  selectedSessionId,
  signals,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
  nextSibling = null,
  homeDir = "",
  foldedSessionIds,
  onToggleFold,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  signals: SessionActivitySignals;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
  nextSibling?: SessionTreeNode | null;
  homeDir?: string;
  foldedSessionIds?: ReadonlySet<string>;
  onToggleFold?: (sessionId: string) => void;
}) {
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = foldedSessionIds ? foldedSessionIds.has(node.session.id) : localCollapsed;
  const toggleCollapsed = onToggleFold
    ? () => onToggleFold(node.session.id)
    : () => setLocalCollapsed((value) => !value);
  const hasChildren = node.children.length > 0;
  const activity = ownActivity(node.session.id, signals);
  const relation = sessionRelation(node.session);
  const indent = branchIndent(depth);
  const nextTone = nextSibling ? connectorTone(sessionRelation(nextSibling.session)) : null;
  const expanded = hasChildren && !collapsed;

  return (
    <div style={{ position: "relative" }}>
      <div
        data-session-branch
        style={{ display: "flex", alignItems: "stretch", paddingLeft: depth > 0 ? indent - CONNECTOR_WIDTH : 0 }}
      >
        {depth > 0 && <BranchConnector tone={connectorTone(relation)} nextTone={nextTone} />}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          isRunning={activity === "running" || activity === "awaiting_input"}
          activity={activity}
          relation={relation}
          descendants={hasChildren && collapsed ? descendantActivity(node, signals) : null}
          descendantCount={hasChildren ? countDescendants(node) : 0}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          homeDir={homeDir}
        />
      </div>
      {expanded &&
        node.children.map((child, index) => (
          <SessionTreeItem
            key={child.session.id}
            node={child}
            selectedSessionId={selectedSessionId}
            signals={signals}
            onSelectSession={onSelectSession}
            onRenamed={onRenamed}
            onSessionDeleted={onSessionDeleted}
            depth={depth + 1}
            nextSibling={node.children[index + 1] ?? null}
            homeDir={homeDir}
            foldedSessionIds={foldedSessionIds}
            onToggleFold={onToggleFold}
          />
        ))}
      {expanded && depth > 0 && nextTone && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: indent - CONNECTOR_WIDTH,
            top: ROW_HEIGHT,
            bottom: 0,
            borderLeft: `1px dashed ${nextTone}`,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
