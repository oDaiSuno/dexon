import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "@contract/types";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { sessionTitle } from "./binding-presentation";
import { CheckIcon, EllipsisIcon, MenuTrashIcon } from "./channel-icons";

const MENU_GAP = 6;
const MENU_WIDTH = 248;
const MENU_MAX_HEIGHT = 320;

export function BindingMenu({
  label,
  name,
  sessionId,
  sessions,
  busy,
  onAttach,
  onDisconnect,
}: {
  label: string;
  name: string;
  sessionId?: string;
  sessions: SessionInfo[];
  busy: boolean;
  onAttach: (sessionId: string | undefined) => void;
  onDisconnect: () => void;
}) {
  const { t } = useI18n();
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = position !== null;

  const entries = () => [
    ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']:not(:disabled)") ?? []),
  ];

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const right = window.innerWidth - rect.right;
    const fitsBelow = rect.bottom + MENU_GAP + MENU_MAX_HEIGHT <= window.innerHeight;
    setConfirming(false);
    setPosition(
      fitsBelow
        ? { top: rect.bottom + MENU_GAP, right }
        : { top: "auto", bottom: window.innerHeight - rect.top + MENU_GAP, right },
    );
  };

  const close = () => {
    setPosition(null);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const items = entries();
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setPosition(null);
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

  const choose = (action: () => void) => {
    close();
    action();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
      return;
    }
    const items = entries();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = {
      ArrowDown: items[(index + 1) % items.length],
      ArrowUp: items[(index - 1 + items.length) % items.length],
      Home: items[0],
      End: items[items.length - 1],
    }[event.key];
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const targets: { id: string | undefined; title: string }[] = [
    { id: undefined, title: t("dedicatedImSession", "Separate session") },
    ...sessions.map((session) => ({ id: session.id, title: sessionTitle(session) })),
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ui-link-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setPosition(null) : show())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          show();
        }}
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          justifyContent: "center",
          padding: 0,
          borderRadius: "var(--radius-row)",
          color: "var(--fx-text-tertiary)",
        }}
      >
        <EllipsisIcon />
      </button>
      {position &&
        createPortal(
          confirming ? (
            <div
              ref={menuRef}
              role="alertdialog"
              aria-label={t("disconnectBindingConfirm", "Disconnect “{name}”?").replace("{name}", name)}
              className="session-menu-card session-menu-card--confirm composer-pop-in"
              style={{ ...menuStyle, ...position }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                close();
              }}
            >
              <div className="session-menu-confirm-body">
                <span className="session-menu-confirm-icon">
                  <MenuTrashIcon />
                </span>
                <div className="session-menu-confirm-text">
                  <div className="type-body-large-medium">
                    {t("disconnectBindingTitle", "Disconnect this conversation?")}
                  </div>
                  <p className="session-menu-confirm-notice type-label-default">
                    {t("disconnectBindingNotice", "New messages from {name} will go to a separate session.").replace(
                      "{name}",
                      name,
                    )}
                  </p>
                </div>
              </div>
              <div className="session-menu-confirm-footer">
                <Button variant="danger" busy={busy} disabled={busy} onClick={() => choose(onDisconnect)}>
                  {t("unbind", "Disconnect")}
                </Button>
                <Button autoFocus disabled={busy} onClick={close}>
                  {t("cancel", "Cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              className="session-menu-card composer-pop-in"
              style={{ ...menuStyle, ...position }}
              onKeyDown={onMenuKeyDown}
            >
              <div className="session-menu-list" style={{ maxHeight: MENU_MAX_HEIGHT - 48, overflowY: "auto" }}>
                {targets.map((target) => {
                  const checked = target.id === sessionId;
                  return (
                    <button
                      key={target.id ?? ""}
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      disabled={busy}
                      className="session-menu-item type-body-large"
                      onClick={() => choose(() => onAttach(target.id))}
                    >
                      <span className="session-menu-item-label">{target.title}</span>
                      <span
                        className="session-menu-item-icon"
                        style={{ color: "var(--fx-accent-blue-text)", visibility: checked ? "visible" : "hidden" }}
                      >
                        <CheckIcon />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="session-menu-separator">
                <div />
              </div>
              <div className="session-menu-list">
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  className="session-menu-item session-menu-item--danger type-body-large"
                  onClick={() => setConfirming(true)}
                >
                  <span className="session-menu-item-icon">
                    <MenuTrashIcon />
                  </span>
                  <span className="session-menu-item-label">{t("deleteBinding", "Disconnect this conversation")}</span>
                </button>
              </div>
            </div>
          ),
          document.body,
        )}
    </>
  );
}

const menuStyle: CSSProperties = { position: "fixed", zIndex: 1200, width: MENU_WIDTH };
