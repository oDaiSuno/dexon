import { useState } from "react";
import { useI18n } from "@/i18n";
import type { CatalogSkill } from "./use-skill-catalog";
import { useRemoteWorkspacesContext, useWorkspaceFacts } from "../app-shell/remote-workspaces-context";
import { LockKeyholeGlyph } from "./workspace-glyphs";

export function skillScope(skill: CatalogSkill, remote = false): "global" | "project" | "path" | "remote" {
  if (remote) {
    if (skill.origin === "local-global") return "global";
    if (skill.origin === "remote-project") return "remote";
    if (skill.origin === "local-project") return "project";
  }
  const source = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || source === "user") return "global";
  if (scope === "project" || source === "project") return remote ? "remote" : "project";
  return "path";
}

export function SkillPickerGroup({
  cwd,
  skill,
  count,
  locked,
  onRefresh,
}: {
  cwd?: string;
  skill: CatalogSkill;
  count: number;
  locked: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const facts = useWorkspaceFacts(cwd);
  const remote = useRemoteWorkspacesContext();
  const [busy, setBusy] = useState(false);
  const scope = skillScope(skill, facts.kind === "ssh");
  const localLabel =
    scope === "global"
      ? t("skillScopeGlobal", "global")
      : scope === "project" || scope === "remote"
        ? t("skillScopeProject", "project")
        : t("skillScopePath", "path");
  const isRemote = facts.kind === "ssh" && scope === "remote";
  const isGlobal = facts.kind === "ssh" && scope === "global";
  return (
    <div
      aria-hidden={facts.kind !== "ssh" ? true : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "var(--space-2) 10px var(--space-1)",
        color: isRemote && locked ? "var(--fx-status-warning-text)" : "var(--fx-text-tertiary)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {isRemote && locked && <LockKeyholeGlyph size={11} />}
        <span className="type-meta-caps">
          {isGlobal
            ? t("sshSkillsGlobal", "Global · local ~/.pi/agent/skills ({count})").replace("{count}", String(count))
            : isRemote
              ? t("sshSkillsRemote", "Project · remote {host}").replace("{host}", facts.hostLabel)
              : localLabel}
        </span>
        {!isGlobal && <span className="type-mono-meta">{count}</span>}
        {isRemote && locked && remote && (
          <button
            type="button"
            disabled={busy}
            className="type-label-medium"
            onClick={() => {
              setBusy(true);
              void remote
                .setTrust(facts.key, "trusted")
                .then(onRefresh)
                .catch(remote.reportError)
                .finally(() => setBusy(false));
            }}
            style={{
              marginLeft: "auto",
              border: "none",
              borderRadius: "var(--radius-control)",
              padding: "2px 6px",
              background: "var(--fx-status-warning-soft)",
              color: "var(--fx-status-warning-text)",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {t("sshSkillsTrust", "Trust repository to enable ↵")}
          </button>
        )}
      </div>
      {isGlobal && (
        <span className="type-meta-default">
          {t("sshSkillsGlobalNote", "Not limited by remote trust · read directly from this computer")}
        </span>
      )}
      {isRemote && locked && (
        <span className="type-meta-default">
          {t("sshSkillsDeferred", "Found {count} · deferred in safe read-only").replace("{count}", String(count))}
        </span>
      )}
    </div>
  );
}
