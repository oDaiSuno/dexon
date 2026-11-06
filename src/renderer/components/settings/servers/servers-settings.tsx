import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentView } from "@contract/environment";
import type { DiscoveredSshHost } from "@contract/environment-commands";
import { useI18n } from "@/i18n";
import { useEnvironmentsSnapshot } from "@/lib/environment-registry";
import { workspaceStore } from "@/lib/workspace-store";
import { RemoteFolderPickerDialog } from "@/components/remote-folder-picker/remote-folder-picker-dialog";
import { Badge, Button, Toggle } from "../../form-controls";
import { SettingGroup, SettingRow } from "../setting-row";
import { AddServerDialog, type AddServerTab } from "./add-server-dialog";
import { EditServerDialog } from "./edit-server-dialog";
import { RemoveServerDialog } from "./remove-server-dialog";
import { ServerRow } from "./server-row";
import { SshHostList } from "./ssh-host-list";
import { ServerActionError, ServerIcon, serverPanelStyle, serverRowStyle } from "./server-ui";
import { useServerActions } from "./use-server-actions";

type ServerDialog =
  | { kind: "add"; tab: AddServerTab }
  | { kind: "edit"; view: EnvironmentView; focusField?: "remoteStateDir"; suggestedValue?: string }
  | { kind: "remove"; view: EnvironmentView }
  | null;

export function ServersSettings() {
  const { t } = useI18n();
  const id = useId();
  const { environments, policy } = useEnvironmentsSnapshot();
  const workspace = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const servers = environments.filter((view) => view.id !== PRIMARY_ENVIRONMENT_ID && view.target.kind !== "primary");
  const online = servers.filter((view) => view.status.phase === "connected");
  const { run, pending, error } = useServerActions();
  const [dialog, setDialog] = useState<ServerDialog>(null);
  const [picker, setPicker] = useState<{ initialEnvironmentId: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  const reconnecting = servers.some((view) => view.status.phase === "backoff");
  useEffect(() => {
    if (!reconnecting) return;
    setNow(Date.now());
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [reconnecting]);

  const openProject = (environmentId: string) => {
    setDialog(null);
    setPicker({ initialEnvironmentId: environmentId });
  };
  const connectHost = async (host: DiscoveredSshHost) => {
    await run({
      type: "add",
      draft: { label: host.alias, target: { kind: "ssh", sshAlias: host.alias } },
      connect: true,
    });
  };

  return (
    <div style={{ width: "100%", overflowY: "auto", padding: "var(--space-6) var(--space-6) var(--space-10)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: "var(--space-6)" }}>
        <section
          style={{
            ...serverPanelStyle,
            borderRadius: "var(--radius-hero)",
            padding: "var(--space-5) var(--space-6)",
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "var(--space-6)",
            background: "var(--fx-surface-hero-tint)",
          }}
        >
          <div style={{ flex: "1 1 260px", display: "grid", gap: "var(--space-2)" }}>
            <div style={serverRowStyle}>
              <Badge tone={online.length ? "success" : "muted"}>
                {t("serversOnlineCount", "This computer + {count} remote servers online").replace(
                  "{count}",
                  String(online.length),
                )}
              </Badge>
              {policy.detachedDaemon && (
                <Badge tone="accent">{t("serversIndependentDaemon", "Independent daemon")}</Badge>
              )}
            </div>
            <h2 className="type-title-dialog" style={{ color: "var(--fx-text-primary)", margin: 0 }}>
              {t("serversHeroTitle", "Work locally and on multiple remote servers")}
            </h2>
            <p className="type-body-relaxed" style={{ color: "var(--fx-text-secondary)", margin: 0 }}>
              {policy.detachedDaemon
                ? t(
                    "serversHeroDetached",
                    "Connect over SSH or WebSocket and add remote folders to your sidebar. Remote tasks keep running when this desktop disconnects, then sync when you reconnect.",
                  )
                : t(
                    "serversHeroAttached",
                    "Connect over SSH or WebSocket and add remote folders to your sidebar. Managed remote services stop when you disconnect or quit this desktop.",
                  )}
            </p>
          </div>
          <div
            style={{
              ...serverPanelStyle,
              flex: "0 1 256px",
              minWidth: 180,
              padding: "var(--space-3) var(--space-3-5)",
              display: "grid",
              gap: "var(--space-2)",
            }}
          >
            <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
              {t("serversThisComputer", "This computer")}
            </span>
            {online.length ? (
              online.map((view) => (
                <span
                  key={view.id}
                  className="type-mono-meta"
                  style={{ color: "var(--fx-status-success-text)", overflowWrap: "anywhere" }}
                >
                  ● {view.label}
                </span>
              ))
            ) : (
              <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
                {t("serversNoOnline", "No remote servers online")}
              </span>
            )}
          </div>
        </section>
        <section style={{ display: "grid", gap: "var(--space-2-5)" }}>
          <div style={serverRowStyle}>
            <h2 className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
              {t("serversConfigured", "Configured remote servers")}
            </h2>
            <span className="type-label-default" style={{ flex: 1, color: "var(--fx-text-tertiary)" }}>
              {t("serversConfiguredCount", "{count} servers").replace("{count}", String(servers.length))}
            </span>
            <Button
              variant="primary"
              disabled={Boolean(pending)}
              onClick={() => setDialog({ kind: "add", tab: "ssh-config" })}
            >
              {t("serversAdd", "Add server")}
            </Button>
          </div>
          {servers.length ? (
            <div style={{ ...serverPanelStyle, borderRadius: "var(--radius-dialog)" }}>
              {servers.map((view, index) => (
                <ServerRow
                  key={view.id}
                  view={view}
                  now={now}
                  detachedDaemon={policy.detachedDaemon}
                  divider={index > 0}
                  mountedSpaces={
                    workspace.loaded ? workspace.spaces.filter((space) => space.environmentId === view.id).length : null
                  }
                  onOpenProject={() => openProject(view.id)}
                  onEdit={(focusField, suggestedValue) => setDialog({ kind: "edit", view, focusField, suggestedValue })}
                  onRemove={() => setDialog({ kind: "remove", view })}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                ...serverPanelStyle,
                padding: "var(--space-8) var(--space-7)",
                display: "grid",
                justifyItems: "center",
                gap: "var(--space-3-5)",
                borderStyle: "dashed",
                borderColor: "var(--fx-line-strong)",
                borderRadius: "var(--radius-dialog)",
                textAlign: "center",
              }}
            >
              <ServerIcon size={48} />
              <h3 className="type-title-dialog" style={{ margin: 0 }}>
                {t("serversEmptyTitle", "No remote servers added yet")}
              </h3>
              <p className="type-body-relaxed" style={{ margin: 0, maxWidth: 520, color: "var(--fx-text-secondary)" }}>
                {t(
                  "serversEmptyHelp",
                  "Connect a server to browse its folders and mount remote projects in the sidebar.",
                )}
              </p>
              <div style={serverRowStyle}>
                <Button variant="primary" onClick={() => setDialog({ kind: "add", tab: "ssh-config" })}>
                  {t("serversFromSsh", "Connect from local SSH config")}
                </Button>
                <Button onClick={() => setDialog({ kind: "add", tab: "manual" })}>
                  {t("serversManualAdd", "Enter connection details")}
                </Button>
              </div>
            </div>
          )}
        </section>
        <section style={{ display: "grid", gap: "var(--space-2-5)" }}>
          <div style={serverRowStyle}>
            <h2 className="type-body-medium" style={{ flex: 1, margin: 0, color: "var(--fx-text-secondary)" }}>
              {t("serversDiscovered", "Servers from local SSH configuration")}
            </h2>
            <Button variant="ghost" onClick={() => setDialog({ kind: "add", tab: "manual" })}>
              {t("serversManualAdd", "Enter connection details")}
            </Button>
          </div>
          <SshHostList
            hideAdded
            busy={Boolean(pending)}
            onConnect={(host) => void connectHost(host)}
            onManual={() => setDialog({ kind: "add", tab: "manual" })}
          />
        </section>
        <SettingGroup title={t("serversLifecycle", "Remote service lifecycle and offline tasks")}>
          <SettingRow
            label={t("serversDetachedDaemon", "Run independently of this desktop")}
            description={t(
              "serversDetachedDaemonHelp",
              "Keep remote daemons, running sessions and managed processes alive when this desktop closes or disconnects.",
            )}
            controlId={`${id}-detached`}
            divider={false}
          >
            <Toggle
              id={`${id}-detached`}
              checked={policy.detachedDaemon}
              disabled={Boolean(pending)}
              onChange={(event) => void run({ type: "set-policy", policy: { detachedDaemon: event.target.checked } })}
            />
          </SettingRow>
          <SettingRow
            label={t("serversAutoReconnect", "Reconnect and recover session output automatically")}
            description={t(
              "serversAutoReconnectHelp",
              "Retry interrupted connections and synchronize remote session output after the network recovers.",
            )}
            controlId={`${id}-reconnect`}
          >
            <Toggle
              id={`${id}-reconnect`}
              checked={policy.autoReconnect}
              disabled={Boolean(pending)}
              onChange={(event) => void run({ type: "set-policy", policy: { autoReconnect: event.target.checked } })}
            />
          </SettingRow>
        </SettingGroup>
        <ServerActionError error={error} />
        {dialog?.kind === "add" && (
          <AddServerDialog
            initialTab={dialog.tab}
            onClose={() => setDialog(null)}
            onOpenProject={openProject}
            onEdit={(view, focusField, suggestedValue) => setDialog({ kind: "edit", view, focusField, suggestedValue })}
          />
        )}
        {dialog?.kind === "edit" && (
          <EditServerDialog
            key={dialog.view.id}
            view={dialog.view}
            focusField={dialog.focusField}
            suggestedValue={dialog.suggestedValue}
            onClose={() => setDialog(null)}
            onRemove={() => setDialog({ kind: "remove", view: dialog.view })}
          />
        )}
        {dialog?.kind === "remove" && <RemoveServerDialog view={dialog.view} onClose={() => setDialog(null)} />}
        {picker && (
          <RemoteFolderPickerDialog
            initialEnvironmentId={picker.initialEnvironmentId}
            onClose={() => setPicker(null)}
            onOpenSettings={() => {
              setPicker(null);
              setDialog({ kind: "add", tab: "ssh-config" });
            }}
          />
        )}
      </div>
    </div>
  );
}
