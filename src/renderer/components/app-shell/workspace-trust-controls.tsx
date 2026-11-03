import { useState } from "react";
import { useI18n } from "@/i18n";
import { useRemoteWorkspacesContext, useWorkspaceFacts } from "./remote-workspaces-context";
import { LockKeyholeGlyph } from "../chat-input/workspace-glyphs";

export function WorkspaceTrustToggle({ folder }: { folder: string }) {
  const { t } = useI18n();
  const remote = useRemoteWorkspacesContext();
  const facts = useWorkspaceFacts(folder);
  const [busy, setBusy] = useState(false);
  if (facts.kind !== "ssh" || !remote) return null;
  return (
    <button
      type="button"
      disabled={busy}
      className="type-label-medium"
      onClick={() => {
        setBusy(true);
        void remote
          .setTrust(facts.key, facts.trust === "read-only" ? "trusted" : "read-only")
          .catch(remote.reportError)
          .finally(() => setBusy(false));
      }}
      style={{
        border: "none",
        borderRadius: "var(--radius-control)",
        padding: "3px 8px",
        background: "var(--fx-surface-hover-clear)",
        color: "var(--fx-accent-blue-text)",
        cursor: busy ? "wait" : "pointer",
        flexShrink: 0,
      }}
    >
      {facts.trust === "read-only"
        ? t("sshCardTrust", "Trust this remote repository")
        : t("sshCardSafe", "Switch to safe read-only")}
    </button>
  );
}

export function WorkspacePermissionStrip({ folder }: { folder: string }) {
  const { t } = useI18n();
  const facts = useWorkspaceFacts(folder);
  if (facts.kind !== "ssh") return null;
  const status =
    facts.trust === "read-only"
      ? t(
          "sshCardReadOnlyStatus",
          "Currently in safe read-only browsing. Local global skills are active; remote skills and long-running processes are deferred",
        )
      : t("sshCardTrustedStatus", "This remote repository is trusted");
  return (
    <div
      role="group"
      aria-label={t("sshCardPermissions", "Remote repository permissions")}
      style={{
        height: 32,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        borderTop: "1px solid var(--fx-line-subtle)",
        background: "var(--fx-surface-inset)",
        color: "var(--fx-text-secondary)",
        minWidth: 0,
      }}
    >
      <LockKeyholeGlyph size={12} />
      <span
        className="type-meta-default"
        title={status}
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {status}
      </span>
      <WorkspaceTrustToggle folder={folder} />
    </div>
  );
}
