import { useId, useState } from "react";
import { Button, Check, Field, NumInput, Select, SectionTitle } from "../form-controls";
import { useI18n } from "@/i18n";
import type { ModelEntry } from "@/lib/models-config-state";
import { rowHover, rowStyle } from "./provider-dialog-parts";
import { ThinkingLevelMapEditor } from "./thinking-level-map-editor";
import { API_OPTIONS } from "./types";

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

export function ModelAdvancedSettings({ model, onChange }: { model: ModelEntry; onChange: (m: ModelEntry) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) =>
    model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="type-body-medium"
        {...rowHover}
        style={{
          ...rowStyle,
          gap: 6,
          height: 32,
          padding: "0 4px",
          margin: "0 -4px",
          width: "calc(100% + 8px)",
          color: "var(--fx-text-secondary)",
        }}
      >
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
          style={{
            flexShrink: 0,
            transform: open ? "rotate(90deg)" : undefined,
            transition: "transform var(--duration-quick) var(--ease-smooth-out)",
          }}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        {t("modelAdvancedSettings", "Advanced settings")}
      </button>
      {open && (
        <div id={panelId} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}
                >
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
        </div>
      )}
    </section>
  );
}
