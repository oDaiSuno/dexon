import { useCallback, useEffect, useState } from "react";
import { Button } from "../form-controls";
import { useI18n } from "@/i18n";
import type { ModelEntry, ProviderEntry } from "@/lib/models-config-state";
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

export function useModelConnectionTest({
  providerName,
  provider,
  model,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ModelTestState>({ phase: "idle" });

  const summary = (() => {
    if (state.phase === "idle") return null;
    if (state.phase === "testing") return t("modelTestingConnection", "Testing model connection…");
    const meta = [
      state.latencyMs !== undefined ? `${state.latencyMs}ms` : null,
      state.status !== undefined ? `HTTP ${state.status}` : null,
    ].filter(Boolean);
    if (state.phase === "success") {
      return [t("modelConnectionConnected", "Connected"), ...meta, state.responseText || null]
        .filter(Boolean)
        .join(" · ");
    }
    return [t("modelConnectionFailed", "Failed"), ...meta, state.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  const run = useCallback(async () => {
    if (!model.id.trim() || state.phase === "testing") return;
    setState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, state.phase]);

  return { state, summary, disabled: !model.id.trim() || state.phase === "testing", run };
}

export function ModelTestButton({
  state,
  disabled,
  onTest,
}: {
  state: ModelTestState;
  disabled: boolean;
  onTest: () => void;
}) {
  const { t } = useI18n();

  return (
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
  );
}

export function ModelTestStatus({ state, summary }: { state: ModelTestState; summary: string | null }) {
  if (state.phase === "idle" || !summary) return null;
  const tone = SUMMARY_TONE[state.phase];

  return (
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
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
    </span>
  );
}
