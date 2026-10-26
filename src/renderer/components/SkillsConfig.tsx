import { useCallback, useState, type CSSProperties } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { SkillDetail } from "./skills/skill-detail";
import { AddSkillPanel } from "./skills/add-skill-panel";
import { SkillList } from "./skills/skill-list";
import { useSkillDirectory, type SkillDirectory } from "./skills/use-skill-directory";
import { shortenPath } from "./skills/skill-shared";

const embeddedFrame: CSSProperties = { position: "relative", flex: 1, minWidth: 0, minHeight: 0, display: "flex" };
const dialogFrame: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "var(--fx-surface-scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

interface SkillsConfigProps {
  cwd: string;
  onClose: () => void;
  embedded?: boolean;
  initialAddMode?: boolean;
}

export function SkillsConfig(props: SkillsConfigProps) {
  const directory = useSkillDirectory(props.cwd);
  return <SkillsManager {...props} directory={directory} />;
}

export function SkillsManager({
  cwd,
  onClose,
  embedded = false,
  initialAddMode = false,
  directory,
}: SkillsConfigProps & { directory: SkillDirectory }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [addMode, setAddMode] = useState(initialAddMode);
  const setSelected = directory.setSelected;

  const selectSkill = useCallback(
    (filePath: string) => {
      setSelected(filePath);
      setAddMode(false);
    },
    [setSelected],
  );

  const { skills, loading, error, selected, toggling, saveError, loadSkills, toggle } = directory;
  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  return (
    <div
      style={embedded ? embeddedFrame : dialogFrame}
      onClick={(e) => {
        if (!embedded && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: embedded ? "100%" : isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: embedded ? undefined : "calc(100vw - 16px)",
          height: embedded ? "100%" : isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: embedded ? undefined : "calc(100dvh - 16px)",
          background: "var(--fx-surface-main)",
          border: embedded ? "none" : "1px solid var(--fx-line-default)",
          borderRadius: embedded ? 0 : "var(--radius-card)",
          display: "flex",
          flexDirection: "column",
          boxShadow: embedded ? "none" : "var(--shadow-dialog)",
          overflow: "hidden",
        }}
      >
        {!embedded && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 20px",
              borderBottom: "1px solid var(--fx-line-default)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span className="type-title-dialog" style={{ color: "var(--fx-text-primary)" }}>
                {t("skills", "Skills")}
              </span>
              <code
                className="type-mono-meta"
                style={{
                  color: "var(--fx-text-secondary)",
                  maxWidth: 320,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {shortenPath(cwd)}
              </code>
            </div>
            <button
              onClick={onClose}
              className="type-title-page"
              style={{
                background: "none",
                border: "none",
                color: "var(--fx-text-secondary)",
                cursor: "pointer",
                padding: "2px 8px",
              }}
            >
              ×
            </button>
          </div>
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          <SkillList
            skills={skills}
            loading={loading}
            error={error}
            selected={selected}
            addMode={addMode}
            isMobile={isMobile}
            onSelectSkill={selectSkill}
            onAddSkill={() => setAddMode(true)}
          />

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {addMode ? (
              <AddSkillPanel
                cwd={cwd}
                onInstalled={() => {
                  void loadSkills();
                }}
              />
            ) : loading ? null : selectedSkill ? (
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                showName
              />
            ) : (
              <div
                className="type-body-default"
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--fx-text-tertiary)",
                }}
              >
                {t("selectSkill", "Select a skill")}
              </div>
            )}
          </div>
        </div>

        {!embedded && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "12px 20px",
              borderTop: "1px solid var(--fx-line-default)",
              flexShrink: 0,
            }}
          >
            <button
              onClick={onClose}
              className="type-body-default"
              style={{
                padding: "8px 16px",
                background: "none",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-secondary)",
                cursor: "pointer",
              }}
            >
              {t("close", "Close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
