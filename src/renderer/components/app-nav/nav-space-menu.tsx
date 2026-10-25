import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { subscribeProjectSwitcherRequest } from "@/lib/project-switcher-request";
import { getParentFilePath } from "@shared/file-paths";
import { GlideHighlight } from "../chat-input/GlideHighlight";

const CARD_WIDTH = 280;
const CARD_MARGIN = 8;
const CARD_GAP = 4;
const ACTION_ROW_HEIGHT = 36;

const FOLDER_PATH = "M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z";
const HOUSE_PATHS = [
  "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
  "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
];

const ELLIPSIS: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function MenuIcon({
  size = 16,
  strokeWidth = 2,
  style,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {children}
    </svg>
  );
}

function iconBox(children: ReactNode) {
  return (
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
      {children}
    </span>
  );
}

const ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "0 10px",
  flexShrink: 0,
  background: "var(--fx-surface-hover-clear)",
  textAlign: "left",
};

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

export function NavSpaceMenu({
  spaceName,
  projectPath,
  homeDir,
  revealed = true,
  onChooseFolder,
  onBackToPersonalSpace,
}: {
  spaceName: string;
  projectPath: string;
  homeDir: string;
  revealed?: boolean;
  onChooseFolder: () => void;
  onBackToPersonalSpace: () => void;
}) {
  const { t } = useI18n();
  const mac = window.piBridge?.platform === "darwin";
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = position !== null;

  const actions: { label: string; icon: ReactNode; run: () => void; shortcut?: { label: string; aria: string } }[] = [
    {
      label: t("addProjectSpace", "Add project space from folder…"),
      icon: (
        <MenuIcon>
          <path d={FOLDER_PATH} />
          <path d="M12 11v6" />
          <path d="M9 14h6" />
        </MenuIcon>
      ),
      run: onChooseFolder,
      shortcut: mac ? { label: "⌘O", aria: "Meta+O" } : { label: "Ctrl O", aria: "Control+O" },
    },
    {
      label: t("backToPersonalSpace", "Back to personal space"),
      icon: (
        <MenuIcon>
          {HOUSE_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </MenuIcon>
      ),
      run: onBackToPersonalSpace,
    },
  ];

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + CARD_GAP,
      left: Math.max(CARD_MARGIN, Math.min(rect.right - CARD_WIDTH, window.innerWidth - CARD_WIDTH - CARD_MARGIN)),
    });
  };

  const close = () => {
    setPosition(null);
    triggerRef.current?.focus();
  };

  const choose = (run: () => void) => {
    close();
    run();
  };

  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => subscribeProjectSwitcherRequest(() => showRef.current()), []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setPosition(null);
    };
    const onDismiss = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setPosition(null);
    };
    const onResize = () => setPosition(null);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const entries = items();
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const target = {
      ArrowDown: entries[(index + 1) % entries.length],
      ArrowUp: entries[index <= 0 ? entries.length - 1 : index - 1],
      Home: entries[0],
      End: entries[entries.length - 1],
    }[event.key];
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    target.focus();
  };

  const folderPath = abbreviateHomePath(getParentFilePath(projectPath), homeDir);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : show())}
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

      {position &&
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
              gap: 2,
              width: CARD_WIDTH,
              padding: 6,
              zIndex: 1000,
              background: "var(--fx-surface-raised)",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-dialog)",
              boxShadow: "var(--shadow-popover)",
              ...position,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", padding: "10px 10px 4px 10px", flexShrink: 0 }}>
              <span className="type-meta-caps" style={{ color: "var(--fx-text-tertiary)" }}>
                {t("currentProjectGroup", "Current project")}
              </span>
            </div>

            <div style={{ ...ROW_STYLE, height: 46, borderRadius: "var(--radius-icon-box)" }}>
              {iconBox(
                <MenuIcon size={18} strokeWidth={1.5}>
                  <path d={FOLDER_PATH} />
                </MenuIcon>,
              )}
              <span style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
                <span className="type-body-large-medium" style={{ ...ELLIPSIS, color: "var(--fx-text-primary)" }}>
                  {spaceName}
                </span>
                <span className="type-mono-meta" style={{ ...ELLIPSIS, color: "var(--fx-text-tertiary)" }}>
                  {folderPath}
                </span>
              </span>
              <MenuIcon style={{ flexShrink: 0, color: "var(--fx-accent-blue-text)" }}>
                <polyline points="20 6 9 17 4 12" />
              </MenuIcon>
            </div>

            <div aria-hidden="true" style={{ padding: "5px 4px", flexShrink: 0 }}>
              <div style={{ height: 1, background: "var(--fx-line-default)" }} />
            </div>

            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2 }}>
              {actions.map((action, index) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className="type-body-default"
                  aria-label={action.label}
                  aria-keyshortcuts={action.shortcut?.aria}
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => choose(action.run)}
                  style={{
                    ...ROW_STYLE,
                    height: ACTION_ROW_HEIGHT,
                    borderRadius: "var(--radius-control)",
                    color: "var(--fx-text-body)",
                    cursor: "pointer",
                    position: "relative",
                    zIndex: 1,
                  }}
                >
                  {iconBox(action.icon)}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {action.label}
                  </span>
                  {action.shortcut && (
                    <span
                      aria-hidden="true"
                      className="type-mono-meta"
                      style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
                    >
                      {action.shortcut.label}
                    </span>
                  )}
                </button>
              ))}
              <GlideHighlight
                rowSelector='[role="menuitem"]'
                activeIndex={activeIndex}
                visible={activeIndex >= 0}
                insetX={0}
              />
            </div>
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
