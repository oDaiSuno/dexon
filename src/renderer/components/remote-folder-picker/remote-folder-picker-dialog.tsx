import { useState } from "react";
import { useI18n } from "@/i18n";
import { workspaceStore } from "@/lib/workspace-store";
import { Button } from "../form-controls";
import { ModelDialogShell } from "../models/model-dialog-shell";
import { useFolderBrowser } from "./use-folder-browser";
import { FolderColumns } from "./folder-columns";
import { PathBar } from "./path-bar";
import { ServerColumn } from "./server-column";
import { FolderPickerIcon } from "./folder-picker-ui";

export interface RemoteFolderPickerDialogProps {
  initialEnvironmentId?: string;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function RemoteFolderPickerDialog({
  initialEnvironmentId,
  onClose,
  onOpenSettings,
}: RemoteFolderPickerDialogProps) {
  const { t } = useI18n();
  const browser = useFolderBrowser({ initialEnvironmentId });
  const empty = browser.state.kind === "no-servers";
  const [mounting, setMounting] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const target = browser.mountTarget();
  const server = browser.servers.find((view) => view.id === browser.state.targetEnvironmentId);
  const confirm = async () => {
    const current = browser.mountTarget();
    if (!current || mounting) return;
    setMountError(null);
    setMounting(true);
    try {
      const result = await workspaceStore.mountAndOpen(current);
      if (result === "opened") onClose();
      else
        setMountError(
          t("remoteFolderMountInvalid", "This folder could not be mounted. It may have moved or become unavailable."),
        );
    } catch {
      setMountError(
        t("remoteFolderMountFailed", "Could not mount this folder. Check the server connection and try again."),
      );
    } finally {
      setMounting(false);
    }
  };
  return (
    <div className="remote-folder-picker">
      <ModelDialogShell
        width={empty ? 400 : 860}
        dirty={false}
        elevated
        divided
        title={
          <span style={{ display: "block", whiteSpace: "normal" }}>
            {t("remoteFolderTitle", "Add a project space from a remote server")}
          </span>
        }
        subtitle={t("remoteFolderSubtitle", "Browse a server without changing your current conversation.")}
        onClose={() => {
          if (!mounting) onClose();
        }}
        notice={mountError ? { tone: "danger", text: mountError } : null}
        trailing={
          !empty && (
            <div className="remote-folder-header-action">
              <Button disabled={mounting} onClick={onOpenSettings}>
                {t("remoteFolderSettings", "Server settings ↗")}
              </Button>
            </div>
          )
        }
        footer={
          <footer
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "var(--space-2-5)",
              padding: "var(--space-3) var(--space-5)",
              borderTop: "1px solid var(--fx-line-default)",
              background: "var(--fx-surface-card)",
            }}
          >
            <div
              className="remote-folder-picker-target"
              style={{ minWidth: 0, display: "grid", gap: "var(--space-1)" }}
            >
              {!empty && (
                <span className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
                  {t("remoteFolderMountHint", "Mounted as a remote project space in the sidebar")}
                </span>
              )}
              {target && (
                <span
                  className="type-mono-meta"
                  style={{
                    color: "var(--fx-text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={`${server?.label}:${target.path}`}
                >
                  {server?.label}:{target.displayPath}
                </span>
              )}
            </div>
            <Button disabled={mounting} onClick={onClose}>
              {t("remoteFolderCancel", "Cancel")}
            </Button>
            {!empty && (
              <Button variant="primary" busy={mounting} disabled={!target || mounting} onClick={() => void confirm()}>
                {t("remoteFolderConfirm", "Mount project space")}
              </Button>
            )}
          </footer>
        }
      >
        {empty && (
          <section
            style={{
              display: "grid",
              justifyItems: "center",
              gap: "var(--space-3-5)",
              padding: "var(--space-8) var(--space-6)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "var(--space-12)",
                height: "var(--space-12)",
                display: "grid",
                placeItems: "center",
                color: "var(--fx-accent-blue-text)",
                background: "var(--fx-accent-blue-soft)",
                border: "1px solid var(--fx-accent-blue-border)",
                borderRadius: "var(--radius-menu)",
              }}
            >
              <FolderPickerIcon kind="server" size={22} />
            </div>
            <h3 className="type-body-large-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
              {t("remoteFolderNoServers", "No remote servers yet")}
            </h3>
            <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
              {t(
                "remoteFolderNoServersHint",
                "Add a server from your SSH config or enter its connection details in Settings, then browse its folders here.",
              )}
            </p>
            <Button variant="primary" onClick={onOpenSettings}>
              {t("remoteFolderAddInSettings", "Add a remote server in Settings")}
            </Button>
          </section>
        )}
        {!empty && (
          <div className="remote-folder-picker-body">
            <ServerColumn
              servers={browser.servers}
              targetEnvironmentId={browser.state.targetEnvironmentId}
              disabled={mounting}
              onSelectServer={browser.selectServer}
              onOpenSettings={onOpenSettings}
            />
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2-5)",
                padding: "var(--space-3-5) var(--space-4-5)",
              }}
            >
              <PathBar state={browser.state} server={server} disabled={mounting} onOpenPath={browser.openPath} />
              {browser.state.kind === "server-unavailable" ? (
                <div
                  role="status"
                  className="type-body-relaxed"
                  style={{
                    margin: "auto",
                    padding: "var(--space-6)",
                    textAlign: "center",
                    color: "var(--fx-text-secondary)",
                  }}
                >
                  {t("remoteFolderUnavailable", "Connect this server to browse its folders.")}
                </div>
              ) : (
                <FolderColumns
                  state={browser.state}
                  disabled={mounting}
                  onSelectChild={browser.selectChild}
                  onOpenPath={browser.openPath}
                />
              )}
            </div>
          </div>
        )}
      </ModelDialogShell>
    </div>
  );
}
