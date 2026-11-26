import { useI18n } from "@/i18n";
import type { EditorStepKind } from "./editor-model";

export function useEditorStepLabels(): Record<EditorStepKind, string> {
  const { t } = useI18n();
  return {
    agent: t("autoPageEditorKindAgent", "AI step"),
    approval: t("autoPageEditorKindApproval", "Human approval"),
    http: t("autoPageEditorKindHttp", "HTTP request"),
    script: t("autoPageEditorKindScript", "Local script"),
    channel: t("autoPageEditorKindChannel", "Channel notification"),
    signal: t("autoPageEditorKindSignal", "Wait for a signal"),
    duration: t("autoPageEditorKindDuration", "Delay"),
  };
}
