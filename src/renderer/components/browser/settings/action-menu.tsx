import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ActionMenuItem = {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type ActionMenuTriggerProps = {
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

const MENU_GAP = 8;
const ITEM_HEIGHT = 33;
const LIST_PADDING = 10;

export function ActionMenu({
  label,
  items,
  trigger,
}: {
  label: string;
  items: ActionMenuItem[];
  trigger: (props: ActionMenuTriggerProps) => ReactNode;
}) {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = position !== null;

  const enabledItems = () => [
    ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []),
  ];
  const focusTrigger = () => rootRef.current?.querySelector<HTMLElement>("[aria-haspopup='menu']")?.focus();

  const show = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = items.length * ITEM_HEIGHT + LIST_PADDING;
    const right = window.innerWidth - rect.right;
    const fitsBelow = rect.bottom + MENU_GAP + height <= window.innerHeight;
    setPosition(
      fitsBelow
        ? { top: rect.bottom + MENU_GAP, right }
        : { top: "auto", bottom: window.innerHeight - rect.top + MENU_GAP, right },
    );
  };
  const close = () => {
    setPosition(null);
    focusTrigger();
  };

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setPosition(null);
    };
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setPosition(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const choose = (item: ActionMenuItem) => {
    close();
    item.onSelect();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
      return;
    }
    const entries = enabledItems();
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const target = {
      ArrowDown: entries[(index + 1) % entries.length],
      ArrowUp: entries[(index - 1 + entries.length) % entries.length],
      Home: entries[0],
      End: entries[entries.length - 1],
    }[event.key];
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <div ref={rootRef} style={{ flexShrink: 0 }}>
      {trigger({
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => (open ? setPosition(null) : show()),
        onKeyDown: (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          show();
        },
      })}
      {position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className="session-menu-card session-menu-card--menu composer-pop-in"
            style={{ ...menuStyle, ...position }}
            onKeyDown={onMenuKeyDown}
          >
            <div className="session-menu-list">
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={
                    item.danger
                      ? "session-menu-item session-menu-item--danger type-body-large"
                      : "session-menu-item type-body-large"
                  }
                  style={item.disabled ? disabledItemStyle : undefined}
                  onClick={() => choose(item)}
                >
                  <span className="session-menu-item-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

const menuStyle: CSSProperties = { position: "fixed", zIndex: 1000 };
const disabledItemStyle: CSSProperties = {
  background: "var(--fx-surface-hover-clear)",
  color: "var(--fx-text-faint)",
  cursor: "default",
};
