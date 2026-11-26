import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { AutomationAiSessionIntent } from "@/lib/automation-request";
import { clearAutomationSessionIntent, useAutomationSessionIntent } from "@/lib/automation-session-intent";
import { AutomationSnapshotDialog } from "./automation-snapshot-dialog";

export function AutomationComposerReference({
  visible,
  onFillPrompt,
}: {
  visible: boolean;
  onFillPrompt: (prompt: string, onlyIfEmpty?: boolean) => void;
}) {
  const { t } = useI18n();
  const intent = useAutomationSessionIntent();
  const [ready, setReady] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const appliedIntent = useRef<AutomationAiSessionIntent | null>(null);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!ready || !visible || !intent || intent === appliedIntent.current) return;
    appliedIntent.current = intent;
    if (intent.mode === "draft" && intent.initialPrompt?.trim()) onFillPrompt(intent.initialPrompt, true);
  }, [intent, onFillPrompt, ready, visible]);
  useEffect(() => setSnapshotOpen(false), [intent, visible]);
  if (!intent) return null;
  const isDraft = intent.mode === "draft";
  return (
    <section
      className="auto-chat-reference automation-section"
      data-mode={intent.mode}
      aria-label={t("autoChatReferenceLabel", "Attached automation context")}
    >
      <div className="auto-chat-heading-row">
        <h2 className="auto-chat-reference-title type-body-medium">
          {isDraft
            ? t("autoChatDraftReferenceTitle", "Draft an automation task")
            : intent.mode === "adjust"
              ? t("autoChatSnapshotReferenceTitle", "Workflow snapshot · {task}").replace("{task}", intent.taskName)
              : intent.taskName}
        </h2>
        <div className="auto-chat-reference-actions">
          {intent.mode === "adjust" && (
            <button
              type="button"
              className="automation-btn is-compact type-label-medium"
              onClick={() => setSnapshotOpen(true)}
            >
              {t("autoChatViewSnapshot", "View snapshot")}
            </button>
          )}
          <button type="button" className="auto-chat-remove type-label-medium" onClick={clearAutomationSessionIntent}>
            {isDraft ? t("autoChatExitDraft", "Exit draft mode") : t("autoChatRemoveReference", "Remove attachment")}
          </button>
        </div>
      </div>
      {intent.mode === "draft" ? (
        <>
          <span className="auto-chat-path type-mono-meta">{intent.cwd || "~/.dexon/automations"}</span>
          <p className="auto-chat-description type-label-default">
            {t(
              "autoChatDraftFolderDescription",
              "By default, tasks live in ~/.dexon/automations; a separate subfolder is created automatically for each task.",
            )}
          </p>
        </>
      ) : (
        <>
          <div className="auto-chat-reference-meta type-meta-default">
            {intent.revision !== undefined && (
              <span>{t("autoChatRevision", "Revision {revision}").replace("{revision}", String(intent.revision))}</span>
            )}
            {intent.mode === "modify" && (
              <span className={`automation-badge${intent.enabledRevision === null ? "" : " is-success"}`}>
                {intent.enabledRevision === null
                  ? t("autoChatTaskDisabled", "Disabled")
                  : t("autoChatEnabledRevision", "Revision {revision} enabled").replace(
                      "{revision}",
                      String(intent.enabledRevision),
                    )}
              </span>
            )}
            {intent.mode === "adjust" && intent.hasUnsavedChanges && (
              <span className="automation-badge is-warning">
                {t("autoChatUnsavedChangesBadge", "Unsaved local edits")}
              </span>
            )}
            <span>{t("autoChatHost", "Host: {host}").replace("{host}", intent.environmentLabel)}</span>
            <span className="auto-chat-path type-mono-meta">{intent.cwd}</span>
          </div>
          {intent.mode === "modify" && intent.summary && (
            <p className="auto-chat-description type-label-default">{intent.summary}</p>
          )}
        </>
      )}
      {visible && snapshotOpen && intent.mode === "adjust" && (
        <AutomationSnapshotDialog intent={intent} onClose={() => setSnapshotOpen(false)} />
      )}
    </section>
  );
}
