import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
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
                background: "rgba(0,0,0,0.35)",
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
                  borderRadius: "var(--radius-card)",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
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
                padding: "12px 20px",
                borderBottom: "1px solid var(--fx-line-default)",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: "var(--text-title)", fontWeight: 700, color: "var(--fx-text-primary)" }}>
                  {t("models", "Models")}
                </span>
                <code
                  style={{
                    fontSize: "var(--text-meta)",
                    color: "var(--fx-text-secondary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  ~/.pi/agent/models.json
                </code>
              </div>
              <button
                type="button"
                onClick={onClose}
                title={t("modelCloseModels", "Close models")}
                aria-label={t("modelCloseModels", "Close models")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--fx-text-secondary)",
                  cursor: "pointer",
                  fontSize: "var(--text-display)",
                  lineHeight: 1,
                  width: 36,
                  height: 36,
                  padding: 0,
                  borderRadius: "var(--radius-card)",
                }}
              >
                ×
              </button>
            </div>
          )}

          <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
            <ProviderTree
              isMobile={isMobile}
              loading={loading}
              providers={editor.providers}
              activeOAuth={editor.activeOAuth}
              activeApiKey={editor.activeApiKey}
              selection={editor.selection}
              setSelection={setSelection}
              addModel={editor.addModel}
              setPickerOpen={setPickerOpen}
            />
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
