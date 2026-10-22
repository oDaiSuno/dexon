import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import appIconUrl from "../../../../build/icon.png";
import { useI18n } from "@/i18n";
import { AnimatedDropdown } from "../session-sidebar/animated-dropdown";
import { GlideHighlight } from "../chat-input/GlideHighlight";

// Phase 4: top area of the new navigation — collapse toggle, app icon,
// friendly space name, and the space menu holding the abbreviated path plus
// the four space actions. Presentation only: the actions are callbacks owned
// by the future space coordination (wired in Phase 6).

interface SpaceActions {
  onOpenFolder: () => void;
  onChooseFolder: () => void;
  onSwitchSpace: () => void;
  onBackToPersonalSpace: () => void;
}

const MENU_ROW_HEIGHT = 28;

export function NavSpaceMenu({
  spaceName,
  spacePath,
  onToggleExpanded,
  onOpenFolder,
  onChooseFolder,
  onSwitchSpace,
  onBackToPersonalSpace,
}: {
  spaceName: string;
  spacePath: string;
  onToggleExpanded: () => void;
} & SpaceActions) {
  const { t } = useI18n();
  const spaceNameId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const actions: { label: string; icon: ReactNode; run: () => void }[] = [
    {
      label: t("openCurrentFolder", "Open current folder"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </svg>
      ),
      run: onOpenFolder,
    },
    {
      label: t("chooseOtherFolder", "Choose another folder…"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      ),
      run: onChooseFolder,
    },
    {
      label: t("switchSpace", "Switch space…"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 3l4 4-4 4" />
          <path d="M3 11V9a4 4 0 0 1 4-4h10" />
          <path d="M7 21l-4-4 4-4" />
          <path d="M21 13v2a2 2 0 0 1-2 2H7" />
        </svg>
      ),
      run: onSwitchSpace,
    },
    {
      label: t("backToPersonalSpace", "Back to personal space"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      ),
      run: onBackToPersonalSpace,
    },
  ];

  return (
    <div ref={rootRef} style={{ position: "relative", padding: "10px 10px 8px", flexShrink: 0 }}>
      <div
        role="group"
        aria-label={t("workspaceControls", "Workspace controls")}
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        <button
          type="button"
          onClick={onToggleExpanded}
          title={t("hideSidebar", "Hide sidebar")}
          aria-label={t("hideSidebar", "Hide sidebar")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            padding: 0,
            flexShrink: 0,
            background: "transparent",
            border: "none",
            borderRadius: "var(--radius-control)",
            color: "var(--fx-text-secondary)",
            cursor: "pointer",
            transition:
              "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--fx-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--fx-text-secondary)";
          }}
        >
          <PanelLeftIcon />
        </button>
        <img
          src={appIconUrl}
          alt=""
          aria-hidden="true"
          width={18}
          height={18}
          style={{ borderRadius: "var(--radius-chip)", flexShrink: 0 }}
        />
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-labelledby={spaceNameId}
          title={spacePath}
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 6px",
            background: menuOpen ? "var(--bg-hover)" : "transparent",
            border: "none",
            borderRadius: "var(--radius-control)",
            color: "var(--fx-text-primary)",
            cursor: "pointer",
            transition: "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
          }}
          onMouseEnter={(e) => {
            if (!menuOpen) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!menuOpen) e.currentTarget.style.background = "transparent";
          }}
        >
          <span
            id={spaceNameId}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--text-body)",
              fontWeight: 500,
              textAlign: "left",
            }}
          >
            {spaceName}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              color: "var(--fx-text-tertiary)",
              transform: menuOpen ? "rotate(180deg)" : "none",
              transition: "transform var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <AnimatedDropdown
        open={menuOpen}
        style={{
          position: "absolute",
          top: "calc(100% - 2px)",
          left: 8,
          right: 8,
          zIndex: 40,
        }}
      >
        <div
          role="menu"
          aria-label={spaceName}
          className="composer-pop-in"
          style={{
            background: "var(--fx-surface-raised)",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-popover)",
            padding: 4,
          }}
        >
          <div
            style={{
              padding: "6px 8px 8px",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-meta)",
              color: "var(--fx-text-tertiary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              borderBottom: "1px solid var(--fx-line-default)",
              marginBottom: 4,
            }}
          >
            {spacePath}
          </div>
          <div ref={listRef} style={{ position: "relative" }}>
            {actions.map((action, index) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => {
                  setMenuOpen(false);
                  action.run();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  height: MENU_ROW_HEIGHT,
                  padding: "0 8px",
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  color: "var(--fx-text-primary)",
                  cursor: "pointer",
                  fontSize: "var(--text-label)",
                  textAlign: "left",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    color: "var(--fx-text-tertiary)",
                  }}
                >
                  {action.icon}
                </span>
                <span
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {action.label}
                </span>
              </button>
            ))}
            <GlideHighlight
              containerRef={listRef}
              rowSelector='[role="menuitem"]'
              activeIndex={activeIndex}
              visible={activeIndex >= 0}
            />
          </div>
        </div>
      </AnimatedDropdown>
    </div>
  );
}

export function PanelLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}
