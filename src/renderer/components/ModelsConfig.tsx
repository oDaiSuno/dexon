import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { Button } from "./form-controls";
import { AddProviderPicker } from "./models/add-provider-picker";
import { DefaultModelGroup } from "./models/default-model-group";
import { ProviderTree } from "./models/provider-tree";
import { SessionNamingGroup } from "./models/session-naming-group";
import { SelectionDetail } from "./models/selection-detail";
import type { DialogTarget } from "./models/types";
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
  const [target, setTarget] = useState<DialogTarget | null>(null);
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
            <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 28 }}>
              <DefaultModelGroup preferences={editor.modelPreferences} cwd={cwd} onChanged={onChanged} />
              <SessionNamingGroup preferences={editor.modelPreferences} />
              <ProviderTree
                loading={editor.loading}
                loadError={editor.loadError}
                onRetry={() => void editor.loadModelsConfig()}
                providers={editor.providers}
                oauthProviders={editor.oauthProviders}
                activeApiKey={editor.activeApiKey}
                modelPreferences={editor.modelPreferences}
                onOpen={setTarget}
                onAddProvider={() => setPickerOpen(true)}
              />
              <p
                className="type-body-default"
                style={{ margin: 0, textAlign: "center", color: "var(--fx-text-tertiary)" }}
              >
                {t(
                  "modelsConfigFootnote",
                  "Settings are saved in ~/.pi/agent/models.json and only affect this computer.",
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
      <span key={editor.savedAt} role="status" className="sr-only">
        {editor.savedAt ? t("saved", "Saved") : ""}
      </span>
      <SelectionDetail editor={editor} target={target} onClose={() => setTarget(null)} />
      {pickerOpen && (
        <AddProviderPicker
          oauthProviders={editor.oauthProviders}
          apiKeyProviders={editor.apiKeyProviders}
          onSelectOAuth={(id) => setTarget({ type: "oauth", providerId: id })}
          onSelectApiKey={(id) => setTarget({ type: "apikey", providerId: id })}
          onAddCustom={() => setTarget({ type: "provider", name: null })}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
