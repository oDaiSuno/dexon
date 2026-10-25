import { useId, useMemo, useState } from "react";
import type { ModelPreferencesResult } from "@contract/types";
import { useI18n } from "@/i18n";
import {
  getSessionNamingModel,
  isAutoSessionTitleEnabled,
  setAutoSessionTitleEnabled,
  setSessionNamingModel,
} from "../../lib/auto-session-title";
import { isModelEnabled, modelRef } from "../../lib/model-selection";
import { Badge, NativeSelect, Toggle } from "../form-controls";
import { SettingRow, toggleHitAreaStyle } from "../settings/setting-row";
import { SessionNamingPreview } from "./session-naming-preview";

export function SessionNamingGroup({ preferences }: { preferences: ModelPreferencesResult | null }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(() => isAutoSessionTitleEnabled());
  const [namingModel, setNamingModel] = useState(() => getSessionNamingModel());
  const controlId = useId();
  const modelControlId = useId();

  const enabledModels = useMemo(
    () => (preferences ? preferences.models.filter((model) => isModelEnabled(model, preferences.enabledModels)) : []),
    [preferences],
  );
  const selectedRef = namingModel ? modelRef({ provider: namingModel.provider, id: namingModel.modelId }) : "";
  const storedChoiceMissing = selectedRef !== "" && !enabledModels.some((model) => modelRef(model) === selectedRef);

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
          {t("sessionNamingGroup", "Session naming")}
        </h2>
        <Badge tone="accent">{"AI"}</Badge>
      </div>
      <div
        style={{
          display: "grid",
          background: "var(--fx-surface-raised)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          overflow: "hidden",
        }}
      >
        <SessionNamingPreview />
        <SettingRow
          label={t("autoSessionTitle", "Auto-name new sessions")}
          description={t(
            "sessionNamingAutoDescription",
            "After the first reply finishes, reads the conversation and replaces the “New session” placeholder name.",
          )}
          controlId={controlId}
          divider={false}
        >
          <label htmlFor={controlId} style={{ ...toggleHitAreaStyle, cursor: "pointer" }}>
            <Toggle
              id={controlId}
              checked={enabled}
              onChange={(event) => {
                const next = event.target.checked;
                setEnabled(next);
                setAutoSessionTitleEnabled(next);
              }}
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
            onChange={(event) => {
              const value = event.target.value;
              if (!value) {
                setSessionNamingModel(null);
                setNamingModel(null);
                return;
              }
              const chosen = enabledModels.find((model) => modelRef(model) === value);
              if (!chosen) return;
              const next = { provider: chosen.provider, modelId: chosen.id };
              setSessionNamingModel(next);
              setNamingModel(next);
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
      </div>
    </section>
  );
}
