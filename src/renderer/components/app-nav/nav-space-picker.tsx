import { useEffect, useRef, type CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { AnimatedDropdown } from "../session-sidebar/animated-dropdown";

export interface SpaceChoice {
  path: string;
  name: string;
  detail: string;
}

export const SPACE_CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  background: "var(--fx-surface-raised)",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-dialog)",
  boxShadow: "var(--shadow-popover)",
  padding: 6,
};

export const SPACE_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "0 10px",
  flexShrink: 0,
  background: "var(--fx-surface-hover-clear)",
  border: "none",
  borderRadius: "var(--radius-control)",
  textAlign: "left",
};

const ELLIPSIS: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export function SpaceIdentity({ name, detail, current = false }: { name: string; detail: string; current?: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          flexShrink: 0,
          color: "var(--fx-text-secondary)",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </svg>
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
        <span className="type-body-large-medium" style={{ ...ELLIPSIS, color: "var(--fx-text-primary)" }}>
          {name}
        </span>
        <span className="type-mono-meta" style={{ ...ELLIPSIS, color: "var(--fx-text-tertiary)" }}>
          {detail}
        </span>
      </span>
      {current && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, color: "var(--fx-accent-blue-text)" }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </>
  );
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
          style={{ ...SPACE_CARD_STYLE, maxHeight: 280, overflowY: "auto" }}
        >
          {spaces.length === 0 ? (
            <div
              className="type-body-default"
              style={{
                display: "flex",
                alignItems: "center",
                height: 36,
                padding: "0 10px",
                color: "var(--fx-text-tertiary)",
              }}
            >
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
                style={{ ...SPACE_ROW_STYLE, height: 46, cursor: "pointer" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--fx-surface-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--fx-surface-hover-clear)";
                }}
              >
                <SpaceIdentity name={space.name} detail={space.detail} />
              </button>
            ))
          )}
        </div>
      </AnimatedDropdown>
    </div>
  );
}
