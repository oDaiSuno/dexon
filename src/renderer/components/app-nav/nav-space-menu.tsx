import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { subscribeProjectSwitcherRequest } from "@/lib/project-switcher-request";
import { getParentFilePath } from "@shared/file-paths";
import { ProjectSwitcherCard, type SwitcherProject } from "./project-switcher-card";

const CARD_WIDTH = 280;
const CARD_MARGIN = 8;
const CARD_GAP = 4;

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
  projects = [],
  inspectFolder,
  onOpenFolder,
  onChooseFolder,
  onBackToPersonalSpace,
}: {
  spaceName: string;
  projectPath: string;
  homeDir: string;
  revealed?: boolean;
  projects?: readonly SwitcherProject[];
  inspectFolder?: (typed: string) => Promise<string | null>;
  onOpenFolder?: (folder: string) => void;
  onChooseFolder: () => void;
  onBackToPersonalSpace: () => void;
}) {
  const { t } = useI18n();
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = position !== null;

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
    }
  };

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
            <ProjectSwitcherCard
              spaceName={spaceName}
              folderPath={abbreviateHomePath(getParentFilePath(projectPath), homeDir)}
              homeDir={homeDir}
              projects={projects}
              inspectFolder={inspectFolder}
              onOpenFolder={onOpenFolder}
              onChooseFolder={onChooseFolder}
              onBackToPersonalSpace={onBackToPersonalSpace}
              onChoose={choose}
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
