import { useEffect, useState } from "react";
import { ActionMenu } from "../action-menu";
import { Button } from "../form-controls";
import { EllipsisGlyph } from "../processes/process-icons";
import { useI18n } from "@/i18n";
import { isModelEnabled, setProviderModelsEnabled, toggleModelEnabled } from "@/lib/model-selection";
import { DetailSection, ModelToggleRow, SectionCount } from "./provider-dialog-parts";
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
  const ready = !loading && preferences !== null;
  const moreLabel = t("modelMoreModelActions", "More model actions");

  return (
    <DetailSection
      title={t("models", "Models")}
      gap={8}
      aside={
        ready && (
          <>
            <SectionCount>
              <span
                title={t(
                  "modelSelectionDescription",
                  "Choose which models appear in the model picker. The active model in an existing session is not changed.",
                )}
              >
                {t("modelEnabledCount", "{enabled}/{total} enabled")
                  .replace("{enabled}", String(enabledCount))
                  .replace("{total}", String(providerModels.length))}
              </span>
            </SectionCount>
            {providerModels.length > 0 && (
              <ActionMenu
                label={moreLabel}
                zIndex={1200}
                items={[
                  {
                    key: "enable",
                    label: t("modelEnableAll", "Enable all"),
                    disabled: saving || enabledCount === providerModels.length,
                    onSelect: () =>
                      void onChange(
                        setProviderModelsEnabled(preferences.models, preferences.enabledModels, providerId, true),
                      ),
                  },
                  {
                    key: "disable",
                    label: t("modelDisableAll", "Disable all"),
                    disabled: saving || enabledCount === 0,
                    onSelect: () =>
                      void onChange(
                        setProviderModelsEnabled(preferences.models, preferences.enabledModels, providerId, false),
                      ),
                  },
                ]}
                trigger={(props) => (
                  <Button
                    {...props}
                    variant="ghost"
                    aria-label={moreLabel}
                    title={moreLabel}
                    style={{ width: 28, minHeight: 28, height: 28, padding: 0, borderRadius: "var(--radius-chip)" }}
                  >
                    <EllipsisGlyph />
                  </Button>
                )}
              />
            )}
          </>
        )
      }
    >
      {loading && (
        <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
          {t("modelLoadingModels", "Loading models…")}
        </p>
      )}
      {ready && providerModels.length === 0 && (
        <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
          {t("modelNoAvailableModels", "No models are currently available for this provider.")}
        </p>
      )}

      {ready && providerModels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {providerModels.length > 8 && (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("modelSearchModels", "Search models…")}
              aria-label={t("modelSearchProviderModels", "Search provider models")}
              className="ui-input type-body-default"
              style={{ marginBottom: 8 }}
            />
          )}
          {visibleModels.map((model, index) => (
            <ModelToggleRow
              key={`${model.provider}/${model.id}`}
              id={model.id}
              title={model.name !== model.id ? model.name : undefined}
              divider={index > 0}
              toggle={{
                checked: isModelEnabled(model, preferences.enabledModels),
                disabled: saving,
                onChange: (enabled) =>
                  void onChange(toggleModelEnabled(preferences.models, preferences.enabledModels, model, enabled)),
              }}
            />
          ))}
          {visibleModels.length === 0 && (
            <span className="type-body-default" style={{ padding: "12px 4px", color: "var(--fx-text-secondary)" }}>
              {t("modelNoMatchingModels", "No matching models.")}
            </span>
          )}
        </div>
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
    </DetailSection>
  );
}
