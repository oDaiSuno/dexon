import type { ReactNode } from "react";
import { useI18n } from "@/i18n";

const ITEM_HEIGHT = 32;

function ArrowUpGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-text-secondary)" }}
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function ArrowDownGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-text-secondary)" }}
    >
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-text-secondary)" }}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function WarningGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-status-warning)" }}
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function MenuItem({
  label,
  icon,
  disabled,
  onChoose,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      aria-disabled={disabled ? true : undefined}
      onClick={onChoose}
      onMouseEnter={(event) => {
        if (disabled) return;
        event.currentTarget.style.background = "var(--fx-surface-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
      className="type-body-large"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        height: ITEM_HEIGHT,
        padding: "0 10px",
        border: "none",
        borderRadius: "var(--radius-control)",
        background: "transparent",
        color: disabled ? "var(--fx-text-tertiary)" : "var(--fx-text-primary)",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
      }}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </button>
  );
}

export function ProjectMenuContent({
  missing,
  canMoveUp,
  canMoveDown,
  canClose,
  onMoveUp,
  onMoveDown,
  onClose,
}: {
  missing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canClose: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {missing && (
        <div
          className="type-label-default"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 14px 6px 14px",
            color: "var(--fx-text-secondary)",
          }}
        >
          <WarningGlyph />
          <span>{t("missingFolderNote", "This folder was moved or deleted. Its sessions are kept.")}</span>
        </div>
      )}
      <MenuItem
        label={t("moveProjectUp", "Move up")}
        icon={<ArrowUpGlyph />}
        disabled={!canMoveUp}
        onChoose={() => {
          if (canMoveUp) onMoveUp();
        }}
      />
      <MenuItem
        label={t("moveProjectDown", "Move down")}
        icon={<ArrowDownGlyph />}
        disabled={!canMoveDown}
        onChoose={() => {
          if (canMoveDown) onMoveDown();
        }}
      />
      <div aria-hidden="true" style={{ padding: "4px 6px" }}>
        <div style={{ height: 1, background: "var(--fx-surface-selected)" }} />
      </div>
      <MenuItem
        label={t("closeProject", "Close project")}
        icon={<CloseGlyph />}
        disabled={!canClose}
        onChoose={() => {
          if (canClose) onClose();
        }}
      />
    </>
  );
}
