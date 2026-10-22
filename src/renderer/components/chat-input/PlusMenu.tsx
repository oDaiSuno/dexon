import { useRef, useState } from "react";
import { GlideHighlight } from "./GlideHighlight";
import { Icon } from "./icons";

/**
 * "＋" expand menu above the composer, styled after the PromptBar reference:
 * a full-width panel rising from the composer's top edge with one gliding
 * highlight (a single background pill that floats between rows) instead of
 * per-row background toggling. Rows are icon + name + description on one
 * line, with a muted footer strip for a static hint.
 */

export interface PlusMenuRow {
  key: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export function PlusMenu({ rows }: { rows: PlusMenuRow[] }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);

  return (
    <div
      ref={panelRef}
      className="composer-pop-in"
      role="menu"
      onMouseLeave={() => setEngaged(false)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-composer)",
        boxShadow: "var(--shadow-popover)",
        padding: 6,
        transformOrigin: "bottom center",
      }}
    >
      {/* single gliding highlight — floats to the hovered row */}
      <GlideHighlight
        containerRef={panelRef}
        rowSelector='[role="menuitem"]'
        activeIndex={active}
        visible={engaged && rows.length > 0}
        insetX={6}
      />
      {rows.map((row, index) => {
        const lit = engaged && index === active;
        return (
          <button
            key={row.key}
            type="button"
            role="menuitem"
            onMouseDown={(e) => {
              e.preventDefault();
              row.onSelect();
            }}
            onMouseEnter={() => {
              setActive(index);
              setEngaged(true);
            }}
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              height: 40,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "0 var(--space-3) 0 10px",
              border: "none",
              borderRadius: "var(--radius-control)",
              background: "none",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: lit ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              }}
            >
              {row.icon}
            </span>
            <span className="type-body-medium" style={{ flexShrink: 0, color: "var(--fx-text-primary)" }}>
              {row.name}
            </span>
            <span
              className="type-label-default"
              style={{
                minWidth: 0,
                flex: 1,
                color: "var(--fx-text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.desc}
            </span>
            {row.key === "skill" && (
              <span style={{ flexShrink: 0, display: "flex", color: "var(--fx-text-tertiary)" }}>
                <Icon size={14} strokeWidth={2}>
                  <path d="m9 18 6-6-6-6" />
                </Icon>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
