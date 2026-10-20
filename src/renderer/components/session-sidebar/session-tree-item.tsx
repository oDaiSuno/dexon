import { useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { MAX_TREE_INDENT_DEPTH, sessionRelation, type SessionTreeNode } from "@/lib/session-tree";
import { descendantActivity, ownActivity, type SessionActivitySignals } from "@/lib/session-tree-status";
import { SessionItem } from "./session-item";

export function SessionTreeItem({
  node,
  selectedSessionId,
  signals,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
  homeDir,
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
  homeDir: string;
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
  const indent = Math.min(depth, MAX_TREE_INDENT_DEPTH);

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div
            style={{
              position: "absolute",
              left: indent * 12 + 6,
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--border)",
              pointerEvents: "none",
            }}
          />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          isRunning={activity === "running" || activity === "awaiting_input"}
          activity={activity}
          relation={sessionRelation(node.session)}
          descendants={hasChildren && collapsed ? descendantActivity(node, signals) : null}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          homeDir={homeDir}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              signals={signals}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
              homeDir={homeDir}
              foldedSessionIds={foldedSessionIds}
              onToggleFold={onToggleFold}
            />
          ))}
        </div>
      )}
    </div>
  );
}
