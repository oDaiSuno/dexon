import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";

export type RightPanelTogglePlacement = "top-bar" | "panel";

export function useRightPanelToggleFocus(onToggle: () => void) {
  const [focusTarget, setFocusTarget] = useState<RightPanelTogglePlacement | null>(null);
  const toggleFrom = useCallback(
    (placement: RightPanelTogglePlacement) => {
      setFocusTarget(placement === "panel" ? "top-bar" : "panel");
      onToggle();
    },
    [onToggle],
  );
  const clearFocusTarget = useCallback(() => setFocusTarget(null), []);
  return { focusTarget, toggleFrom, clearFocusTarget };
}

export function RightPanelToggle({
  placement,
  onToggle,
  focusRequested = false,
  onFocusHandled,
}: {
  placement: RightPanelTogglePlacement;
  onToggle: () => void;
  focusRequested?: boolean;
  onFocusHandled?: () => void;
}) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const open = placement === "panel";
  const label = open ? t("hideFilePanel", "Hide file panel") : t("showFilePanel", "Show file panel");

  useEffect(() => {
    if (!focusRequested) return;
    buttonRef.current?.focus();
    onFocusHandled?.();
  }, [focusRequested, onFocusHandled]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      className={`right-panel-toggle right-panel-toggle-${placement}`}
      data-open={open}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M15 3v18" />
      </svg>
    </button>
  );
}
