import { describeWorkspaceKey } from "@shared/workspace-ref";
import { useI18n } from "@/i18n";
import { useRemoteWorkspacesContext, useWorkspaceFacts } from "./remote-workspaces-context";
import { WorkspaceTrustToggle } from "./workspace-trust-controls";

import { WorkspaceTrustPrompt } from "./workspace-trust-prompt";

export function WorkspaceTrustBanner({
  workspace,
  sessionId,
  dismissed,
  onDismiss,
}: {
  workspace: string | null;
  sessionId: string | null;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const facts = useWorkspaceFacts(workspace);
  const remote = useRemoteWorkspacesContext();
  if (facts.kind !== "ssh") return null;
  const prompt = remote?.trustPrompts.findLast(
    (candidate) =>
      candidate.status === "pending" &&
      describeWorkspaceKey(candidate.workspace).workspaceKey === facts.key &&
      (!candidate.sessionId || candidate.sessionId === sessionId),
  );
  if (prompt) return <WorkspaceTrustPrompt prompt={prompt} />;
  if (facts.trust !== "read-only" || dismissed) return null;
  const message = t(
    "sshBannerReadOnlyMessage",
    "Safe read-only browsing: you can read code and use your local skills; remote repo skills and long-running processes are deferred until you trust this repository",
  );
  return (
    <div
      role="status"
      aria-label={t("sshBannerReadOnlyTitle", "Safe read-only browsing")}
      style={{
        height: 36,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        borderBottom: "1px solid var(--fx-status-warning-border)",
        background: "var(--fx-status-warning-soft)",
        color: "var(--fx-status-warning-text)",
        minWidth: 0,
      }}
    >
      <span
        className="type-label-default"
        title={message}
        style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {message}
      </span>
      <WorkspaceTrustToggle folder={facts.key} />
      <button
        type="button"
        aria-label={t("sshBannerDismiss", "Dismiss read-only notice")}
        onClick={onDismiss}
        className="type-body-default"
        style={{
          border: "none",
          background: "var(--fx-surface-hover-clear)",
          color: "var(--fx-status-warning-text)",
          cursor: "pointer",
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}
