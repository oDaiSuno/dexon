import { useEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { useRemoteWorkspacesContext, useWorkspaceFacts } from "./remote-workspaces-context";
import { WorkspaceTrustToggle } from "./workspace-trust-controls";

export function RuleLensPopover({
  workspace,
  popoverRef,
}: {
  workspace: string;
  popoverRef: RefObject<HTMLDivElement | null>;
}) {
  const { language, t } = useI18n();
  const facts = useWorkspaceFacts(workspace);
  const remote = useRemoteWorkspacesContext();
  useEffect(() => popoverRef.current?.focus(), [popoverRef]);
  if (facts.kind !== "ssh") return null;
  const lens = facts.state?.ruleLens;
  const boundary =
    lens?.ancestorBoundary === "git-root"
      ? t("sshLensGitBoundary", "Rule lookup stops at the remote Git repository root ({path})")
      : t("sshLensHomeBoundary", "Rule lookup stops at the remote home directory ({path})");
  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      tabIndex={-1}
      aria-label={t("sshLensTitle", "Dual-space environment and rule lens")}
      className="composer-pop-in"
      style={{
        position: "fixed",
        top: 60,
        right: 8,
        width: 480,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100dvh - 72px)",
        overflowY: "auto",
        boxSizing: "border-box",
        zIndex: 200,
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-menu)",
        boxShadow: "var(--shadow-popover)",
        outline: "none",
      }}
    >
      <div
        style={{
          padding: 14,
          borderBottom: "1px solid var(--fx-line-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
          {t("sshLensTitle", "Dual-space environment and rule lens")}
        </span>
        <span className="type-mono-meta" style={{ overflowWrap: "anywhere", color: "var(--fx-text-tertiary)" }}>
          {facts.key}
        </span>
      </div>
      <section style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
          {t("sshLensLocalLayer", "Local overlay layer")}
        </h3>
        {lens?.localAgentsMd && (
          <span className="type-mono-meta" style={{ color: "var(--fx-text-secondary)" }}>
            ~/.pi/agent/AGENTS.md
          </span>
        )}
        <span className="type-mono-meta" style={{ color: "var(--fx-text-secondary)" }}>
          {t("sshLensGlobalSkills", "~/.pi/agent/skills ({count} mounted)").replace(
            "{count}",
            String(lens?.localSkillCount ?? facts.state?.localSkillCount ?? 0),
          )}
        </span>
        <span
          className="type-meta-default"
          style={{ color: "var(--fx-status-success-text)", overflowWrap: "anywhere" }}
        >
          {t(
            "sshLensCredentialsBlocked",
            "~/.pi/agent/auth.json and models.json are strictly blocked for remote sessions",
          )}
        </span>
      </section>
      <section
        style={{
          padding: 14,
          borderTop: "1px solid var(--fx-line-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <h3 className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
          {t("sshLensRemoteLayer", "Remote project mirror layer")}
        </h3>
        {lens ? (
          <>
            {lens.remoteAgentsMdPaths.length > 0 ? (
              lens.remoteAgentsMdPaths.map((path) => (
                <span
                  key={path}
                  className="type-mono-meta"
                  style={{ color: "var(--fx-text-secondary)", overflowWrap: "anywhere" }}
                >
                  {path}
                </span>
              ))
            ) : (
              <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
                {t("sshLensNoRules", "No AGENTS.md found")}
              </span>
            )}
            <span
              className="type-meta-default"
              style={{
                color: facts.trust === "trusted" ? "var(--fx-status-success-text)" : "var(--fx-status-warning-text)",
              }}
            >
              {(facts.trust === "trusted"
                ? t("sshLensSkillsEnabled", "Project skills: {count} enabled")
                : t("sshLensSkillsDeferred", "Project skills: {count} deferred")
              ).replace("{count}", String(lens.remoteSkillCount))}
            </span>
            <span className="type-meta-default" style={{ color: "var(--fx-text-secondary)", overflowWrap: "anywhere" }}>
              {boundary.replace("{path}", lens.boundaryPath)}
            </span>
            {lens.syncedAt !== null && (
              <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
                {t("sshLensSynced", "Synced {time}").replace(
                  "{time}",
                  new Date(lens.syncedAt).toLocaleString(language),
                )}
              </span>
            )}
          </>
        ) : (
          <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
            {t("sshLensWaiting", "Remote rules have not been synced yet")}
          </span>
        )}
      </section>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderTop: "1px solid var(--fx-line-subtle)",
        }}
      >
        <button
          type="button"
          className="type-label-default"
          onClick={() => remote && void remote.syncRules(facts.key).catch(remote.reportError)}
          style={{
            border: "none",
            background: "var(--fx-surface-hover-clear)",
            color: "var(--fx-text-secondary)",
            padding: "3px 6px",
            cursor: "pointer",
          }}
        >
          {t("sshLensSync", "↻ Re-sync remote rules")}
        </button>
        <WorkspaceTrustToggle folder={facts.key} />
      </div>
    </div>,
    document.body,
  );
}
