import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { RowIcon } from "./session-relation-glyphs";

export function LoaderGlyph({ size }: { size: number }) {
  return (
    <RowIcon size={size} strokeWidth={2}>
      <g>
        <path d="M12 2v4" />
        <path d="m16.2 7.8 2.9-2.9" />
        <path d="M18 12h4" />
        <path d="m16.2 16.2 2.9 2.9" />
        <path d="M12 18v4" />
        <path d="m4.9 19.1 2.9-2.9" />
        <path d="M2 12h4" />
        <path d="m4.9 4.9 2.9 2.9" />
      </g>
    </RowIcon>
  );
}

export function QuestionGlyph({ size }: { size: number }) {
  return (
    <RowIcon size={size} strokeWidth={2}>
      <g>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </g>
    </RowIcon>
  );
}

export function AlertGlyph({ size }: { size: number }) {
  return (
    <RowIcon size={size} strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </RowIcon>
  );
}

const PILL_TONES = {
  warning: {
    border: "var(--fx-status-warning-border)",
    fill: "var(--fx-status-warning-soft)",
    icon: "var(--fx-status-warning)",
    text: "var(--fx-status-warning-text)",
  },
  danger: {
    border: "var(--fx-status-danger-border)",
    fill: "var(--fx-status-danger-soft)",
    icon: "var(--fx-status-danger)",
    text: "var(--fx-status-danger-text)",
  },
};

function StatusPill({ tone, label, icon }: { tone: keyof typeof PILL_TONES; label: string; icon: ReactNode }) {
  const colors = PILL_TONES[tone];
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        flexShrink: 0,
        padding: "1px 7px 1px 5px",
        border: `1px solid ${colors.border}`,
        borderRadius: "var(--radius-status)",
        background: colors.fill,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", color: colors.icon }}>{icon}</span>
      <span className="type-label-default" style={{ color: colors.text }}>
        {label}
      </span>
    </span>
  );
}

export function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("agentRunning", "Agent is running…")}
      aria-label={t("agentRunningStatus", "Agent running")}
      style={{ display: "inline-flex", flexShrink: 0, color: "var(--fx-accent-blue-text)" }}
    >
      <span className="session-status-spin">
        <LoaderGlyph size={13} />
      </span>
    </span>
  );
}

export function AwaitingInputSessionIndicator() {
  const { t } = useI18n();
  return (
    <StatusPill
      tone="warning"
      label={t("sessionStatusAwaitingInput", "Waiting for your answer")}
      icon={
        <span className="session-status-pulse">
          <QuestionGlyph size={12} />
        </span>
      }
    />
  );
}

export function FailedTurnSessionIndicator() {
  const { t } = useI18n();
  return <StatusPill tone="danger" label={t("sessionStatusError", "Failed")} icon={<AlertGlyph size={12} />} />;
}

export function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("newSessionActivity", "New activity")}
      aria-label={t("newSessionActivityLabel", "New session activity")}
      style={{
        width: 6,
        height: 6,
        flexShrink: 0,
        borderRadius: "var(--radius-pill)",
        background: "var(--fx-accent-blue)",
      }}
    />
  );
}
