import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import type { AutomationAiSessionIntent } from "@/lib/automation-request";
import { ModelDialogShell } from "../models/model-dialog-shell";

type SnapshotIntent = Extract<AutomationAiSessionIntent, { mode: "adjust" }>;

export function AutomationSnapshotDialog({ intent, onClose }: { intent: SnapshotIntent; onClose: () => void }) {
  const { t } = useI18n();
  return createPortal(
    <ModelDialogShell
      width={720}
      elevated
      divided
      dirty={false}
      title={t("autoChatSnapshotDialogTitle", "Attached workflow snapshot")}
      subtitle={intent.taskName}
      onClose={onClose}
      footer={
        <div className="auto-chat-snapshot-footer automation-actions">
          <button type="button" className="automation-btn type-label-medium" onClick={onClose}>
            {t("autoChatCloseSnapshot", "Close snapshot")}
          </button>
        </div>
      }
    >
      <div className="auto-chat-snapshot-body">
        <p className="auto-chat-description type-body-default">
          {t(
            "autoChatSnapshotDescription",
            "This is the exact workflow snapshot attached to this conversation. Viewing it does not change or save a task revision.",
          )}
        </p>
        <pre
          className="auto-chat-snapshot-json automation-pre type-mono-body"
          tabIndex={0}
          role="region"
          aria-label={t("autoChatSnapshotJsonLabel", "Workflow snapshot JSON")}
        >
          {JSON.stringify(intent.draftSpec, null, 2)}
        </pre>
      </div>
    </ModelDialogShell>,
    document.body,
  );
}
