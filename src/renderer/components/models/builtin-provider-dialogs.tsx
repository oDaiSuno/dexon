import { useState } from "react";
import { useI18n } from "@/i18n";
import { setProviderBaseUrl } from "@/lib/models-config-state";
import { ApiKeyDetail } from "./api-key-detail";
import { ChannelTestRow } from "./channel-test-row";
import { useChannelStatus } from "./channel-status";
import { ModelDialogShell, useSaveNotice } from "./model-dialog-shell";
import { DialogFooter } from "./models-footer";
import { OAuthDetail } from "./oauth-detail";
import { DialogLogoTile, HeaderStatus } from "./provider-dialog-parts";
import { useProviderLabels } from "./provider-tree";
import type { ApiKeyProvider, OAuthProvider } from "./types";
import { modelSelectionOf, type ModelsConfigEditor } from "./use-models-config";

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
  const channelStatus = useChannelStatus();
  const [savedBaseUrl, setSavedBaseUrl] = useState(editor.config.providers?.[provider.id]?.baseUrl ?? "");
  const [baseUrl, setBaseUrl] = useState(savedBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [baseUrlSaving, setBaseUrlSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [savedField, setSavedField] = useState<"baseUrl" | "apiKey" | null>(null);
  const { notice, setNotice, report } = useSaveNotice(editor.loadModelsConfig);
  const baseUrlChanged = baseUrl.trim() !== savedBaseUrl.trim();
  const dirty = (baseUrlChanged && !baseUrlSaving) || (apiKey.trim() !== "" && !keySaving);

  const saveBaseUrl = async () => {
    if (!baseUrlChanged || baseUrlSaving) return;
    setBaseUrlSaving(true);
    setNotice(null);
    try {
      const persisted = await editor.persist(setProviderBaseUrl(editor.config, provider.id, baseUrl));
      report(persisted);
      if (!persisted.ok) return;
      setSavedBaseUrl(baseUrl);
      setSavedField("baseUrl");
    } finally {
      setBaseUrlSaving(false);
    }
  };

  const saveApiKey = async () => {
    if (!apiKey.trim() || keySaving) return;
    setKeySaving(true);
    setNotice(null);
    try {
      const d = await sendApiKey(provider.id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      setApiKey("");
      editor.refreshApiKeyProviders();
      if (d.warning) setNotice({ tone: "warning", text: d.warning.message });
      setSavedField("apiKey");
    } catch (e) {
      setNotice({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setKeySaving(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    setNotice(null);
    try {
      const d = await sendApiKey(provider.id, { method: "DELETE" });
      editor.refreshApiKeyProviders();
      if (d.warning) setNotice({ tone: "warning", text: d.warning.message });
      else onClose();
    } catch (e) {
      setNotice({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <ModelDialogShell
      width={560}
      divided
      dirty={dirty}
      title={provider.displayName}
      subtitle={`${t("modelApiProviderKind", "API provider")} · ${t("modelCount", "{count} models").replace(
        "{count}",
        String(provider.modelCount),
      )}`}
      leading={<DialogLogoTile id={provider.id} />}
      trailing={
        <HeaderStatus
          {...(provider.configured
            ? channelStatus.status(editor.channels[provider.id])
            : { tone: "muted", label: t("notConfigured", "not configured") })}
        />
      }
      notice={notice}
      onClose={onClose}
      footer={
        <DialogFooter
          padding="var(--space-3) var(--space-4) var(--space-3) var(--space-3)"
          deleteLabel={provider.configured ? t("modelDisconnect", "Disconnect") : undefined}
          onDelete={() => void remove()}
          onCancel={onClose}
          cancelLabel={t("close", "Close")}
          saving={keySaving || baseUrlSaving}
          deleting={removing}
        />
      }
    >
      <div style={{ padding: "20px 20px 8px" }}>
        <ApiKeyDetail
          provider={provider}
          baseUrl={baseUrl}
          onBaseUrlChange={(v) => {
            setBaseUrl(v);
            setSavedField(null);
          }}
          onBaseUrlBlur={() => void saveBaseUrl()}
          apiKey={apiKey}
          onApiKeyChange={(v) => {
            setApiKey(v);
            setSavedField(null);
          }}
          onApiKeySave={() => void saveApiKey()}
          savedField={savedField}
          modelSelection={modelSelectionOf(editor)}
          connectionTest={
            provider.configured ? (
              <ChannelTestRow
                channel={editor.channels[provider.id]}
                onTest={() => editor.testChannel(provider.id)}
                blockedReason={dirty ? t("modelSaveBeforeTest", "Save your changes before testing") : undefined}
              />
            ) : undefined
          }
        />
      </div>
    </ModelDialogShell>
  );
}

export function OAuthProviderDialog({
  editor,
  provider,
  startLogin,
  onClose,
}: {
  editor: ModelsConfigEditor;
  provider: OAuthProvider;
  startLogin: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const labels = useProviderLabels(editor.modelPreferences);
  const channelStatus = useChannelStatus();
  return (
    <ModelDialogShell
      width={560}
      divided
      dirty={false}
      title={provider.name}
      subtitle={labels.oauthMeta(provider)}
      leading={<DialogLogoTile id={provider.id} />}
      trailing={
        <HeaderStatus
          {...(provider.loggedIn
            ? channelStatus.status(editor.channels[provider.id])
            : { tone: "muted", label: t("modelNotConnected", "not connected") })}
          hint={provider.loggedIn ? t("modelConnected", "connected") : undefined}
        />
      }
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
      <div style={{ padding: "20px 20px 8px" }}>
        <OAuthDetail
          provider={provider}
          autoStart={startLogin}
          onRefresh={editor.refreshOAuthProviders}
          modelSelection={modelSelectionOf(editor)}
        />
      </div>
    </ModelDialogShell>
  );
}
