import { Fragment } from "react";
import { useI18n } from "@/i18n";
import type { CatalogSkill } from "./use-skill-catalog";
import { PackageIcon } from "./icons";
import { KeyHint } from "./SendControls";

import { SkillPickerGroup, skillScope } from "./skill-picker-group";
import { useWorkspaceFacts } from "../app-shell/remote-workspaces-context";

export function SkillPickerRows({
  skills,
  cwd,
  onRefresh,
  groupSizes,
  needle,
  activeIndex,
  onPick,
  setActiveIndex,
}: {
  skills: readonly CatalogSkill[];
  cwd?: string;
  onRefresh: () => void;
  groupSizes: number[];
  needle: string;
  activeIndex: number;
  onPick: (skill: CatalogSkill) => void;
  setActiveIndex: (index: number) => void;
}) {
  const { t } = useI18n();
  const facts = useWorkspaceFacts(cwd);
  const scopeLabel = (skill: CatalogSkill) => {
    const scope = skillScope(skill, facts.kind === "ssh");
    if (scope === "global") return t("skillScopeGlobal", "global");
    if (scope === "project" || scope === "remote") return t("skillScopeProject", "project");
    return t("skillScopePath", "path");
  };

  const highlight = (name: string, active: boolean) => {
    const at = needle ? name.toLowerCase().indexOf(needle) : -1;
    if (at < 0) return name;
    return (
      <>
        <span style={{ color: active ? undefined : "var(--fx-text-secondary)" }}>{name.slice(0, at)}</span>
        <span className="type-mono-label-strong">{name.slice(at, at + needle.length)}</span>
        <span style={{ color: active ? undefined : "var(--fx-text-secondary)" }}>{name.slice(at + needle.length)}</span>
      </>
    );
  };

  return (
    <>
      {skills.map((skill, index) => {
        const active = index === activeIndex;
        return (
          <Fragment key={skill.filePath}>
            {groupSizes[index] > 0 && (
              <SkillPickerGroup
                cwd={cwd}
                skill={skill}
                count={groupSizes[index]}
                locked={skills.slice(index, index + groupSizes[index]).some((entry) => entry.lockedByReadOnly)}
                onRefresh={onRefresh}
              />
            )}
            <button
              type="button"
              role="menuitem"
              aria-disabled={skill.lockedByReadOnly ? true : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!skill.lockedByReadOnly) onPick(skill);
              }}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
              style={{
                position: "relative",
                zIndex: 1,
                width: "100%",
                height: 36,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0 10px",
                border: "none",
                borderRadius: "var(--radius-control)",
                background: "none",
                cursor: skill.lockedByReadOnly ? "not-allowed" : "pointer",
                textAlign: "left",
                color: "inherit",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  display: "flex",
                  color: active ? "var(--fx-accent-blue-text)" : "var(--fx-text-tertiary)",
                }}
              >
                <PackageIcon size={15} />
              </span>
              <span
                className="type-mono-label"
                style={{
                  flexShrink: 0,
                  color: active ? "var(--fx-accent-blue-text)" : "var(--fx-text-primary)",
                }}
              >
                {highlight(skill.name, active)}
              </span>
              <span
                className="type-label-default"
                style={{
                  minWidth: 0,
                  flex: 1,
                  color: "var(--fx-text-tertiary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {skill.description}
              </span>
              <span
                className={needle ? "type-meta-default" : "sr-only"}
                style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
              >
                {scopeLabel(skill)}
              </span>
              {facts.kind === "ssh" && skillScope(skill, true) === "global" && (
                <span className="type-meta-micro" style={{ color: "var(--fx-text-tertiary)", flexShrink: 0 }}>
                  {skill.hasLocalScripts
                    ? t("sshSkillsLocalScripts", "Local scripts")
                    : t("sshSkillsReadLocally", "Read locally")}
                </span>
              )}
              {facts.kind === "ssh" && skill.lockedByReadOnly && (
                <span className="type-mono-meta" style={{ color: "var(--fx-status-warning-text)", flexShrink: 0 }}>
                  {t("sshSkillsLocked", "@{host} · locked").replace("{host}", facts.hostLabel)}
                </span>
              )}
              {active && !skill.lockedByReadOnly && <KeyHint keyLabel="↵" label={t("skillPickerInsert", "Insert")} />}
            </button>
          </Fragment>
        );
      })}
    </>
  );
}
