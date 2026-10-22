import { useEffect, useState } from "react";
import { SectionTitle } from "../form-controls";
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
          <span style={{ fontSize: "var(--text-meta)", color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>
            {t("modelEnabledCount", "{enabled} of {total} enabled")
              .replace("{enabled}", String(enabledCount))
              .replace("{total}", String(providerModels.length))}
          </span>
        )}
      </div>

      <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--fx-text-secondary)", lineHeight: 1.5 }}>
        {t(
          "modelSelectionDescription",
          "Choose which models appear in the model picker. The active model in an existing session is not changed.",
        )}
      </p>

      {loading && (
        <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-text-secondary)" }}>
          {t("modelLoadingModels", "Loading models…")}
        </p>
      )}
      {!loading && preferences && providerModels.length === 0 && (
        <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-text-secondary)" }}>
          {t("modelNoAvailableModels", "No models are currently available for this provider.")}
        </p>
      )}

      {!loading && preferences && providerModels.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={saving || enabledCount === providerModels.length}
              onClick={() =>
                void onChange(setProviderModelsEnabled(preferences.models, preferences.enabledModels, providerId, true))
              }
              style={{
                padding: "4px 8px",
                background: "none",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-secondary)",
                cursor: saving || enabledCount === providerModels.length ? "not-allowed" : "pointer",
                fontSize: "var(--text-meta)",
              }}
            >
              {t("modelEnableAll", "Enable all")}
            </button>
            <button
              type="button"
              disabled={saving || enabledCount === 0}
              onClick={() =>
                void onChange(
                  setProviderModelsEnabled(preferences.models, preferences.enabledModels, providerId, false),
                )
              }
              style={{
                padding: "4px 8px",
                background: "none",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-secondary)",
                cursor: saving || enabledCount === 0 ? "not-allowed" : "pointer",
                fontSize: "var(--text-meta)",
              }}
            >
              {t("modelDisableAll", "Disable all")}
            </button>
          </div>

          {providerModels.length > 8 && (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("modelSearchModels", "Search models…")}
              aria-label={t("modelSearchProviderModels", "Search provider models")}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 8px",
                background: "var(--fx-surface-main)",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-primary)",
                fontSize: "var(--text-label)",
                outline: "none",
              }}
            />
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: 300,
              overflowY: "auto",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-control)",
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
                    style={{ margin: "2px 0 0", accentColor: "var(--fx-accent-blue)", flexShrink: 0 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        color: "var(--fx-text-primary)",
                        fontSize: "var(--text-label)",
                        lineHeight: 1.35,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {model.name}
                    </span>
                    {model.name !== model.id && (
                      <code
                        style={{
                          display: "block",
                          marginTop: 2,
                          color: "var(--fx-text-tertiary)",
                          fontSize: "var(--text-micro)",
                          fontFamily: "var(--font-mono)",
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
              <span style={{ padding: "12px", color: "var(--fx-text-secondary)", fontSize: "var(--text-label)" }}>
                {t("modelNoMatchingModels", "No matching models.")}
              </span>
            )}
          </div>
        </>
      )}

      {saving && (
        <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--fx-text-secondary)" }}>
          {t("modelSavingSelection", "Saving selection…")}
        </p>
      )}
      {error && (
        <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--fx-status-danger)", lineHeight: 1.4 }}>
          {error}
        </p>
      )}
    </div>
  );
}
