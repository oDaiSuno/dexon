import { Button } from "../form-controls";
import { useI18n } from "@/i18n";
import type { ModelTestState } from "./types";

const SUMMARY_TONE = {
  testing: {
    border: "var(--fx-line-default)",
    background: "var(--fx-surface-card)",
    color: "var(--fx-text-secondary)",
  },
  success: {
    border: "var(--fx-status-success-border)",
    background: "var(--fx-status-success-soft)",
    color: "var(--fx-status-success-text)",
  },
  error: {
    border: "var(--fx-status-danger-border)",
    background: "var(--fx-status-danger-soft)",
    color: "var(--fx-status-danger-text)",
  },
} as const;

export function ModelConnectionTest({
  state,
  summary,
  disabled,
  onTest,
}: {
  state: ModelTestState;
  summary: string | null;
  disabled: boolean;
  onTest: () => void;
}) {
  const { t } = useI18n();
  const tone = state.phase === "idle" ? null : SUMMARY_TONE[state.phase];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <Button
        onClick={onTest}
        disabled={disabled}
        busy={state.phase === "testing"}
        title={t("modelTestConnection", "Test model connection")}
      >
        {state.phase === "success" && (
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {state.phase === "testing" ? t("testingConnection", "Testing…") : t("modelTest", "Test")}
      </Button>
      {summary && tone && (
        <span
          role="status"
          title={summary}
          className="type-label-default"
          style={{
            flex: 1,
            minWidth: 0,
            height: 24,
            padding: "0 8px",
            display: "inline-flex",
            alignItems: "center",
            boxSizing: "border-box",
            border: `1px solid ${tone.border}`,
            borderRadius: "var(--radius-chip)",
            background: tone.background,
            color: tone.color,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {summary}
        </span>
      )}
    </div>
  );
}
