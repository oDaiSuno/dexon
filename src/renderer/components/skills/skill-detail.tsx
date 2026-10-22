import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { useI18n } from "@/i18n";
import { requestErrorMessage, shortenPath, sourceLabel, sourceLabelText, type Skill } from "./skill-shared";
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Path + tag + toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: "var(--text-micro)",
            padding: "1px 4px",
            borderRadius: "var(--radius-chip)",
            flexShrink: 0,
            background: label === "project" ? "rgba(99,102,241,0.12)" : "rgba(120,120,120,0.12)",
            color: label === "project" ? "rgba(99,102,241,0.8)" : "var(--fx-text-tertiary)",
          }}
        >
          {sourceLabelText(label, t)}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-meta)",
            color: "var(--fx-text-tertiary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayPath(skill.filePath)}
        </span>
        <SkillToggle enabled={enabled} loading={toggling} onToggle={() => onToggle(skill)} />
        {saveError && (
          <span style={{ fontSize: "var(--text-label)", color: "var(--fx-status-danger)", flexShrink: 0 }}>
            {saveError}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", fontWeight: 500 }}>
          {t("name", "Name")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-body-lg)",
            color: "var(--fx-text-primary)",
          }}
        >
          {skill.name}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 260 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", fontWeight: 500 }}>
            {t("skillFileName", "SKILL.md")}
          </span>
          <button
            type="button"
            onClick={() => void saveContent()}
            disabled={contentLoading || contentSaving || content === savedContent}
            style={{
              minHeight: 32,
              padding: "0 12px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--fx-line-default)",
              background: content !== savedContent ? "var(--fx-accent-blue)" : "var(--fx-surface-raised)",
              color: content !== savedContent ? "var(--fx-text-on-accent)" : "var(--fx-text-tertiary)",
              cursor: contentLoading || contentSaving || content === savedContent ? "default" : "pointer",
              fontSize: "var(--text-label)",
            }}
          >
            {contentSaving ? t("saving", "Saving…") : t("saveChanges", "Save changes")}
          </button>
        </div>
        {contentLoading ? (
          <div style={{ padding: 12, color: "var(--fx-text-tertiary)", fontSize: "var(--text-label)" }}>
            {t("loadingSkillFile", "Loading skill file…")}
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={contentSaving}
            spellCheck={false}
            aria-label={t("skillMarkdownContent", "Skill markdown content")}
            style={{
              width: "100%",
              flex: 1,
              minHeight: 240,
              resize: "vertical",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-card)",
              background: "var(--fx-surface-raised)",
              color: "var(--fx-text-primary)",
              padding: 12,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              lineHeight: 1.55,
              outline: "none",
            }}
          />
        )}
        {contentError && (
          <span style={{ fontSize: "var(--text-meta)", color: "var(--fx-status-danger)" }}>{contentError}</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", fontWeight: 500 }}>
          {t("description", "Description")}
        </span>
        <span style={{ fontSize: "var(--text-body-lg)", color: "var(--fx-text-secondary)", lineHeight: 1.6 }}>
          {skill.description}
        </span>
      </div>
    </div>
  );
});
