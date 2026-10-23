import { useState } from "react";
import { useI18n } from "@/i18n";
import { setProviderBaseUrl } from "@/lib/models-config-state";
import { ApiKeyDetail } from "./api-key-detail";
import { ModelDialogShell, useSaveNotice } from "./model-dialog-shell";
import { DialogFooter } from "./models-footer";
import { OAuthDetail } from "./oauth-detail";
import { ProviderLogoTile } from "./provider-icon";
import { StatusDot, useProviderLabels } from "./provider-tree";
import type { ApiKeyProvider, ModelSelectionControl, OAuthProvider } from "./types";
import type { ModelsConfigEditor } from "./use-models-config";

type CredentialResponse = {
  ok?: boolean;
  warning?: { code: "MODEL_SYNC_FAILED"; message: string };
  error?: string;
};

async function sendApiKey(providerId: string, init: RequestInit): Promise<CredentialResponse> {
  const res = await fetch(`/api/auth/api-key/${encodeURIComponent(providerId)}`, init);
  const d = (await res.json()) as CredentialResponse;
  if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
  return d;
}

function modelSelectionOf(editor: ModelsConfigEditor): ModelSelectionControl {
  return {
    preferences: editor.modelPreferences,
    loading: editor.modelPreferencesLoading,
    saving: editor.modelPreferencesSaving,
    error: editor.modelPreferencesError,
    onChange: editor.updateModelPreferences,
  };
}

function HeaderStatus({ label, tone }: { label?: string; tone: "success" | "muted" }) {
  if (!label) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <StatusDot tone={tone} />
      <span className="type-body-default" style={{ color: "var(--fx-text-secondary)" }}>
        {label}
      </span>
    </span>
  );
}

export function ApiKeyProviderDialog({
  editor,
  provider,
  onClose,
}: {
  editor: ModelsConfigEditor;
  provider: ApiKeyProvider;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const labels = useProviderLabels(editor.modelPreferences);
  const initialBaseUrl = editor.config.providers?.[provider.id]?.baseUrl ?? "";
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const { notice, setNotice, report } = useSaveNotice(editor.loadModelsConfig);
  const baseUrlChanged = baseUrl.trim() !== initialBaseUrl.trim();
  const dirty = baseUrlChanged || apiKey.trim() !== "";

  const finish = (warning: string | undefined) => {
    editor.refreshApiKeyProviders();
    if (warning) setNotice({ tone: "warning", text: warning });
    else onClose();
  };

  const save = async () => {
    if (!dirty || busy) return;
    setBusy("save");
    setNotice(null);
    try {
      if (baseUrlChanged) {
        const persisted = await editor.persist(setProviderBaseUrl(editor.config, provider.id, baseUrl));
        report(persisted);
        if (!persisted.ok) return;
      }
      let warning: string | undefined;
      if (apiKey.trim()) {
        const d = await sendApiKey(provider.id, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });
        setApiKey("");
        warning = d.warning?.message;
      }
      finish(warning);
    } catch (e) {
      setNotice({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setNotice(null);
    try {
      const d = await sendApiKey(provider.id, { method: "DELETE" });
      finish(d.warning?.message);
    } catch (e) {
      setNotice({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ModelDialogShell
      width={560}
      divided
      dirty={dirty}
      title={provider.displayName}
      subtitle={labels.apiKeyMeta(provider)}
      leading={<ProviderLogoTile id={provider.id} />}
      trailing={<HeaderStatus label={labels.apiKeyStatus(provider)} tone={provider.configured ? "success" : "muted"} />}
      notice={notice}
      onClose={onClose}
      footer={
        <DialogFooter
          padding="var(--space-3) var(--space-4) var(--space-3) var(--space-3)"
          deleteLabel={provider.configured ? t("modelDisconnect", "Disconnect") : undefined}
          onDelete={() => void remove()}
          onCancel={onClose}
          onSave={() => void save()}
          saving={busy === "save"}
          deleting={busy === "remove"}
          saveDisabled={!dirty}
        />
      }
    >
      <div style={{ padding: "var(--space-5) var(--space-5) var(--space-2)" }}>
        <ApiKeyDetail
          provider={provider}
          baseUrl={baseUrl}
          onBaseUrlChange={setBaseUrl}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          onSubmit={() => void save()}
          modelSelection={modelSelectionOf(editor)}
        />
      </div>
    </ModelDialogShell>
  );
}

export function OAuthProviderDialog({
  editor,
  provider,
  onClose,
}: {
  editor: ModelsConfigEditor;
  provider: OAuthProvider;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const labels = useProviderLabels(editor.modelPreferences);
  return (
    <ModelDialogShell
      width={560}
      divided
      dirty={false}
      title={provider.name}
      subtitle={labels.oauthMeta(provider.id)}
      leading={<ProviderLogoTile id={provider.id} />}
      trailing={<HeaderStatus label={labels.oauthStatus(provider)} tone="success" />}
      onClose={onClose}
      footer={
        <DialogFooter
          padding="var(--space-3) var(--space-4) var(--space-3) var(--space-3)"
          onCancel={onClose}
          cancelLabel={t("close", "Close")}
          saving={false}
        />
      }
    >
      <div style={{ padding: "var(--space-5) var(--space-5) var(--space-2)" }}>
        <OAuthDetail
          provider={provider}
          onRefresh={editor.refreshOAuthProviders}
          modelSelection={modelSelectionOf(editor)}
        />
      </div>
    </ModelDialogShell>
  );
}
