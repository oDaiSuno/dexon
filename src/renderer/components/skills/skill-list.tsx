import { useI18n } from "@/i18n";
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
        borderRight: isMobile ? "none" : "1px solid var(--border)",
        borderBottom: isMobile ? "1px solid var(--border)" : "none",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        background: "var(--bg-panel)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {loading ? (
          <div
            style={{
              padding: "12px 8px",
              fontSize: "var(--text-label)",
              color: "var(--text-muted)",
            }}
          >
            {t("loading", "Loading…")}
          </div>
        ) : error ? (
          <div
            style={{
              padding: "12px 8px",
              fontSize: "var(--text-meta)",
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        ) : skills.length === 0 ? (
          <div
            style={{
              padding: "12px 8px",
              fontSize: "var(--text-meta)",
              color: "var(--text-dim)",
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
                    color: "var(--text-dim)",
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
                          background: disabled ? "var(--border)" : "var(--accent)",
                          boxShadow: disabled ? "none" : "0 0 4px var(--accent)",
                          transition: "background 0.15s, box-shadow 0.15s",
                        }}
                      />
                      <span
                        style={{
                          fontSize: "var(--text-label)",
                          fontWeight: isSelected ? 600 : 400,
                          color: disabled ? "var(--text-dim)" : "var(--text)",
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
      {/* Add skill button */}
      <div
        style={{
          padding: "8px 8px",
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div
          onClick={onAddSkill}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 8px",
            borderRadius: "var(--radius-control)",
            cursor: "pointer",
            background: addMode ? "var(--bg-selected)" : "none",
            color: addMode ? "var(--accent)" : "var(--text-dim)",
            fontSize: "var(--text-label)",
          }}
          onMouseEnter={(e) => {
            if (!addMode) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!addMode) e.currentTarget.style.background = "none";
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("addSkill", "Add skill")}
        </div>
      </div>
    </div>
  );
}
