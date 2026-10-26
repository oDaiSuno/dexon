import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { SkillDetail } from "../skills/skill-detail";
import type { Skill } from "../skills/skill-shared";
import { XIcon } from "./overview-icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SkillDrawer({
  skill,
  cwd,
  toggling,
  saveError,
  onToggle,
  onClose,
}: {
  skill: Skill;
  cwd: string;
  toggling: boolean;
  saveError: string | null;
  onToggle: (skill: Skill) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const returnFocus = returnFocusRef.current;
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.getClientRects().length > 0,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[1000] flex justify-end bg-[var(--fx-surface-scrim)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`flex h-full w-[440px] max-w-full flex-col border-0 border-l border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-main)] shadow-[var(--shadow-dialog)] outline-none transition-transform duration-[var(--duration-glide)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none ${
          entered ? "translate-x-0" : "translate-x-[100%]"
        }`}
      >
        <header className="flex shrink-0 items-center gap-[12px] px-[20px] pt-[16px] pb-[12px]">
          <h2 id={titleId} className="type-title-section m-0 min-w-0 flex-1 truncate text-[var(--fx-text-primary)]">
            {skill.name}
          </h2>
          <Button variant="ghost" aria-label={t("close", "Close")} className="w-[28px] px-0" onClick={onClose}>
            <XIcon size={16} />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[20px]">
          <SkillDetail skill={skill} cwd={cwd} toggling={toggling} saveError={saveError} onToggle={onToggle} />
        </div>
      </div>
    </div>
  );
}
