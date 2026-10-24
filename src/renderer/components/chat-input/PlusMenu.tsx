import { useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { GlideHighlight } from "./GlideHighlight";
import { Icon, ImageIcon } from "./icons";
import { MenuPanel } from "./menu-chrome";
import { KeyHint } from "./SendControls";

export interface PlusMenuRow {
  key: string;
  name: string;
  desc: React.ReactNode;
  icon: React.ReactNode;
  count?: string;
  trailing?: React.ReactNode;
  submenu?: boolean;
  onSelect: () => void;
}

export function PlusMenu({ rows }: { rows: PlusMenuRow[] }) {
  const { t } = useI18n();
  const rowsRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);

  return (
    <MenuPanel role="menu">
      <div
        ref={rowsRef}
        onMouseLeave={() => setEngaged(false)}
        style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2, padding: 6 }}
      >
        <GlideHighlight
          containerRef={rowsRef}
          rowSelector='[role="menuitem"]'
          activeIndex={active}
          visible={engaged && rows.length > 0}
          insetX={6}
          radius="var(--radius-menu-row)"
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
                borderRadius: "var(--radius-menu-row)",
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
              {typeof row.desc === "string" ? (
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
              ) : (
                row.desc
              )}
              {row.count && (
                <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
                  {row.count}
                </span>
              )}
              {row.trailing}
              {row.submenu && (
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
      <div
        style={{
          height: 34,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "0 var(--space-3-5)",
          borderTop: "1px solid var(--fx-line-default)",
          background: "var(--fx-surface-inset)",
        }}
      >
        <span aria-hidden style={{ flexShrink: 0, display: "flex", color: "var(--fx-text-tertiary)" }}>
          <ImageIcon size={13} />
        </span>
        <span
          className="type-meta-default"
          style={{
            minWidth: 0,
            color: "var(--fx-text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {t("plusMenuDragHint", "You can also drag files straight into the input box")}
        </span>
        <span style={{ flex: 1 }} />
        <KeyHint keyLabel="esc" label={t("close", "Close")} />
      </div>
    </MenuPanel>
  );
}
