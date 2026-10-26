import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { skillOriginText } from "../resources/overview-model";
import { requestErrorMessage, shortenPath, sourceLabel, type Skill } from "./skill-shared";
import { SkillToggle } from "./skill-toggle";

export function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  showName = false,
}: {
  skill: Skill;
  cwd: string;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  showName?: boolean;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;
  const [content, setContent] = useState("");
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    void import("@/lib/api-client")
      .then(({ call }) => call("skills.getContent", { cwd, filePath: skill.filePath }))
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
      })
      .catch((error) => {
        if (!cancelled)
          setContentError(requestErrorMessage(error, t("skillFileLoadFailed", "Failed to load skill file.")));
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, skill.filePath, t]);

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  async function openInEditor(): Promise<void> {
    setOpenError(null);
    try {
      if (!window.piBridge?.openFile) throw new Error(t("skillOpenInEditorFailed", "Couldn't open the editor."));
      await window.piBridge.openFile(skill.filePath);
    } catch (error) {
      setOpenError(requestErrorMessage(error, t("skillOpenInEditorFailed", "Couldn't open the editor.")));
    }
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex items-center gap-[8px]">
        <span className="type-label-default shrink-0 text-[var(--fx-text-tertiary)]">{skillOriginText(skill, t)}</span>
        <span className="type-mono-meta min-w-0 flex-1 truncate text-[var(--fx-text-tertiary)]" title={skill.filePath}>
          {displayPath(skill.filePath)}
        </span>
        <SkillToggle enabled={enabled} loading={toggling} onToggle={() => onToggle(skill)} />
        {saveError && <span className="type-label-default shrink-0 text-[var(--fx-status-danger)]">{saveError}</span>}
      </div>

      {showName && (
        <div className="flex flex-col gap-[4px]">
          <span className="type-label-medium text-[var(--fx-text-secondary)]">{t("name", "Name")}</span>
          <span className="type-body-large-medium text-[var(--fx-text-primary)]">{skill.name}</span>
        </div>
      )}

      <div className="flex flex-col gap-[4px]">
        <span className="type-label-medium text-[var(--fx-text-secondary)]">{t("description", "Description")}</span>
        <span className="type-body-relaxed text-[var(--fx-text-secondary)]">{skill.description}</span>
      </div>

      <section aria-label={t("skillMarkdownContent", "Skill markdown content")} className="flex flex-col gap-[8px]">
        <div className="flex items-center justify-between gap-[8px]">
          <span className="type-label-medium text-[var(--fx-text-secondary)]">{t("skillFileName", "SKILL.md")}</span>
          <Button onClick={() => void openInEditor()}>{t("skillOpenInEditor", "Open in editor")}</Button>
        </div>
        {contentLoading ? (
          <div className="type-label-default p-[12px] text-[var(--fx-text-tertiary)]">
            {t("loadingSkillFile", "Loading skill file…")}
          </div>
        ) : (
          <pre className="type-mono-code m-0 max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-card)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)] p-[12px] text-[var(--fx-text-primary)]">
            {content}
          </pre>
        )}
        {contentError && <span className="type-meta-default text-[var(--fx-status-danger)]">{contentError}</span>}
        {openError && (
          <p role="alert" className="type-label-default m-0 text-[var(--fx-status-danger)]">
            {openError}
          </p>
        )}
      </section>
    </div>
  );
}
