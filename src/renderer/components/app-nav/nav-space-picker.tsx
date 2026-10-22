import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import { AnimatedDropdown } from "../session-sidebar/animated-dropdown";

export interface SpaceChoice {
  path: string;
  name: string;
  detail: string;
}

export function NavSpacePicker({
  open,
  spaces,
  onSelect,
  onClose,
}: {
  open: boolean;
  spaces: SpaceChoice[];
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <AnimatedDropdown open={open} style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 40 }}>
        <div
          role="menu"
          aria-label={t("switchSpaceList", "Switch space")}
          className="composer-pop-in"
          style={{
            background: "var(--fx-surface-raised)",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-popover)",
            padding: 4,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {spaces.length === 0 ? (
            <div style={{ padding: "6px 8px", fontSize: "var(--text-label)", color: "var(--fx-text-tertiary)" }}>
              {t("noOtherSpaces", "No other spaces yet")}
            </div>
          ) : (
            spaces.map((space) => (
              <button
                key={space.path}
                type="button"
                role="menuitem"
                title={space.path}
                onClick={() => onSelect(space.path)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 1,
                  width: "100%",
                  padding: "5px 8px",
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  color: "var(--fx-text-primary)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    fontSize: "var(--text-label)",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {space.name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-meta)",
                    color: "var(--fx-text-tertiary)",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {space.detail}
                </span>
              </button>
            ))
          )}
        </div>
      </AnimatedDropdown>
    </div>
  );
}
