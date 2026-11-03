import { useEffect, useId, useRef, useState, type Dispatch } from "react";
import { useI18n } from "@/i18n";
import { formatSshHostLabel, keyOf, parseSshConnectInput } from "@shared/workspace-ref";
import { GlideHighlight } from "../chat-input/GlideHighlight";
import { useSwitcherKeyboard } from "./use-switcher-keyboard";
import { ROW_STYLE } from "./project-switcher-parts";
import type { SshConnectEvent, SshConnectServices, SshConnectState } from "./ssh-connect-state";
import { SshConnectButton, SshConnectNote } from "./ssh-connect-parts";

export function SshConnectStepServers({
  state,
  dispatch,
  services,
  onOpenFolder,
}: {
  state: Extract<SshConnectState, { step: "servers" }>;
  dispatch: Dispatch<SshConnectEvent>;
  services?: SshConnectServices;
  onOpenFolder: (folder: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(-1);
  const baseId = useId();
  const listHosts = services?.listHosts;
  const loading = state.hosts.status === "loading";
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (!listHosts || !loading) return;
    let current = true;
    void listHosts().then(
      ({ hosts }) => {
        if (current) dispatch({ type: "hosts", hosts: { status: "ready", hosts } });
      },
      (error: unknown) => {
        if (current)
          dispatch({
            type: "hosts",
            hosts: { status: "error", message: error instanceof Error ? error.message : String(error) },
          });
      },
    );
    return () => {
      current = false;
    };
  }, [listHosts, dispatch, loading]);
  const parsed = parseSshConnectInput(state.query);
  const target = parsed.ok ? (parsed.value.kind === "workspace" ? parsed.value.ref.target : parsed.value.target) : null;
  const hosts = state.hosts.status === "ready" ? state.hosts.hosts : [];
  const browseHost = (index: number) => {
    const host = hosts[index];
    if (host)
      dispatch({
        type: "connect",
        target: { host: host.source === "ssh-config" ? host.alias : host.host, user: host.user, port: host.port },
        path: host.lastOpenedPath,
      });
  };
  const connect = () => {
    if (!parsed.ok) return;
    if (parsed.value.kind === "workspace") onOpenFolder(keyOf(parsed.value.ref));
    else dispatch({ type: "connect", target: parsed.value.target, path: parsed.value.suggestedPath });
  };
  const runKey = (key: string) => {
    if ((key === "ArrowDown" || key === "ArrowUp") && hosts.length) {
      setCursor(key === "ArrowDown" ? (cursor + 1) % hosts.length : (cursor <= 0 ? hosts.length : cursor) - 1);
      return true;
    }
    if (key === "Enter" && (cursor >= 0 || parsed.ok)) {
      if (cursor >= 0) browseHost(cursor);
      else connect();
      return true;
    }
    return false;
  };
  useSwitcherKeyboard(runKey);
  return (
    <div
      style={{ padding: 10, display: "flex", flexDirection: "column", gap: 12 }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || (event.target as HTMLElement).closest("button")) return;
        if (runKey(event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <h2 className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
        {t("sshConnectStepServers", "Step 1 of 2: choose or enter a remote server")}
      </h2>
      <input
        ref={inputRef}
        className="type-mono-label"
        aria-label={t("sshConnectServerInput", "SSH server address or command")}
        placeholder={t("sshConnectServerExample", "ssh -p 2222 ubuntu@47.98.12.34")}
        autoComplete="off"
        spellCheck={false}
        value={state.query}
        aria-activedescendant={cursor >= 0 ? `${baseId}-${cursor}` : undefined}
        onChange={(event) => {
          dispatch({ type: "query", query: event.target.value });
          setCursor(-1);
        }}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: "var(--fx-surface-inset)",
          color: "var(--fx-text-primary)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-control)",
        }}
      />
      {target && (
        <p role="status" className="type-meta-default" style={{ color: "var(--fx-accent-blue-text)" }}>
          {(/^ssh\s/.test(state.query.trim())
            ? t(
                "sshConnectRecognizedCommand",
                "Recognized the terminal command: user {user} · host {host} · port {port}",
              )
            : t("sshConnectRecognizedAddress", "Recognized server: user {user} · host {host} · port {port}")
          )
            .replace("{user}", target.user ?? t("sshConnectDefaultUser", "default user"))
            .replace("{host}", formatSshHostLabel(target))
            .replace("{port}", String(target.port ?? 22))}
        </p>
      )}
      <SshConnectButton disabled={!parsed.ok} onClick={connect} primary enter>
        {t("sshConnectChooseFolders", "Connect and choose folder")}
      </SshConnectButton>
      <SshConnectNote>
        {t("sshConnectConfiguredServers", "Or pick a server already configured on this computer (~/.ssh/config)")}
      </SshConnectNote>
      {state.hosts.status === "loading" && (
        <SshConnectNote>{t("sshConnectLoadingServers", "Loading configured servers…")}</SshConnectNote>
      )}
      {state.hosts.status === "error" && (
        <>
          <SshConnectNote>{state.hosts.message}</SshConnectNote>
          <SshConnectButton onClick={() => dispatch({ type: "hosts", hosts: { status: "loading" } })}>
            {t("sshConnectRetry", "Retry")}
          </SshConnectButton>
        </>
      )}
      {state.hosts.status === "ready" && !hosts.length && (
        <SshConnectNote>
          {t("sshConnectNoServers", "No configured servers yet. Paste an SSH address above.")}
        </SshConnectNote>
      )}
      <div style={{ position: "relative", maxHeight: 240, overflowY: "auto" }}>
        {hosts.map((host, index) => (
          <button
            key={`${host.alias}-${index}`}
            id={`${baseId}-${index}`}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-label={t("sshConnectBrowseHost", "Browse folders on {host}").replace("{host}", host.alias)}
            onMouseEnter={() => setCursor(index)}
            onClick={() => browseHost(index)}
            style={{
              ...ROW_STYLE,
              minHeight: 72,
              padding: "10px 8px",
              borderRadius: "var(--radius-control)",
              position: "relative",
              zIndex: 1,
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
              <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
                {host.alias}
              </span>
              <span className="type-mono-meta" style={{ color: "var(--fx-text-secondary)", overflowWrap: "anywhere" }}>
                {host.user ? `${host.user}@` : ""}
                {formatSshHostLabel(host)}:{host.port ?? 22}
              </span>
              <span
                className="type-meta-default"
                style={{ display: "flex", flexWrap: "wrap", gap: 6, color: "var(--fx-status-success-text)" }}
              >
                {host.proxyJump && <span title={host.proxyJump}>{t("sshConnectProxyJump", "ProxyJump")}</span>}
                {host.identityReady && <span>{t("sshConnectKeyReady", "Key ready")}</span>}
              </span>
              {host.lastOpenedPath && (
                <span className="type-mono-meta" style={{ color: "var(--fx-text-tertiary)", overflowWrap: "anywhere" }}>
                  {t("sshConnectLastOpened", "Last opened {path}").replace("{path}", host.lastOpenedPath)}
                </span>
              )}
            </span>
            <span className="type-label-default" style={{ color: "var(--fx-accent-blue-text)" }}>
              {t("sshConnectBrowseFolders", "Browse folders ›")}
            </span>
          </button>
        ))}
        <GlideHighlight
          rowSelector='[role="menuitem"]'
          activeIndex={cursor}
          visible={cursor >= 0}
          layoutKey={hosts.map((host) => host.alias).join("|")}
          insetX={0}
        />
      </div>
    </div>
  );
}
