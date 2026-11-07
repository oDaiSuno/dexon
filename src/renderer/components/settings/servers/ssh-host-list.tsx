import { useEffect, useId, useState } from "react";
import type { DiscoveredSshHost, SshHostDiscovery } from "@contract/environment-commands";
import { useI18n } from "@/i18n";
import { useEnvironmentsSnapshot } from "@/lib/environment-registry";
import { Badge, Button } from "../../form-controls";
import { ServerActionError, serverPanelStyle, serverRowStyle } from "./server-ui";
import { useServerActions } from "./use-server-actions";

export function SshHostList({
  onConnect,
  onManual,
  busy = false,
  hideAdded = false,
}: {
  onConnect: (host: DiscoveredSshHost) => void;
  onManual: () => void;
  busy?: boolean;
  hideAdded?: boolean;
}) {
  const { t } = useI18n();
  const searchId = useId();
  const { environments } = useEnvironmentsSnapshot();
  const { run, pending, error } = useServerActions();
  const [discovery, setDiscovery] = useState<SshHostDiscovery | null>(null);
  const [query, setQuery] = useState("");
  const scan = async () => {
    const result = await run({ type: "discover-ssh-hosts" });
    if (result.ok) setDiscovery(result.value);
  };

  useEffect(() => {
    void run({ type: "discover-ssh-hosts" }).then((result) => {
      if (result.ok) setDiscovery(result.value);
    });
  }, [run]);

  const added = (host: DiscoveredSshHost) =>
    environments.some((view) => view.target.kind === "ssh" && view.target.sshAlias === host.alias);
  const hosts =
    discovery?.hosts.filter(
      (host) =>
        (!hideAdded || !added(host)) &&
        `${host.alias} ${host.hostname} ${host.user ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
    ) ?? [];

  return (
    <section
      aria-label={t("serversDiscovered", "Servers from local SSH configuration")}
      style={{ display: "grid", gap: "var(--space-3)" }}
    >
      <div style={serverRowStyle}>
        <label htmlFor={searchId} className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
          {t("serversSearchHosts", "Filter SSH hosts")}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="ui-input type-body-default"
          style={{ flex: 1, minWidth: 140 }}
        />
        <Button disabled={Boolean(pending) || busy} busy={Boolean(pending)} onClick={() => void scan()}>
          {t("serversRescan", "Rescan")}
        </Button>
      </div>
      <div className="type-label-default" style={{ color: "var(--fx-text-tertiary)", overflowWrap: "anywhere" }}>
        {discovery?.configPath ?? "~/.ssh/config"}
      </div>
      <ServerActionError error={error ?? discovery?.error ?? null} />
      {pending && !discovery ? (
        <p role="status" className="type-body-default">
          {t("serversScanning", "Reading local SSH configuration…")}
        </p>
      ) : hosts.length ? (
        <div style={serverPanelStyle}>
          {hosts.map((host, index) => (
            <div
              key={host.alias}
              style={{
                ...serverRowStyle,
                padding: "var(--space-3) var(--space-4)",
                borderTop: index ? "1px solid var(--fx-line-default)" : undefined,
              }}
            >
              <span aria-hidden="true" className="type-mono-body" style={{ color: "var(--fx-text-tertiary)" }}>
                ›_
              </span>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: "var(--space-1)" }}>
                <div style={serverRowStyle}>
                  <span className="type-mono-label" style={{ color: "var(--fx-text-primary)" }}>
                    {host.alias}
                  </span>
                  <span
                    className="type-mono-meta"
                    style={{ color: "var(--fx-text-tertiary)", overflowWrap: "anywhere" }}
                  >
                    {host.user ? `${host.user}@` : ""}
                    {host.hostname}:{host.port}
                  </span>
                </div>
                <span
                  className="type-label-default"
                  style={{ color: "var(--fx-text-tertiary)", overflowWrap: "anywhere" }}
                >
                  {[
                    host.proxyJump && `${t("serversProxyJump", "Jump host (ProxyJump)")} ${host.proxyJump}`,
                    host.identityFile && `${t("serversIdentityFile", "Identity file")} ${host.identityFile}`,
                    host.sourceFile,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {added(host) ? (
                <Badge tone="muted">{t("serversAlreadyAdded", "Already added")}</Badge>
              ) : (
                <Button variant="primary" disabled={busy || Boolean(pending)} onClick={() => onConnect(host)}>
                  {t("serversOneClickConnect", "Connect")}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...serverPanelStyle, padding: "var(--space-5)", display: "grid", gap: "var(--space-3)" }}>
          <strong className="type-body-medium">
            {query.trim()
              ? t("serversNoHostMatch", "No SSH hosts match this filter")
              : hideAdded && discovery?.hosts.length
                ? t("serversAllHostsAdded", "All discovered hosts have been added")
                : t("serversNoSshConfig", "No local SSH hosts found")}
          </strong>
          <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
            {t(
              "serversDiscoveryHelp",
              "Add a host to ~/.ssh/config and rescan, or enter the connection details manually.",
            )}
          </p>
          <div style={serverRowStyle}>
            <Button onClick={onManual} disabled={busy}>
              {t("serversManualAdd", "Enter connection details")}
            </Button>
            {query && (
              <Button variant="ghost" onClick={() => setQuery("")}>
                {t("serversClearFilter", "Clear filter")}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
