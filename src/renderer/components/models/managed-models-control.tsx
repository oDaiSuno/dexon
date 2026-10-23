import { useEffect, useState } from "react";
import { Button, SectionTitle } from "../form-controls";
import { useI18n } from "@/i18n";
import { isModelEnabled, setProviderModelsEnabled, toggleModelEnabled } from "@/lib/model-selection";
import type { ModelSelectionControl } from "./types";

export function ManagedModelsControl({
  providerId,
  preferences,
  loading,
  saving,
  error,
  onChange,
}: ModelSelectionControl & { providerId: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [providerId]);

  const providerModels = (preferences?.models ?? []).filter((model) => model.provider === providerId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleModels = normalizedQuery
    ? providerModels.filter(
        (model) =>
          model.name.toLocaleLowerCase().includes(normalizedQuery) ||
          model.id.toLocaleLowerCase().includes(normalizedQuery),
      )
    : providerModels;
  const enabledCount = preferences
    ? providerModels.filter((model) => isModelEnabled(model, preferences.enabledModels)).length
    : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        paddingTop: 16,
        borderTop: "1px solid var(--fx-line-default)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <SectionTitle>{t("models", "Models")}</SectionTitle>
        {!loading && preferences && (
          <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>
            {t("modelEnabledCount", "{enabled} of {total} enabled")
              .replace("{enabled}", String(enabledCount))
              .replace("{total}", String(providerModels.length))}
          </span>
        )}
      </div>

      <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
        {t(
          "modelSelectionDescription",
          "Choose which models appear in the model picker. The active model in an existing session is not changed.",
        )}
      </p>

      {loading && (
        <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
          {t("modelLoadingModels", "Loading models…")}
        </p>
      )}
      {!loading && preferences && providerModels.length === 0 && (
        <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
          {t("modelNoAvailableModels", "No models are currently available for this provider.")}
        </p>
      )}

      {!loading && preferences && providerModels.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              disabled={saving || enabledCount === providerModels.length}
              onClick={() =>
                void onChange(setProviderModelsEnabled(preferences.models, preferences.enabledModels, providerId, true))
              }
            >
              {t("modelEnableAll", "Enable all")}
            </Button>
            <Button
              disabled={saving || enabledCount === 0}
              onClick={() =>
                void onChange(
                  setProviderModelsEnabled(preferences.models, preferences.enabledModels, providerId, false),
                )
              }
            >
              {t("modelDisableAll", "Disable all")}
            </Button>
          </div>

          {providerModels.length > 8 && (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("modelSearchModels", "Search models…")}
              aria-label={t("modelSearchProviderModels", "Search provider models")}
              className="ui-input type-body-default"
            />
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: 300,
              overflowY: "auto",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-card)",
              background: "var(--fx-surface-raised)",
            }}
          >
            {visibleModels.map((model, index) => {
              const enabled = isModelEnabled(model, preferences.enabledModels);
              return (
                <label
                  key={`${model.provider}/${model.id}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "8px 12px",
                    borderTop: index > 0 ? "1px solid var(--fx-line-default)" : undefined,
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={saving}
                    onChange={(event) =>
                      void onChange(
                        toggleModelEnabled(preferences.models, preferences.enabledModels, model, event.target.checked),
                      )
                    }
                    style={{ margin: "2px 0 0", accentColor: "var(--fx-accent-blue-fill)", flexShrink: 0 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span
                      className="type-body-default"
                      style={{ display: "block", color: "var(--fx-text-primary)", overflowWrap: "anywhere" }}
                    >
                      {model.name}
                    </span>
                    {model.name !== model.id && (
                      <code
                        className="type-mono-meta"
                        style={{
                          display: "block",
                          marginTop: 2,
                          color: "var(--fx-text-tertiary)",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {model.id}
                      </code>
                    )}
                  </span>
                </label>
              );
            })}
            {visibleModels.length === 0 && (
              <span className="type-body-default" style={{ padding: "12px", color: "var(--fx-text-secondary)" }}>
                {t("modelNoMatchingModels", "No matching models.")}
              </span>
            )}
          </div>
        </>
      )}

      {saving && (
        <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
          {t("modelSavingSelection", "Saving selection…")}
        </p>
      )}
      {error && (
        <p className="type-label-default" style={{ margin: 0, color: "var(--fx-status-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
