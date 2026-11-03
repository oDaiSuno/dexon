import { useI18n } from "@/i18n";
import type { RemoteTrustPromptEvent } from "@contract/workspace";
import { useRemoteWorkspacesContext } from "./remote-workspaces-context";

export function WorkspaceTrustPrompt({ prompt }: { prompt: RemoteTrustPromptEvent }) {
  const { t } = useI18n();
  const remote = useRemoteWorkspacesContext();
  const title =
    prompt.kind === "process_start"
      ? t("sshBannerProcessPaused", "process_start paused")
      : t("sshBannerSkillPaused", "Remote skill request paused");
  const decide = (decision: "trust" | "keep-read-only") => {
    if (remote) void remote.resolveTrustPrompt(prompt.promptId, decision).catch(remote.reportError);
  };
  return (
    <div
      role="alert"
      aria-label={title}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flexShrink: 0,
        padding: "10px 14px",
        borderBottom: "1px solid var(--fx-status-warning-border)",
        background: "var(--fx-status-warning-soft)",
        color: "var(--fx-status-warning-text)",
      }}
    >
      <span className="type-body-medium">{title}</span>
      <code className="type-mono-label" style={{ overflowWrap: "anywhere" }}>
        {prompt.command ?? prompt.skillName}
      </code>
      <span className="type-mono-meta" style={{ overflowWrap: "anywhere" }}>
        {prompt.cwd}
      </span>
      <span className="type-label-default">
        {t("sshBannerEnableSkills", "Trusting will also enable {count} project skills").replace(
          "{count}",
          String(prompt.remoteSkillCount),
        )}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => decide("keep-read-only")}
          className="type-label-default"
          style={{
            border: "1px solid var(--fx-status-warning-border)",
            borderRadius: "var(--radius-control)",
            background: "var(--fx-surface-hover-clear)",
            color: "var(--fx-status-warning-text)",
            padding: "5px 8px",
            cursor: "pointer",
          }}
        >
          {t("sshBannerReject", "Keep read-only and reject this run")}
        </button>
        <button
          type="button"
          onClick={() => decide("trust")}
          className="type-label-medium"
          style={{
            border: "none",
            borderRadius: "var(--radius-control)",
            background: "var(--fx-accent-blue-fill)",
            color: "var(--fx-text-on-accent)",
            padding: "5px 8px",
            cursor: "pointer",
          }}
        >
          {t("sshBannerTrustContinue", "Trust this remote repository and continue ↵")}
        </button>
      </div>
    </div>
  );
}
