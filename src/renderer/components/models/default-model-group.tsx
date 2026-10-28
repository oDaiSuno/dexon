import { useEffect, useId, useMemo, useState } from "react";
import type { DefaultThinkingLevel, ModelDefaultsResult, ModelInfo, ModelPreferencesResult } from "@contract/types";
import { useI18n } from "@/i18n";
import { getModelDefaults, setModelDefaults } from "../../lib/api-client";
import { enabledModelList, modelRef } from "../../lib/model-selection";
import { thinkingLevelLabel } from "../../lib/thinking-level-label";
import { providerDisplayName } from "../chat-input/model-catalog";
import { THINKING_LEVELS } from "../chat-input/thinking-art";
import { NativeSelect } from "../form-controls";
import { SettingGroup, SettingNote, SettingRow } from "../settings/setting-row";

export function DefaultModelFields({
  models,
  defaults,
  saving,
  error,
  onModelChange,
  onThinkingLevelChange,
}: {
  models: ModelInfo[];
  defaults: ModelDefaultsResult | null;
  saving: boolean;
  error: string | null;
  onModelChange: (model: { provider: string; modelId: string }) => void;
  onThinkingLevelChange: (level: DefaultThinkingLevel) => void;
}) {
  const { t } = useI18n();
  const modelControlId = useId();
  const savedRef = defaults?.model ? modelRef({ provider: defaults.model.provider, id: defaults.model.modelId }) : "";
  const savedMissing = savedRef !== "" && !models.some((model) => modelRef(model) === savedRef);

  return (
    <SettingGroup
      title={t("defaultModelGroup", "Default model")}
      notes={error ? <SettingNote alert>{error}</SettingNote> : undefined}
    >
      <SettingRow
        label={t("defaultModelNewSessions", "New sessions use")}
        description={t("defaultModelDescription", "Only affects sessions created after this.")}
        controlId={modelControlId}
        divider={false}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <NativeSelect
            id={modelControlId}
            value={savedRef}
            disabled={!defaults || saving}
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return;
              const chosen = models.find((model) => modelRef(model) === value);
              if (!chosen) return;
              onModelChange({ provider: chosen.provider, modelId: chosen.id });
            }}
          >
            {!defaults?.model && <option value="">{t("defaultModelUnset", "Not set")}</option>}
            {models.map((model) => (
              <option key={modelRef(model)} value={modelRef(model)}>
                {`${model.name} · ${providerDisplayName(model.provider)}`}
              </option>
            ))}
            {savedMissing && <option value={savedRef}>{savedRef}</option>}
          </NativeSelect>
          <NativeSelect
            aria-label={t("defaultThinkingLevel", "Default thinking level")}
            value={defaults?.thinkingLevel ?? "medium"}
            disabled={!defaults || saving}
            onChange={(event) => onThinkingLevelChange(event.target.value as DefaultThinkingLevel)}
          >
            {THINKING_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t("defaultThinkingOption", "Thinking: {level}").replace("{level}", thinkingLevelLabel(level, t))}
              </option>
            ))}
          </NativeSelect>
        </div>
      </SettingRow>
    </SettingGroup>
  );
}

export function DefaultModelGroup({
  preferences,
  cwd,
  onChanged,
}: {
  preferences: ModelPreferencesResult | null;
  cwd: string | null;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [defaults, setDefaults] = useState<ModelDefaultsResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = useMemo(() => enabledModelList(preferences), [preferences]);

  useEffect(() => {
    let cancelled = false;
    setDefaults(null);
    setError(null);
    void (async () => {
      try {
        const result = await getModelDefaults(cwd ?? undefined);
        if (!cancelled) setDefaults(result);
      } catch (caught) {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(t("defaultModelLoadFailed", "Couldn't load the default: {error}").replace("{error}", message));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, t]);

  const save = async (change: {
    model?: { provider: string; modelId: string };
    thinkingLevel?: DefaultThinkingLevel;
  }) => {
    setSaving(true);
    setError(null);
    try {
      const result = await setModelDefaults(cwd ?? undefined, change);
      setDefaults(result);
      onChanged?.();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(t("defaultModelSaveFailed", "Couldn't save the default: {error}").replace("{error}", message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DefaultModelFields
      models={models}
      defaults={defaults}
      saving={saving}
      error={error}
      onModelChange={(model) => void save({ model })}
      onThinkingLevelChange={(level) => void save({ thinkingLevel: level })}
    />
  );
}
