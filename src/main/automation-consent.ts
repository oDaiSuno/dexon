import type { MessageBoxOptions } from "electron";
import type { EnvironmentId } from "../contract/environment";
import type { AttentionResolveRequest, TaskRevisionView } from "../shared/automation/views";

export interface AutomationTargetIdentity {
  readonly displayName: string;
  readonly environmentId: EnvironmentId;
  readonly serverEnvironmentId?: string;
}

export type AutomationSnapshot = {
  readonly target: AutomationTargetIdentity;
  readonly task: TaskRevisionView;
} & ({ readonly kind: "enable" } | { readonly kind: "resolve"; readonly request: AttentionResolveRequest });

export type ShowAutomationDialog = (options: MessageBoxOptions) => Promise<{ response: number }>;

export function singleLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "");
}

export function automationDialog(snapshot: AutomationSnapshot): MessageBoxOptions {
  const { target, task } = snapshot;
  const grant = task.requiredGrant;
  return {
    type: "warning",
    title: "Dexon Automation",
    message:
      snapshot.kind === "enable"
        ? `启用自动化任务“${singleLine(task.source.name)}”？`
        : `确认处理“${singleLine(task.source.name)}”的外部操作结果？`,
    detail: [
      `目标 ${singleLine(target.displayName)}`,
      `环境路由 ${singleLine(target.environmentId)}`,
      ...(target.serverEnvironmentId ? [`服务器身份 ${singleLine(target.serverEnvironmentId)}`] : []),
      `任务 ${singleLine(task.taskId)} · 修订 ${task.revision}`,
      `定义摘要 ${singleLine(task.planHash)}`,
      `工作目录 ${singleLine(grant.cwd)}`,
      snapshot.kind === "resolve"
        ? `处理方式 ${singleLine(snapshot.request.resolution.action)} · 步骤 ${snapshot.request.stepIndex} · 运行 ${singleLine(snapshot.request.runId)} · 版本 ${snapshot.request.expectedVersion}`
        : "任务将在目标环境无人值守执行。以下权限仅授予这一修订。",
      grant.requiresTrustedLocalExecution
        ? "包含脚本或命令。它们能够访问目标环境的文件和网络，只应批准可信代码。"
        : "不包含脚本或命令。",
      `外部域名 ${grant.httpOrigins.map(singleLine).join(", ") || "无"}`,
      ...(grant.channelTargets?.length
        ? [
            "消息渠道目标",
            ...grant.channelTargets.map((item) => `${singleLine(item.accountId)} · ${singleLine(item.peerId)}`),
          ]
        : []),
      "脚本路径与 SHA-256 指纹",
      ...grant.scripts.map((script) => `${singleLine(script.path)} · ${singleLine(script.sha256)}`),
      `密钥名称 ${grant.secrets.map(singleLine).join(", ") || "无"}`,
      "无人值守写入风险",
      ...grant.unattendedWrites.map((write) => `${singleLine(write.stepId)} · ${singleLine(write.kind)}`),
    ].join("\n"),
    buttons: ["取消", "确认"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

export async function confirmAutomation(snapshot: AutomationSnapshot, show: ShowAutomationDialog): Promise<boolean> {
  return (await show(automationDialog(snapshot))).response === 1;
}
