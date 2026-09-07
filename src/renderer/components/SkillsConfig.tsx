import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { SkillDetail, type SkillDetailHandle } from "./skills/skill-detail";
import { AddSkillPanel } from "./skills/add-skill-panel";
import { SkillList } from "./skills/skill-list";
import { UnsavedSkillPrompt } from "./skills/unsaved-skill-prompt";
import { useSkillDirectory } from "./skills/use-skill-directory";
import { useSkillLeaveGuard } from "./skills/use-skill-leave-guard";
import { shortenPath } from "./skills/skill-shared";

export interface SkillsConfigHandle {
  requestLeave: (onAllowed: () => void) => void;
}

export const SkillsConfig = forwardRef<
  SkillsConfigHandle,
  {
    cwd: string;
    onClose: () => void;
    embedded?: boolean;
  }
>(function SkillsConfig({ cwd, onClose, embedded = false }, ref) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [addMode, setAddMode] = useState(false);
  const directory = useSkillDirectory(cwd);
  const detailRef = useRef<SkillDetailHandle>(null);
  const guard = useSkillLeaveGuard(detailRef);

  const requestTransition = guard.requestTransition;

  useImperativeHandle(ref, () => ({ requestLeave: requestTransition }), [requestTransition]);

  const selectSkill = useCallback(
    (filePath: string) => {
      requestTransition(() => {
        directory.setSelected(filePath);
        setAddMode(false);
      });
    },
    [requestTransition, directory],
  );

  const { skills, loading, error, selected, toggling, saveError, loadSkills, toggle } = directory;
  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  return (
    <div
      style={
        embedded
          ? {
              position: "relative",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
            }
          : {
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }
      }
      onClick={(e) => {
        if (!embedded && e.target === e.currentTarget) requestTransition(onClose);
      }}
    >
      <div
        style={{
          width: embedded ? "100%" : isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: embedded ? undefined : "calc(100vw - 16px)",
          height: embedded ? "100%" : isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: embedded ? undefined : "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: embedded ? "none" : "1px solid var(--border)",
          borderRadius: embedded ? 0 : 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: embedded ? "none" : "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        {!embedded && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 20px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: "var(--text-title)", fontWeight: 700, color: "var(--text)" }}>
                {t("skills", "Skills")}
              </span>
              <code
                style={{
                  fontSize: "var(--text-meta)",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
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
              onClick={() => requestTransition(onClose)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "var(--text-display)",
                lineHeight: 1,
                padding: "2px 8px",
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          <SkillList
            skills={skills}
            loading={loading}
            error={error}
            selected={selected}
            addMode={addMode}
            isMobile={isMobile}
            onSelectSkill={selectSkill}
            onAddSkill={() => requestTransition(() => setAddMode(true))}
          />

          {/* Right: detail or add panel */}
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
                ref={detailRef}
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                onSaved={() => void loadSkills()}
                onDirtyChange={guard.setDetailDirty}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: "var(--text-body)",
                }}
              >
                {t("selectSkill", "Select a skill")}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {!embedded && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "12px 20px",
              borderTop: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => requestTransition(onClose)}
              style={{
                padding: "8px 16px",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "var(--text-body)",
              }}
            >
              {t("close", "Close")}
            </button>
          </div>
        )}
      </div>
      {guard.pendingTransition && (
        <UnsavedSkillPrompt
          saving={guard.transitionSaving}
          onDiscard={guard.discardAndContinue}
          onCancel={guard.cancelTransition}
          onSave={guard.saveAndContinue}
        />
      )}
    </div>
  );
});
