import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { useI18n } from "@/i18n";
import { ServerTabs } from "./server-ui";
import { createServerDraft, type ServerDraft } from "./server-draft";

function ServerInput({
  label,
  value,
  onValue,
  inputRef,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  label: string;
  value: string;
  onValue: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <label htmlFor={id} style={{ display: "grid", gap: "var(--space-1-5)", minWidth: 0 }}>
      <span className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
        {label}
      </span>
      <input
        {...props}
        ref={inputRef}
        id={id}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="ui-input type-mono-label"
        style={{ width: "100%", minWidth: 0, height: 34 }}
      />
    </label>
  );
}

export function ServerForm({
  draft,
  onChange,
  editing = false,
  focusField,
}: {
  draft: ServerDraft;
  onChange: (draft: ServerDraft) => void;
  editing?: boolean;
  focusField?: "remoteStateDir";
}) {
  const { t } = useI18n();
  const [advanced, setAdvanced] = useState(Boolean(focusField));
  const directoryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusField !== "remoteStateDir") return;
    setAdvanced(true);
    const handle = window.setTimeout(() => {
      directoryRef.current?.focus();
      directoryRef.current?.select();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [focusField]);

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <ServerTabs
        label={t("serversConnectionType", "Connection type")}
        value={draft.kind}
        disabled={editing}
        options={[
          { value: "ssh", label: t("serversSsh", "SSH tunnel (recommended)") },
          { value: "websocket", label: t("serversWebSocket", "WebSocket address") },
        ]}
        onChange={(kind) =>
          onChange(
            kind === "ssh"
              ? { ...createServerDraft(), label: draft.label }
              : { kind: "websocket", label: draft.label, url: "", authToken: "" },
          )
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" }}>
        <ServerInput
          label={t("serversLabel", "Display name")}
          value={draft.label}
          required
          maxLength={120}
          pattern=".*\S.*"
          onValue={(label) => onChange({ ...draft, label })}
        />
        {draft.kind === "ssh" ? (
          <ServerInput
            label={t("serversHost", "Host or SSH alias")}
            value={draft.sshAlias}
            required
            pattern=".*\S.*"
            placeholder={t("serversHostExample", "gpu-train")}
            onValue={(sshAlias) => onChange({ ...draft, sshAlias })}
          />
        ) : (
          <ServerInput
            label={t("serversUrl", "Remote service address")}
            value={draft.url}
            required
            type="url"
            pattern="wss?://.+"
            placeholder={t("serversUrlExample", "wss://worker.example:9443")}
            onValue={(url) => onChange({ ...draft, url })}
          />
        )}
      </div>
      {draft.kind === "ssh" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" }}>
            <ServerInput
              label={t("serversUser", "SSH user (optional)")}
              value={draft.user}
              onValue={(user) => onChange({ ...draft, user })}
            />
            <ServerInput
              label={t("serversHostname", "Hostname override (optional)")}
              value={draft.hostname}
              onValue={(hostname) => onChange({ ...draft, hostname })}
            />
          </div>
          <details
            open={advanced}
            onToggle={(event) => setAdvanced(event.currentTarget.open)}
            style={{
              padding: "var(--space-3)",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-control)",
              background: "var(--fx-surface-card)",
            }}
          >
            <summary className="type-label-medium" style={{ cursor: "pointer", color: "var(--fx-text-secondary)" }}>
              {t("serversAdvanced", "Advanced options (optional)")}
            </summary>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "var(--space-3)",
                paddingTop: "var(--space-3)",
              }}
            >
              <ServerInput
                label={t("serversSshPort", "SSH port")}
                value={draft.port}
                type="number"
                min={1}
                max={65535}
                step={1}
                placeholder="22"
                onValue={(port) => onChange({ ...draft, port })}
              />
              <ServerInput
                label={t("serversRemotePort", "Remote service port")}
                value={draft.remotePort}
                type="number"
                min={1}
                max={65535}
                step={1}
                onValue={(remotePort) => onChange({ ...draft, remotePort })}
              />
              <ServerInput
                label={t("serversIdentityFile", "Identity file")}
                value={draft.identityFile}
                placeholder={t("serversIdentityFileExample", "~/.ssh/id_ed25519")}
                onValue={(identityFile) => onChange({ ...draft, identityFile })}
              />
              <ServerInput
                label={t("serversProxyJump", "Jump host (ProxyJump)")}
                value={draft.proxyJump}
                onValue={(proxyJump) => onChange({ ...draft, proxyJump })}
              />
              <div style={{ gridColumn: "1 / -1" }}>
                <ServerInput
                  label={t("serversRemoteStateDir", "Remote data directory")}
                  inputRef={directoryRef}
                  value={draft.remoteStateDir}
                  placeholder={t("serversRemoteStateDirExample", "~/.dexon")}
                  onValue={(remoteStateDir) => onChange({ ...draft, remoteStateDir })}
                />
              </div>
            </div>
          </details>
          <p
            className="type-label-default"
            style={{
              margin: 0,
              color: "var(--fx-accent-blue-text)",
              background: "var(--fx-accent-blue-soft)",
              border: "1px solid var(--fx-accent-blue-border)",
              borderRadius: "var(--radius-control)",
              padding: "var(--space-3)",
            }}
          >
            {t(
              "serversSshHelp",
              "Dexon uses your SSH configuration and automatically deploys its remote service. Passwordless SSH and Node.js 22.19 or later in version 22 are required.",
            )}
          </p>
        </>
      ) : (
        <>
          <ServerInput
            label={t("serversToken", "Access token")}
            value={draft.authToken}
            required={!editing}
            type="password"
            onValue={(authToken) => onChange({ ...draft, authToken })}
          />
          {editing && (
            <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
              {t("serversTokenKeep", "Leave the access token blank to keep the saved token.")}
            </p>
          )}
          <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
            {t(
              "serversWebSocketHelp",
              "Connect to an already running remote Dexon service. Use wss:// outside a trusted local network.",
            )}
          </p>
        </>
      )}
    </div>
  );
}
