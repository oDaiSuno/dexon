import { useEffect, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { ProjectMenuContent } from "./project-menu";
import { useAnchoredPopover } from "./use-anchored-popover";

const MENU_WIDTH = 216;

const TRIGGER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  padding: 0,
  border: "none",
  borderRadius: "var(--radius-chip)",
  cursor: "pointer",
  transition:
    "background var(--duration-quick) var(--ease-smooth-out), opacity var(--duration-quick) var(--ease-smooth-out)",
};

export interface NavProjectMenuProps {
  spaceName: string;
  projectPath: string;
  revealed?: boolean;
  missing?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  canClose?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onClose?: () => void;
}

export function NavSpaceMenu({
  spaceName,
  projectPath,
  revealed = true,
  missing = false,
  canMoveUp = false,
  canMoveDown = false,
  canClose = false,
  onMoveUp,
  onMoveDown,
  onClose,
}: NavProjectMenuProps) {
  const { t } = useI18n();
  const popover = useAnchoredPopover(MENU_WIDTH);
  const { open, popoverRef: menuRef } = popover;

  useEffect(() => {
    if (open) menuRef.current?.focus();
  }, [open, menuRef]);

  const focusMenuItem = (key: string): boolean => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter(
      (item) => item.getAttribute("aria-disabled") !== "true",
    );
    if (items.length === 0) return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
    const index = items.indexOf(document.activeElement as HTMLElement);
    const target =
      key === "Home"
        ? 0
        : key === "End"
          ? items.length - 1
          : key === "ArrowDown"
            ? (index + 1) % items.length
            : key === "ArrowUp"
              ? index < 0
                ? items.length - 1
                : (index - 1 + items.length) % items.length
              : -1;
    if (target < 0) return false;
    items[target].focus();
    return true;
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (popover.closeOnEscapeOrTab(event)) return;
    if (!focusMenuItem(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      <button
        ref={popover.triggerRef}
        type="button"
        onClick={() => (open ? popover.close() : popover.show())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("projectActionsFor", "Actions for {name}").replace("{name}", spaceName)}
        title={projectPath}
        style={{
          ...TRIGGER_STYLE,
          background: open ? "var(--fx-surface-selected)" : "transparent",
          color: open ? "var(--fx-text-primary)" : "var(--fx-text-tertiary)",
          opacity: revealed || open ? 1 : 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>

      {popover.position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={spaceName}
            tabIndex={-1}
            className="composer-pop-in"
            onKeyDown={onMenuKeyDown}
            style={{
              position: "fixed",
              display: "flex",
              flexDirection: "column",
              width: MENU_WIDTH,
              padding: 4,
              zIndex: 1000,
              background: "var(--fx-surface-raised)",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-menu)",
              boxShadow: "var(--shadow-menu)",
              ...popover.position,
            }}
          >
            <ProjectMenuContent
              missing={missing}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              canClose={canClose}
              onMoveUp={() => popover.choose(() => onMoveUp?.())}
              onMoveDown={() => popover.choose(() => onMoveDown?.())}
              onClose={() => popover.choose(() => onClose?.())}
            />
          </div>,
          document.body,
        )}
    </>
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
