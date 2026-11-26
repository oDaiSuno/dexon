import type { AutomationPromptPayload } from "@shared/automation/prompt-context";
import type { AutomationAiSessionIntent } from "@/lib/automation-request";

export interface AutomationPromptContext {
  cwd: string;
  environmentLabel: string;
}

export function buildAutomationPromptPayload(
  intent: AutomationAiSessionIntent,
  context: AutomationPromptContext,
): AutomationPromptPayload {
  const environmentLabel = intent.mode === "draft" ? context.environmentLabel : intent.environmentLabel;
  const cwd = intent.cwd ?? context.cwd;
  const details = [
    "Automation task authoring context",
    `Mode: ${intent.mode}`,
    `Target environment: ${JSON.stringify(environmentLabel)}`,
    `Working directory: ${JSON.stringify(cwd)}`,
    "Use the target environment for all task inspection, validation, and draft creation.",
    "Inspect automation capabilities to obtain managedAutomationRoot. For a standalone task, use <managedAutomationRoot>/<taskId> as its working directory (normally ~/.dexon/automations/<taskId>); the application creates the managed task subfolder automatically. Do not use the shared automation root itself as a task directory.",
    "Read the automation guide, validate the complete specification, and save only an unenabled draft for user review. Do not enable a task, start a run, or overwrite user changes without the user's separate authorization.",
    "Never request, include, or expose secret values in chat, task specifications, or tool arguments. Reference secret names only; use the desktop secret configuration flow for values.",
  ];

  if (intent.mode === "draft") {
    details.push(
      "Draft a new automation task from the user's request. Confirm only missing scheduling, action, and approval decisions.",
    );
  } else if (intent.mode === "modify") {
    details.push(
      `Task ID: ${JSON.stringify(intent.taskId)}`,
      `Task name: ${JSON.stringify(intent.taskName)}`,
      `Referenced revision: ${intent.revision}`,
      `Enabled revision: ${intent.enabledRevision ?? "none"}`,
      "Inspect this existing task and its current revision first. Use the current revision for update concurrency checks, preserve unrelated behavior, and explain any changes since the referenced revision before saving a new unenabled draft.",
    );
  } else {
    details.push(
      `Task ID: ${JSON.stringify(intent.taskId ?? null)}`,
      `Task name: ${JSON.stringify(intent.taskName)}`,
      `Referenced revision: ${intent.revision ?? "new task"}`,
      `Includes unsaved local edits: ${intent.hasUnsavedChanges}`,
      `Missing secret names: ${JSON.stringify(intent.missingSecrets ?? [])}`,
      "Build on the exact draft snapshot below, including its unsaved edits. Do not replace it with the persisted revision or overwrite local edits. Inspect the existing task only to verify revision and permissions when needed; save a separate new unenabled draft for user review.",
      "Exact draft specification snapshot:",
      JSON.stringify(intent.draftSpec, null, 2),
    );
  }

  return {
    badge: {
      mode: intent.mode,
      environmentLabel,
      ...(intent.mode !== "draft"
        ? { taskId: intent.taskId, taskName: intent.taskName, revision: intent.revision }
        : {}),
      ...(intent.mode === "adjust" ? { hasUnsavedChanges: intent.hasUnsavedChanges } : {}),
    },
    hiddenContext: details.join("\n\n"),
  };
}
