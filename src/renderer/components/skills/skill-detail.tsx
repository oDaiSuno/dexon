import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { scopeText } from "../resources/overview-model";
import { requestErrorMessage, shortenPath, sourceLabel, type Skill } from "./skill-shared";
import { SkillToggle } from "./skill-toggle";

export interface SkillDetailHandle {
  hasUnsavedChanges: () => boolean;
  save: () => Promise<boolean>;
}

export const SkillDetail = forwardRef<
  SkillDetailHandle,
  {
    skill: Skill;
    cwd: string;
    onToggle: (skill: Skill) => void;
    toggling: boolean;
    saveError: string | null;
    onSaved: () => void;
    onDirtyChange: (dirty: boolean) => void;
  }
>(function SkillDetail({ skill, cwd, onToggle, toggling, saveError, onSaved, onDirtyChange }, ref) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [contentLoading, setContentLoading] = useState(true);
  const [contentSaving, setContentSaving] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    void import("@/lib/api-client")
      .then(({ call }) => call("skills.getContent", { cwd, filePath: skill.filePath }))
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setSavedContent(result.content);
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

  const saveContent = useCallback(async (): Promise<boolean> => {
    if (content === savedContent) return true;
    setContentSaving(true);
    setContentError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, filePath: skill.filePath, content }),
      });
      const result = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || result.error) {
        throw new Error(result.error ?? t("httpErrorStatus", "HTTP {status}").replace("{status}", String(res.status)));
      }
      setSavedContent(content);
      onSaved();
      return true;
    } catch (error) {
      setContentError(requestErrorMessage(error, t("skillFileSaveFailed", "Failed to save skill file.")));
      return false;
    } finally {
      setContentSaving(false);
    }
  }, [content, cwd, onSaved, savedContent, skill.filePath, t]);

  useImperativeHandle(
    ref,
    () => ({
      hasUnsavedChanges: () => content !== savedContent,
      save: saveContent,
    }),
    [content, saveContent, savedContent],
  );

  useEffect(() => {
    onDirtyChange(content !== savedContent);
    return () => onDirtyChange(false);
  }, [content, onDirtyChange, savedContent]);

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  const dirty = content !== savedContent;

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex items-center gap-[8px]">
        <span className="type-label-default shrink-0 text-[var(--fx-text-tertiary)]">{scopeText(label, t)}</span>
        <span className="type-mono-meta min-w-0 flex-1 truncate text-[var(--fx-text-tertiary)]">
          {displayPath(skill.filePath)}
        </span>
        <SkillToggle enabled={enabled} loading={toggling} onToggle={() => onToggle(skill)} />
        {saveError && <span className="type-label-default shrink-0 text-[var(--fx-status-danger)]">{saveError}</span>}
      </div>

      <div className="flex flex-col gap-[4px]">
        <span className="type-label-medium text-[var(--fx-text-secondary)]">{t("name", "Name")}</span>
        <span className="type-body-large-medium text-[var(--fx-text-primary)]">{skill.name}</span>
      </div>

      <div className="flex min-h-[260px] flex-col gap-[8px]">
        <div className="flex items-center justify-between gap-[8px]">
          <span className="type-label-medium text-[var(--fx-text-secondary)]">{t("skillFileName", "SKILL.md")}</span>
          <Button
            variant={dirty ? "primary" : "secondary"}
            busy={contentSaving}
            disabled={contentLoading || contentSaving || !dirty}
            onClick={() => void saveContent()}
          >
            {contentSaving ? t("saving", "Saving…") : t("saveChanges", "Save changes")}
          </Button>
        </div>
        {contentLoading ? (
          <div className="type-label-default p-[12px] text-[var(--fx-text-tertiary)]">
            {t("loadingSkillFile", "Loading skill file…")}
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={contentSaving}
            spellCheck={false}
            aria-label={t("skillMarkdownContent", "Skill markdown content")}
            className="type-mono-code min-h-[240px] w-full flex-1 resize-y rounded-[var(--radius-card)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)] p-[12px] text-[var(--fx-text-primary)] outline-none"
          />
        )}
        {contentError && <span className="type-meta-default text-[var(--fx-status-danger)]">{contentError}</span>}
      </div>

      <div className="flex flex-col gap-[4px]">
        <span className="type-label-medium text-[var(--fx-text-secondary)]">{t("description", "Description")}</span>
        <span className="type-body-relaxed text-[var(--fx-text-secondary)]">{skill.description}</span>
      </div>
    </div>
  );
});
