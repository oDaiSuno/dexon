import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { PlusIcon } from "../resources/overview-icons";
import { sourceLabel, sourceLabelText, type Skill } from "./skill-shared";

export function SkillList({
  skills,
  loading,
  error,
  selected,
  addMode,
  isMobile,
  onSelectSkill,
  onAddSkill,
}: {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  addMode: boolean;
  isMobile: boolean;
  onSelectSkill: (filePath: string) => void;
  onAddSkill: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        width: isMobile ? "100%" : 210,
        maxHeight: isMobile ? "40vh" : undefined,
        borderRight: isMobile ? "none" : "1px solid var(--fx-line-default)",
        borderBottom: isMobile ? "1px solid var(--fx-line-default)" : "none",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        background: "var(--fx-surface-raised)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {loading ? (
          <div
            style={{
              padding: "12px 8px",
              fontSize: "var(--text-label)",
              color: "var(--fx-text-secondary)",
            }}
          >
            {t("loading", "Loading…")}
          </div>
        ) : error ? (
          <div
            style={{
              padding: "12px 8px",
              fontSize: "var(--text-meta)",
              color: "var(--fx-status-danger)",
            }}
          >
            {error}
          </div>
        ) : skills.length === 0 ? (
          <div
            style={{
              padding: "12px 8px",
              fontSize: "var(--text-meta)",
              color: "var(--fx-text-tertiary)",
            }}
          >
            {t("noSkillsFound", "No skills found")}
          </div>
        ) : (
          (() => {
            const groups: { label: string; skills: typeof skills }[] = [];
            for (const grpLabel of ["project", "global", "path"]) {
              const grpSkills = skills.filter((s) => sourceLabel(s) === grpLabel);
              if (grpSkills.length > 0) groups.push({ label: grpLabel, skills: grpSkills });
            }
            return groups.map(({ label: grpLabel, skills: grpSkills }) => (
              <div key={grpLabel} style={{ marginBottom: 8 }}>
                <div
                  style={{
                    padding: "4px 8px 4px",
                    fontSize: "var(--text-micro)",
                    fontWeight: 600,
                    color: "var(--fx-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {sourceLabelText(grpLabel, t)}
                </div>
                {grpSkills.map((skill) => {
                  const isSelected = !addMode && selected === skill.filePath;
                  const disabled = skill.disableModelInvocation;
                  return (
                    <div
                      key={skill.filePath}
                      onClick={() => {
                        if (isSelected) return;
                        onSelectSkill(skill.filePath);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 8px",
                        borderRadius: "var(--radius-control)",
                        cursor: "pointer",
                        background: isSelected ? "var(--bg-selected)" : "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "none";
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: disabled ? "var(--fx-line-default)" : "var(--fx-accent-blue)",
                          boxShadow: disabled ? "none" : "0 0 4px var(--fx-accent-blue)",
                          transition: "background 0.15s, box-shadow 0.15s",
                        }}
                      />
                      <span
                        style={{
                          fontSize: "var(--text-label)",
                          fontWeight: isSelected ? 600 : 400,
                          color: disabled ? "var(--fx-text-tertiary)" : "var(--fx-text-primary)",
                          fontFamily: "var(--font-mono)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {skill.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            ));
          })()
        )}
      </div>
      <div
        style={{
          padding: "8px 8px",
          borderTop: "1px solid var(--fx-line-default)",
          flexShrink: 0,
        }}
      >
        <Button
          variant={addMode ? "secondary" : "ghost"}
          aria-pressed={addMode}
          onClick={onAddSkill}
          className="w-full justify-start"
        >
          <PlusIcon size={14} />
          {t("addSkill", "Add skill")}
        </Button>
      </div>
    </div>
  );
}
