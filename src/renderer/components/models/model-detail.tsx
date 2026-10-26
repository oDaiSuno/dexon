import { Field, NumInput, TextInput } from "../form-controls";
import { applyStrictOptionalPositiveInteger } from "@/lib/strict-integer";
import { useI18n } from "@/i18n";
import type { ModelEntry } from "@/lib/models-config-state";
import { ModelAdvancedSettings } from "./model-advanced-settings";
import { ImageInputIcon, ModelCapabilityList, ReasoningIcon } from "./model-capability-list";

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

export function ModelDetail({ model, onChange }: { model: ModelEntry; onChange: (m: ModelEntry) => void }) {
  const { t } = useI18n();
  const tokensUnit = t("modelTokensUnit", "tokens");
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });

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

      <ModelAdvancedSettings model={model} onChange={onChange} />
    </div>
  );
}
