import { useCallback, useEffect, useState } from "react";
import { Button, Check, Field, NumInput, Select, SectionTitle, TextInput } from "../form-controls";
import { applyStrictOptionalPositiveInteger } from "@/lib/strict-integer";
import { useI18n } from "@/i18n";
import type { ModelEntry, ProviderEntry } from "@/lib/models-config-state";
import { ImageInputIcon, ModelCapabilityList, ReasoningIcon } from "./model-capability-list";
import { ModelConnectionTest } from "./model-connection-test";
import { ThinkingLevelMapEditor } from "./thinking-level-map-editor";
import { API_OPTIONS, type ModelTestState } from "./types";

function modelCostLabel(
  kind: "input" | "output" | "cacheRead" | "cacheWrite",
  t: (key: string, fallback: string) => string,
): string {
  switch (kind) {
    case "input":
      return t("modelCostInput", "input");
    case "output":
      return t("modelCostOutput", "output");
    case "cacheRead":
      return t("modelCostCacheRead", "cache read");
    case "cacheWrite":
      return t("modelCostCacheWrite", "cache write");
  }
}

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

function TokenLabel({ text, unit }: { text: string; unit: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      <span className="type-mono-meta" style={{ color: "var(--fx-text-tertiary)" }}>
        {unit}
      </span>
    </span>
  );
}

export function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
}) {
  const { t } = useI18n();
  const tokensUnit = t("modelTokensUnit", "tokens");
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) =>
    model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return t("modelTestingConnection", "Testing model connection…");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return [t("modelConnectionConnected", "Connected"), ...meta, testState.responseText || null]
        .filter(Boolean)
        .join(" · ");
    }
    return [t("modelConnectionFailed", "Failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
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
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  return (
    <div role="group" aria-label={t("model", "Model")} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field
          label={
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              {t("modelId", "Model ID")}
              <span className="type-label-medium" style={{ color: "var(--fx-accent-blue-text)" }}>
                *
              </span>
            </span>
          }
        >
          <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono />
        </Field>
        <Field label={t("modelName", "Display name")}>
          <TextInput
            value={model.name ?? ""}
            onChange={(v) => set("name", v || undefined)}
            placeholder={t("modelDisplayName", "Display name")}
          />
        </Field>
      </div>

      <ModelCapabilityList
        label={t("modelCapabilities", "Capabilities")}
        capabilities={[
          {
            key: "reasoning",
            icon: <ReasoningIcon />,
            title: t("modelReasoning", "Reasoning"),
            description: t("modelReasoningDescription", "Shows its thinking; adjust the effort in each session"),
            checked: model.reasoning ?? false,
            onChange: (v) => set("reasoning", v || undefined),
          },
          {
            key: "image",
            icon: <ImageInputIcon />,
            title: t("modelImageInput", "Image input"),
            description: t("modelImageInputDescription", "Attach screenshots and images to messages"),
            checked: model.input?.includes("image") ?? false,
            onChange: (v) => set("input", v ? ["text", "image"] : undefined),
          },
        ]}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={<TokenLabel text={t("modelContextWindow", "Context window")} unit={tokensUnit} />}>
          <NumInput
            value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
            onChange={(value) => set("contextWindow", applyStrictOptionalPositiveInteger(model.contextWindow, value))}
            placeholder="128000"
          />
        </Field>
        <Field label={<TokenLabel text={t("modelMaxOutputTokens", "Max output")} unit={tokensUnit} />}>
          <NumInput
            value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
            onChange={(value) => set("maxTokens", applyStrictOptionalPositiveInteger(model.maxTokens, value))}
            placeholder="16384"
          />
        </Field>
      </div>

      <Field label={t("modelApiOverride", "API override")}>
        <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
      </Field>

      {model.reasoning && (
        <>
          <Check
            label={t("modelDeepSeekCompat", "DeepSeek thinking compatibility")}
            checked={hasDeepseekCompat(model)}
            onChange={(v) => onChange(setDeepseekCompat(model, v))}
          />
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <SectionTitle>{t("modelThinkingLevelMap", "Thinking level map")}</SectionTitle>
              {model.thinkingLevelMap && (
                <Button variant="ghost" onClick={() => set("thinkingLevelMap", undefined)}>
                  {t("modelClearAll", "Clear all")}
                </Button>
              )}
            </div>
            <ThinkingLevelMapEditor value={model.thinkingLevelMap} onChange={(v) => set("thinkingLevelMap", v)} />
          </div>
        </>
      )}

      <div>
        <SectionTitle>{t("modelCostPerMillion", "Cost (per million tokens)")}</SectionTitle>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <Field key={k} label={modelCostLabel(k, t)}>
              <NumInput value={costVal(k)} onChange={(v) => setCost(k, v)} placeholder="0" />
            </Field>
          ))}
        </div>
      </div>

      <ModelConnectionTest
        state={testState}
        summary={testSummary}
        disabled={!model.id.trim() || testState.phase === "testing"}
        onTest={handleTest}
      />
    </div>
  );
}
