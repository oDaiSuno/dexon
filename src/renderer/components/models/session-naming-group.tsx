import { useId, useMemo, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { ModelPreferencesResult, SessionNamingModelRef, SessionNamingSettingsResult } from "@contract/types";
import { useI18n } from "@/i18n";
import { saveSessionNamingSettings } from "../../lib/auto-session-title";
import { enabledModelList, modelRef } from "../../lib/model-selection";
import { Badge, NativeSelect, Toggle } from "../form-controls";
import { SettingGroup, SettingNote, SettingRow, toggleHitAreaStyle } from "../settings/setting-row";
import { SessionNamingPreview } from "./session-naming-preview";
import type { SessionNamingState } from "./use-models-config";

export function SessionNamingGroup({
  environmentId,
  preferences,
  namingState,
  onNamingChange,
}: {
  environmentId: EnvironmentId;
  preferences: ModelPreferencesResult | null;
  namingState: SessionNamingState;
  onNamingChange: (settings: SessionNamingSettingsResult) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controlId = useId();
  const modelControlId = useId();
  const settings = namingState.status === "ready" ? namingState.settings : null;
  const disabled = !settings || !preferences || saving;
  const visibleError = error ?? (namingState.status === "error" ? namingState.message : null);
  const enabledModels = useMemo(() => enabledModelList(preferences), [preferences]);
  const namingModel = settings?.model;
  const selectedRef = namingModel ? modelRef({ provider: namingModel.provider, id: namingModel.modelId }) : "";
  const storedChoiceMissing = selectedRef !== "" && !enabledModels.some((model) => modelRef(model) === selectedRef);

  const save = async (patch: { enabled?: boolean; model?: SessionNamingModelRef | null }) => {
    if (!settings || disabled) return;
    setSaving(true);
    setError(null);
    onNamingChange({ ...settings, ...patch });
    try {
      onNamingChange(await saveSessionNamingSettings(environmentId, patch));
    } catch (caught) {
      onNamingChange(settings);
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(t("sessionNamingSaveFailed", "Couldn't save session naming: {error}").replace("{error}", message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingGroup
      title={t("sessionNamingGroup", "Session naming")}
      action={<Badge tone="accent">{"AI"}</Badge>}
      notes={visibleError ? <SettingNote alert>{visibleError}</SettingNote> : undefined}
    >
      <SessionNamingPreview />
      {namingState.status === "unsupported" && (
        <div style={{ padding: "var(--space-4) var(--space-5)" }}>
          <SettingNote>
            {t(
              "sessionNamingUnsupported",
              "Update this server to configure session naming settings separately for this server.",
            )}
          </SettingNote>
        </div>
      )}
      {namingState.status !== "unsupported" && (
        <>
          <SettingRow
            label={t("autoSessionTitle", "Auto-name new sessions")}
            description={t(
              "sessionNamingAutoDescription",
              "Uses the first message to replace the “New session” placeholder name, without waiting for a reply.",
            )}
            controlId={controlId}
            divider={false}
          >
            <label htmlFor={controlId} style={{ ...toggleHitAreaStyle, cursor: disabled ? "default" : "pointer" }}>
              <Toggle
                id={controlId}
                checked={settings?.enabled ?? true}
                disabled={disabled}
                onChange={(event) => void save({ enabled: event.target.checked })}
              />
            </label>
          </SettingRow>
          <SettingRow
            label={t("sessionNamingModel", "Naming model")}
            description={t(
              "sessionNamingModelDescription",
              "A title is only a few dozen characters, so a fast, inexpensive model is enough. Regenerate name in the session menu uses it too.",
            )}
            controlId={modelControlId}
          >
            <NativeSelect
              id={modelControlId}
              value={selectedRef}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  void save({ model: null });
                  return;
                }
                const chosen = enabledModels.find((model) => modelRef(model) === value);
                if (chosen) void save({ model: { provider: chosen.provider, modelId: chosen.id } });
              }}
            >
              <option value="">{t("sessionNamingModelUnset", "Not set")}</option>
              {enabledModels.map((model) => (
                <option key={modelRef(model)} value={modelRef(model)}>
                  {`${model.name} · ${model.id}`}
                </option>
              ))}
              {storedChoiceMissing && <option value={selectedRef}>{selectedRef}</option>}
            </NativeSelect>
          </SettingRow>
          {storedChoiceMissing && preferences && (
            <div style={{ padding: "0 var(--space-5) var(--space-4)" }}>
              <SettingNote>
                {t(
                  "sessionNamingModelUnavailable",
                  "This model is not in this environment's enabled list. If it is unavailable on this host, naming will fall back to the active session model.",
                )}
              </SettingNote>
            </div>
          )}
        </>
      )}
    </SettingGroup>
  );
}
