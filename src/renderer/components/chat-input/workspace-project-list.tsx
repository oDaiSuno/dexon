import { useState } from "react";
import { useI18n } from "@/i18n";
import { CheckmarkIcon } from "./icons";
import { QUICK } from "./menu-chrome";
import type { ComposerCardProject } from "./types";
import {
  ELLIPSIS,
  GLYPH,
  HOVER_OVERLAY,
  OUTLINE_NONE,
  PROJECTS_PANE_WIDTH,
  SECTION,
  SURFACE_SIDEBAR,
} from "./workspace-chrome";
import { ChevronRightGlyph, FolderGlyph, FolderMissingGlyph, FolderOpenGlyph, HouseGlyph } from "./workspace-glyphs";

const ROW_HEIGHT = 44;

function projectGlyph(project: ComposerCardProject) {
  switch (project.icon) {
    case "house":
      return <HouseGlyph size={15} />;
    case "folder-open":
      return <FolderOpenGlyph size={15} />;
    case "folder-missing":
      return <FolderMissingGlyph size={15} />;
    case "folder":
      return <FolderGlyph size={15} />;
  }
}

export function WorkspaceProjectList({
  projects,
  onActivate,
  onBrowse,
  showEnvironmentGroups = false,
}: {
  projects: ComposerCardProject[];
  onActivate: (key: string) => void;
  onBrowse: (key: string) => void;
  showEnvironmentGroups?: boolean;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const groups = showEnvironmentGroups
    ? [...new Set(projects.map((project) => project.environmentId))]
        .map((environmentId) => projects.filter((project) => project.environmentId === environmentId))
        .sort((left, right) => Number(right[0].isPrimaryEnvironment) - Number(left[0].isPrimaryEnvironment))
    : [];

  const renderProject = (project: ComposerCardProject) => {
    const disabled = project.missing || project.unavailable;
    const revealed = hovered === project.key || focused === project.key;
    const iconColor = disabled
      ? "var(--fx-text-faint)"
      : project.current
        ? "var(--fx-text-primary)"
        : "var(--fx-text-secondary)";
    return (
      <div
        key={project.key}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          minHeight: ROW_HEIGHT,
          borderRadius: "var(--radius-control)",
          background: project.browsed || (revealed && !disabled) ? HOVER_OVERLAY : "transparent",
          transition: `background ${QUICK}`,
        }}
        onMouseEnter={() => setHovered(project.key)}
        onMouseLeave={() => setHovered((key) => (key === project.key ? null : key))}
      >
        <button
          type="button"
          aria-label={project.name}
          aria-current={project.current ? "true" : undefined}
          aria-disabled={disabled ? "true" : undefined}
          disabled={disabled}
          tabIndex={project.browsed ? 0 : -1}
          data-workspace-row="project"
          data-workspace-key={project.key}
          onClick={() => onActivate(project.key)}
          onFocus={() => setFocused(project.key)}
          onBlur={() => setFocused((key) => (key === project.key ? null : key))}
          style={{
            ...OUTLINE_NONE,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flex: 1,
            minWidth: 0,
            height: ROW_HEIGHT,
            padding: project.current ? "0 44px 0 8px" : "0 26px 0 8px",
            border: "none",
            borderRadius: "var(--radius-control)",
            background: "transparent",
            textAlign: "left",
            cursor: disabled ? "default" : "pointer",
          }}
        >
          <span style={{ ...GLYPH, color: iconColor }}>{projectGlyph(project)}</span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
            <span
              className="type-body-medium"
              style={{
                ...ELLIPSIS,
                color: disabled ? "var(--fx-text-tertiary)" : "var(--fx-text-primary)",
              }}
            >
              {project.name}
            </span>
            <span
              className={project.sublineKind === "branch" ? "type-mono-meta" : "type-meta-default"}
              style={{
                ...ELLIPSIS,
                color: project.sublineKind === "branch" ? "var(--fx-text-secondary)" : "var(--fx-text-tertiary)",
              }}
            >
              {project.subline}
            </span>
          </span>
        </button>
        {project.current && (
          <span
            style={{
              ...GLYPH,
              position: "absolute",
              right: 26,
              color: "var(--fx-accent-blue-text)",
              pointerEvents: "none",
            }}
          >
            <CheckmarkIcon size={14} />
          </span>
        )}
        {!disabled && (
          <button
            type="button"
            aria-label={t("showBranches", "Show branches of {project}").replace("{project}", project.name)}
            tabIndex={-1}
            data-workspace-browse={project.key}
            onClick={() => onBrowse(project.key)}
            onFocus={() => setFocused(project.key)}
            onBlur={() => setFocused((key) => (key === project.key ? null : key))}
            style={{
              ...OUTLINE_NONE,
              position: "absolute",
              right: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              padding: 0,
              border: "none",
              borderRadius: "var(--radius-chip)",
              background: "transparent",
              color: "var(--fx-text-tertiary)",
              cursor: "pointer",
              opacity: project.browsed || revealed ? 1 : 0,
              transition: `opacity ${QUICK}`,
            }}
          >
            <ChevronRightGlyph size={13} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      role="group"
      aria-label={t("projects", "Projects")}
      style={{
        width: PROJECTS_PANE_WIDTH,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 0,
        boxSizing: "border-box",
        padding: 6,
        background: SURFACE_SIDEBAR,
        borderRight: "1px solid var(--fx-line-default)",
      }}
    >
      <div className="type-meta-caps" style={{ ...SECTION, padding: "4px 8px" }}>
        {t("projects", "Projects")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", minHeight: 0 }}>
        {showEnvironmentGroups
          ? groups.map((group) => (
              <div
                key={group[0].environmentId}
                role="group"
                aria-label={group[0].environmentLabel}
                style={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
                <div className="type-meta-caps" style={{ ...SECTION, padding: "4px 8px" }}>
                  {!group[0].isPrimaryEnvironment && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        flexShrink: 0,
                        borderRadius: "50%",
                        background:
                          group[0].environmentState === "connected"
                            ? "var(--fx-status-success)"
                            : group[0].environmentState === "connecting"
                              ? "var(--fx-status-warning)"
                              : "var(--fx-text-faint)",
                      }}
                    />
                  )}
                  <span style={ELLIPSIS}>{group[0].environmentLabel}</span>
                </div>
                {group.map(renderProject)}
              </div>
            ))
          : projects.map(renderProject)}
      </div>
    </div>
  );
}
