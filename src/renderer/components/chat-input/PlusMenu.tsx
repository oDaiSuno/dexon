import { useRef, useState } from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { GlideHighlight } from "./GlideHighlight";

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
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow:
          "0 -10px 32px color-mix(in srgb, #000 18%, transparent), 0 2px 10px color-mix(in srgb, #000 10%, transparent)",
        padding: 4,
        transformOrigin: "bottom center",
      }}
    >
      {/* single gliding highlight — floats to the hovered row */}
      <GlideHighlight
        containerRef={panelRef}
        rowSelector='[role="menuitem"]'
        activeIndex={active}
        visible={engaged && rows.length > 0}
      />
      {rows.map((row, index) => (
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
            height: 36,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 8px",
            border: "none",
            borderRadius: 6,
            background: "none",
            cursor: "pointer",
            textAlign: "left",
            font: "inherit",
            color: "inherit",
          }}
        >
          <span
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
            }}
          >
            {row.icon}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: scaledChatFont(12.5),
              fontWeight: 500,
              color: "var(--text)",
            }}
          >
            {row.name}
          </span>
          <span
            style={{
              minWidth: 0,
              flex: 1,
              fontSize: scaledChatFont(12),
              color: "var(--text-dim)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.desc}
          </span>
        </button>
      ))}
    </div>
  );
}
