import { useEffect, useRef, type KeyboardEvent } from "react";
import { Field, SecretTextInput, TextInput } from "../form-controls";
import { useI18n } from "@/i18n";
import { isModelEnabled, toggleModelEnabled } from "@/lib/model-selection";
import type { ModelEntry, ProviderEntry } from "@/lib/models-config-state";
import { useModelMeta } from "./model-dialog";
import {
  AddModelRow,
  DetailSection,
  DetailSections,
  FieldHint,
  ModelOpenRow,
  SectionCount,
} from "./provider-dialog-parts";
import { API_OPTIONS, type ModelSelectionControl } from "./types";

const API_LABELS: Record<(typeof API_OPTIONS)[number], string> = {
  "openai-completions": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic",
  "google-generative-ai": "Gemini",
};

function ProtocolSegmented({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = API_OPTIONS.findIndex((option) => option === value);
  const focusIndex = selectedIndex < 0 ? 0 : selectedIndex;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (focusIndex + step + API_OPTIONS.length) % API_OPTIONS.length;
    onChange(API_OPTIONS[next]);
    refs.current[next]?.focus();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="type-body-default" style={{ color: "var(--fx-text-secondary)" }}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          height: 32,
          padding: 2,
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-control)",
          background: "var(--fx-surface-inset)",
          boxSizing: "border-box",
        }}
      >
        {API_OPTIONS.map((option, index) => {
          const selected = option === value;
          return (
            <button
              key={option}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === focusIndex ? 0 : -1}
              title={option}
              onClick={() => onChange(option)}
              onMouseEnter={(e) => {
                if (!selected) e.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
              }}
              onMouseLeave={(e) => {
                if (!selected) e.currentTarget.style.background = "var(--fx-surface-hover-clear)";
              }}
              className={selected ? "type-body-medium" : "type-body-default"}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                height: "100%",
                padding: "0 4px",
                border: "none",
                borderRadius: "var(--radius-chip)",
                background: selected ? "var(--fx-surface-selected)" : "var(--fx-surface-hover-clear)",
                color: selected ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "pointer",
                transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
              }}
            >
              {API_LABELS[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CustomModelsSection({
  savedName,
  models,
  modelSelection,
  onOpenModel,
  onAddModel,
}: {
  savedName: string | null;
  models: ModelEntry[];
  modelSelection: ModelSelectionControl;
  onOpenModel: (index: number) => void;
  onAddModel: () => void;
}) {
  const { t } = useI18n();
  const metaOf = useModelMeta();
  const { preferences, saving, error, onChange } = modelSelection;
  const known = (model: ModelEntry) =>
    savedName === null
      ? undefined
      : preferences?.models.find((info) => info.provider === savedName && info.id === model.id);
  const enabledOf = (model: ModelEntry) => {
    if (!preferences) return true;
    const info = known(model);
    return info ? isModelEnabled(info, preferences.enabledModels) : preferences.enabledModels === null;
  };
  const enabledCount = models.filter(enabledOf).length;

  return (
    <DetailSection
      title={t("models", "Models")}
      gap={8}
      aside={
        preferences &&
        models.length > 0 && (
          <SectionCount>
            {t("modelEnabledCount", "{enabled}/{total} enabled")
              .replace("{enabled}", String(enabledCount))
              .replace("{total}", String(models.length))}
          </SectionCount>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {models.map((model, index) => {
          const info = known(model);
          const name = model.id || t("modelNewModel", "new model");
          return (
            <ModelOpenRow
              key={index}
              id={model.id}
              placeholder={t("modelNewModel", "new model")}
              meta={metaOf(model)}
              divider={index > 0}
              onOpen={() => onOpenModel(index)}
              toggleLabel={name}
              toggle={{
                checked: enabledOf(model),
                disabled: saving || !info || !preferences,
                title: info ? undefined : t("modelToggleAfterSave", "Save the channel to turn this model on or off"),
                onChange: (enabled) => {
                  if (!info || !preferences) return;
                  void onChange(toggleModelEnabled(preferences.models, preferences.enabledModels, info, enabled));
                },
              }}
            />
          );
        })}
      </div>
      <AddModelRow label={t("modelAddModel", "Add model")} onClick={onAddModel} />
      {error && (
        <p className="type-label-default" style={{ margin: 0, color: "var(--fx-status-danger)" }}>
          {error}
        </p>
      )}
    </DetailSection>
  );
}

export function ProviderDetail({
  name,
  savedName,
  provider,
  onNameChange,
  onChange,
  modelSelection,
  onOpenModel,
  onAddModel,
}: {
  name: string;
  savedName: string | null;
  provider: ProviderEntry;
  onNameChange: (n: string) => void;
  onChange: (p: ProviderEntry) => void;
  modelSelection: ModelSelectionControl;
  onOpenModel: (index: number) => void;
  onAddModel: () => void;
}) {
  const { t } = useI18n();
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial provider load intentionally runs once.
  }, [provider.api]);

  return (
    <DetailSections>
      <DetailSection title={t("modelProvider", "Connection")} gap={14}>
        <Field labelSize="body" label={t("modelProviderName", "Provider name")}>
          <TextInput value={name} onChange={onNameChange} placeholder="provider-name" mono />
        </Field>

        <ProtocolSegmented
          label={t("modelApi", "Protocol")}
          value={provider.api ?? "openai-completions"}
          onChange={(v) => set("api", v)}
        />

        <Field labelSize="body" label={t("modelBaseUrl", "Base URL")}>
          <TextInput
            value={provider.baseUrl ?? ""}
            onChange={(v) => set("baseUrl", v || undefined)}
            placeholder="https://api.example.com/v1"
            mono
          />
        </Field>

        <Field labelSize="body" label={t("modelApiKey", "API Key")}>
          <SecretTextInput
            value={provider.apiKey ?? ""}
            onChange={(v) => set("apiKey", v || undefined)}
            placeholder={t("modelApiKeySourcePlaceholder", "$ENV_VAR, !command, or the key itself")}
            mono
          />
          <FieldHint>
            {t(
              "modelApiKeySourceHint",
              "Stored only in models.json on this computer. You can also enter $ENV_VAR_NAME, or start with ! to run a command.",
            )}
          </FieldHint>
        </Field>
      </DetailSection>

      <CustomModelsSection
        savedName={savedName}
        models={provider.models ?? []}
        modelSelection={modelSelection}
        onOpenModel={onOpenModel}
        onAddModel={onAddModel}
      />
    </DetailSections>
  );
}
