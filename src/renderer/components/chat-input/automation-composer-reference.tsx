import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { useActiveEnvironment } from "@/lib/environment-registry";
import type { AutomationAiSessionIntent } from "@/lib/automation-request";
import { clearAutomationSessionIntent, useAutomationSessionIntent } from "@/lib/automation-session-intent";
import { AutomationSnapshotDialog } from "./automation-snapshot-dialog";

function HostBadge({ isLocal, label }: { isLocal: boolean; label: string }) {
  return (
    <span className="auto-chat-host-chip type-mono-meta">
      {isLocal ? (
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M2 20h20" />
        </svg>
      ) : (
        <span className="auto-chat-host-dot" aria-hidden="true" />
      )}
      <span>{label}</span>
    </span>
  );
}

export function AutomationComposerReference({
  visible,
  onFillPrompt,
}: {
  visible: boolean;
  onFillPrompt: (prompt: string, onlyIfEmpty?: boolean) => void;
}) {
  const { t } = useI18n();
  const activeEnvironment = useActiveEnvironment();
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

  if (intent.mode === "draft") {
    const isLocal = activeEnvironment.id === "primary";
    const hostLabel = isLocal ? t("autoChatLocalHost", "Local") : activeEnvironment.label;
    return (
      <section
        className="auto-chat-reference"
        data-mode="draft"
        aria-label={t("autoChatReferenceLabel", "Attached automation context")}
      >
        <div className="auto-chat-draft-left">
          <span className="auto-chat-draft-badge type-label-medium">
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
              <path d="M20 2v4M18 4h4" />
            </svg>
            {t("autoChatDraftReferenceTitle", "Draft an automation task")}
          </span>
          <p className="auto-chat-draft-copy type-meta-default">
            {t(
              "autoChatDraftFolderHint",
              "Default space: ~/.dexon/automations · Standalone tasks get their own subfolder automatically; you can also switch project or host below",
            )}
          </p>
        </div>
        <div className="auto-chat-reference-actions">
          <HostBadge isLocal={isLocal} label={hostLabel} />
          <button type="button" className="auto-chat-remove type-meta-micro" onClick={clearAutomationSessionIntent}>
            {t("autoChatExitDraft", "Exit draft mode")} ×
          </button>
        </div>
      </section>
    );
  }

  const isLocal = intent.environmentId === "primary";
  const hostLabel = isLocal ? t("autoChatLocalHost", "Local") : intent.environmentLabel;

  return (
    <section
      className="auto-chat-reference"
      data-mode={intent.mode}
      aria-label={t("autoChatReferenceLabel", "Attached automation context")}
    >
      <div className="auto-chat-heading-row">
        <div className="auto-chat-reference-lead">
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />
          </svg>
          <h2 className="auto-chat-reference-title type-label-medium">
            {intent.mode === "adjust"
              ? t("autoChatSnapshotReferenceTitle", "Workflow snapshot · {task}").replace("{task}", intent.taskName)
              : t("autoChatPillModify", "Modify task: {task}").replace("{task}", intent.taskName)}
          </h2>
          {intent.mode === "modify" && (
            <span
              className={`automation-badge type-meta-micro${intent.enabledRevision === null ? " is-warning" : " is-success"}`}
            >
              {intent.enabledRevision === null
                ? `${t("autoChatRevision", "Revision {revision}").replace("{revision}", String(intent.revision))} · ${t("autoChatTaskDisabled", "Disabled")}`
                : t("autoChatEnabledRevision", "Revision {revision} enabled").replace(
                    "{revision}",
                    String(intent.enabledRevision),
                  )}
            </span>
          )}
          {intent.mode === "adjust" && intent.hasUnsavedChanges && (
            <span className="automation-badge is-warning type-meta-micro">
              {t("autoChatUnsavedChangesBadge", "Unsaved local edits")}
            </span>
          )}
          <HostBadge isLocal={isLocal} label={hostLabel} />
        </div>
        <div className="auto-chat-reference-actions">
          {intent.mode === "adjust" && (
            <button
              type="button"
              className="auto-chat-snapshot-btn type-meta-micro"
              onClick={() => setSnapshotOpen(true)}
            >
              {t("autoChatViewSnapshot", "View snapshot")}
            </button>
          )}
          <button type="button" className="auto-chat-remove type-meta-micro" onClick={clearAutomationSessionIntent}>
            {t("autoChatRemoveReference", "Remove attachment")} ×
          </button>
        </div>
      </div>
      {intent.mode === "modify" ? (
        <p className="auto-chat-description type-meta-default">
          {intent.summary
            ? `${intent.summary} · ${t("autoChatModifyMetaHint", "Task reference is attached automatically when sent; AI will inspect the full definition.")}`
            : t(
                "autoChatModifyMetaHint",
                "Task reference is attached automatically when sent; AI will inspect the full definition.",
              )}
        </p>
      ) : (
        <p className="auto-chat-description type-meta-default">
          {t(
            "autoChatAdjustMetaSummary",
            "Based on local editor snapshot · {steps} steps · AI will refine and validate from this snapshot",
          ).replace("{steps}", String(intent.draftSpec.steps.length))}
          {intent.missingSecrets && intent.missingSecrets.length > 0
            ? ` · ${t("autoChatAdjustMissingSecrets", "Missing secrets: {names}").replace("{names}", intent.missingSecrets.join(", "))}`
            : ""}
        </p>
      )}
      {visible && snapshotOpen && intent.mode === "adjust" && (
        <AutomationSnapshotDialog intent={intent} onClose={() => setSnapshotOpen(false)} />
      )}
    </section>
  );
}
