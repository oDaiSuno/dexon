import type { MessageBoxOptions } from "electron";
import type { AutomationConsentRequest, AutomationConsentResult } from "../shared/automation/views";

function parseRequest(value: unknown): AutomationConsentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid automation confirmation");
  const request = value as AutomationConsentRequest;
  if (
    (request.kind !== "enable" && request.kind !== "resolve") ||
    typeof request.taskId !== "string" ||
    !request.taskId ||
    !Number.isSafeInteger(request.revision) ||
    request.revision < 1 ||
    typeof request.taskName !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.planHash) ||
    request.requiredGrant?.planHash !== request.planHash
  )
    throw new Error("Invalid automation confirmation binding");
  if (
    request.kind === "resolve" &&
    (request.request?.resolution?.kind !== "attention" ||
      !["mark_succeeded", "retry", "mark_failed", "confirm_cancelled"].includes(request.request.resolution.action) ||
      typeof request.request.requestId !== "string" ||
      !request.request.requestId ||
      !Number.isSafeInteger(request.request.expectedVersion))
  )
    throw new Error("Invalid automation reconciliation request");
  return structuredClone(request);
}
export function createAutomationConsentRequestHandler(
  show: (options: MessageBoxOptions) => Promise<{ response: number }>,
) {
  return async (method: string, value: unknown): Promise<AutomationConsentResult> => {
    if (method !== "automationConsent.confirm") throw new Error("Unsupported automation confirmation request");
    const request = parseRequest(value);
    const result = await show({
      type: "warning",
      title: "Dexon Automation",
      message:
        request.kind === "enable"
          ? `启用自动化任务“${request.taskName}”？`
          : `确认处理“${request.taskName}”的外部操作结果？`,
      detail: [
        `任务 ${request.taskId} · 修订 ${request.revision}`,
        `定义摘要 ${request.planHash}`,
        request.kind === "resolve"
          ? `处理方式 ${request.request.resolution.kind === "attention" ? request.request.resolution.action : ""} · 运行 ${request.request.runId} · 版本 ${request.request.expectedVersion}`
          : "任务将在本机无人值守执行。以下权限仅授予这一修订。",
        request.requiredGrant.requiresTrustedLocalExecution
          ? "包含本地脚本或命令。它们能够访问当前用户的本地文件和网络，只应批准可信代码。"
          : "不包含本地脚本或命令。",
        "授权清单",
        JSON.stringify(request.requiredGrant, null, 2),
      ].join("\n\n"),
      buttons: ["取消", "确认"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return {
      confirmed: result.response === 1,
      taskId: request.taskId,
      revision: request.revision,
      planHash: request.planHash,
      requestId: request.kind === "resolve" ? request.request.requestId : null,
    };
  };
}
