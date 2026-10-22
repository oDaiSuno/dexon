import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { Button } from "./form-controls";
import { AddProviderPicker } from "./models/add-provider-picker";
import { ModelsFooter } from "./models/models-footer";
import { ProviderTree } from "./models/provider-tree";
import { SelectionDetail } from "./models/selection-detail";
import { useModelsConfig } from "./models/use-models-config";

export function ModelsConfig({
  onClose,
  onChanged,
  embedded = false,
  cwd = null,
}: {
  onClose: () => void;
  onChanged?: () => void;
  embedded?: boolean;
  cwd?: string | null;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const editor = useModelsConfig({ cwd, onChanged });
  const { setSelection, loading } = editor;
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <div
        style={
          embedded
            ? { position: "relative", flex: 1, minWidth: 0, minHeight: 0, display: "flex" }
            : {
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                background: "var(--fx-surface-scrim)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }
        }
        onClick={(e) => {
          if (!embedded && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          style={
            embedded
              ? {
                  width: "100%",
                  height: "100%",
                  background: "var(--fx-surface-main)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }
              : {
                  width: isMobile ? "calc(100vw - 16px)" : 860,
                  maxWidth: "calc(100vw - 16px)",
                  height: isMobile ? "calc(100dvh - 16px)" : "78vh",
                  maxHeight: "calc(100dvh - 16px)",
                  background: "var(--fx-surface-main)",
                  border: "1px solid var(--fx-line-default)",
                  borderRadius: "var(--radius-dialog)",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: "var(--shadow-dialog)",
                  overflow: "hidden",
                }
          }
        >
          {!embedded && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                height: 56,
                padding: "0 var(--space-6)",
                borderBottom: "1px solid var(--fx-line-subtle)",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span className="type-title-dialog" style={{ color: "var(--fx-text-primary)" }}>
                  {t("models", "Models")}
                </span>
                <code className="type-mono-meta" style={{ color: "var(--fx-text-tertiary)" }}>
                  ~/.pi/agent/models.json
                </code>
              </div>
              <Button
                variant="ghost"
                onClick={onClose}
                title={t("modelCloseModels", "Close models")}
                aria-label={t("modelCloseModels", "Close models")}
                style={{ width: 32, padding: 0, marginRight: -6 }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </Button>
            </div>
          )}

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: isMobile
                ? "var(--space-5) var(--space-4) var(--space-8)"
                : "var(--space-6) var(--space-6) var(--space-10)",
            }}
          >
            <div style={{ maxWidth: 760, margin: "0 auto" }}>
              <ProviderTree
                loading={loading}
                providers={editor.providers}
                oauthProviders={editor.oauthProviders}
                apiKeyProviders={editor.apiKeyProviders}
                activeOAuth={editor.activeOAuth}
                activeApiKey={editor.activeApiKey}
                modelPreferences={editor.modelPreferences}
                selection={editor.selection}
                setSelection={setSelection}
                addModel={editor.addModel}
                setPickerOpen={setPickerOpen}
                detail={
                  <SelectionDetail
                    loading={loading}
                    config={editor.config}
                    selection={editor.selection}
                    setConfig={editor.setConfig}
                    oauthProviders={editor.oauthProviders}
                    apiKeyProviders={editor.apiKeyProviders}
                    modelPreferences={editor.modelPreferences}
                    modelPreferencesLoading={editor.modelPreferencesLoading}
                    modelPreferencesSaving={editor.modelPreferencesSaving}
                    modelPreferencesError={editor.modelPreferencesError}
                    updateModelPreferences={editor.updateModelPreferences}
                    refreshOAuthProviders={editor.refreshOAuthProviders}
                    refreshApiKeyProviders={editor.refreshApiKeyProviders}
                    updateProvider={editor.updateProvider}
                    renameProvider={editor.renameProvider}
                    deleteProvider={editor.deleteProvider}
                    updateModel={editor.updateModel}
                    removeModel={editor.removeModel}
                  />
                }
              />
              {!loading && !editor.selection && (
                <p
                  className="type-body-default"
                  style={{ margin: "var(--space-6) 0 0", textAlign: "center", color: "var(--fx-text-tertiary)" }}
                >
                  {t("selectProviderOrModel", "Select a provider or model")}
                </p>
              )}
            </div>
          </div>
          <ModelsFooter
            embedded={embedded}
            loading={loading}
            saving={editor.saving}
            savedOk={editor.savedOk}
            saveError={editor.saveError}
            saveConflict={editor.saveConflict}
            loadFailed={editor.loadFailed}
            configLoaded={editor.configLoaded}
            configVersion={editor.configVersion}
            loadModelsConfig={editor.loadModelsConfig}
            onClose={onClose}
            handleSave={editor.handleSave}
          />
        </div>
      </div>
      {pickerOpen && (
        <AddProviderPicker
          oauthProviders={editor.oauthProviders}
          apiKeyProviders={editor.apiKeyProviders}
          onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
          onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
          onAddCustom={editor.addCustomProvider}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
