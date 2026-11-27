export const enUS: Record<string, string> = {
  autoChatAdjustFooterHint:
    "If the target remote host is offline, reconnect first before asking AI to modify; new unsaved tasks default to Local when no remote host is chosen.",
  autoChatAdjustMetaSummary:
    "Based on local editor snapshot · {steps} steps · AI will refine and validate from this snapshot",
  autoChatAdjustMissingSecrets: "Missing secrets: {names}",
  autoChatAdjustWelcomeTitle: "Ask AI to keep refining the current workflow",
  autoChatAttentionOutputLabel: "Optional step output JSON (for downstream steps)",
  autoChatAttentionOutputPlaceholder: '{"ok": true}',
  autoChatBackToOverview: "Automation overview",
  autoChatBackToRun: "Back to run {run}",
  autoChatCloseSnapshot: "Close snapshot",
  autoChatDraftFolderHint:
    "Default space: ~/.dexon/automations · Standalone tasks get their own subfolder automatically; you can also switch project or host below",
  autoChatDraftFooterHint:
    "After sending, this conversation is saved under Automation space so you can return anytime · Jump straight back to Automation once AI saves a draft",
  autoChatDraftReferenceTitle: "Draft an automation task",
  autoChatDraftWelcomeDescription:
    "Describe the trigger, steps, and approval boundaries in natural language. AI will validate and save a disabled draft first; you review it and make the final decision.",
  autoChatDraftWelcomeTitle: "Describe what you want to automate in the background",
  autoChatEnabledRevision: "Revision {revision} enabled",
  autoChatEnvironmentMismatch: "Switch to the task's environment before sending this request.",
  autoChatEnvironmentSwitched: "Environment switched",
  autoChatExitDraft: "Exit draft mode",
  autoChatInvalidContext: "The automation reference is too large or invalid. Remove it and try again.",
  autoChatLocalHost: "Local",
  autoChatModifyMetaHint: "Task reference is attached automatically when sent; AI will inspect the full definition.",
  autoChatModifyWelcomeTitle: "Tell AI how you want to change this task",
  autoChatOpenInAutomation: "Open in Automations",
  autoChatPillAdjust: "Adjust draft snapshot: {task}",
  autoChatPillDraft: "Automation task draft",
  autoChatPillModify: "Modify task: {task}",
  autoChatPillUnsaved: "Includes unsaved changes",
  autoChatReferenceLabel: "Attached automation context",
  autoChatRemoveReference: "Remove attachment",
  autoChatRevision: "Revision {revision}",
  autoChatRunLabel: "Run",
  autoChatSealedBadge: "Sealed",
  autoChatSealedDescription:
    "You can view AI thinking and tool calls here. This run record is read-only, so the message composer is hidden.",
  autoChatSealedTitle: "Automation run record · Read-only",
  autoChatSnapshotDescription:
    "This is the exact workflow snapshot attached to this conversation. Viewing it does not change or save a task revision.",
  autoChatSnapshotDialogTitle: "Attached workflow snapshot",
  autoChatSnapshotJsonLabel: "Workflow snapshot JSON",
  autoChatSnapshotReferenceTitle: "Workflow snapshot · {task}",
  autoChatStarterDraftAuditPrompt:
    "Audit dependencies and configuration risks every week, and send me a report on Friday afternoon. Summarize changes and recommendations without automatically applying fixes.",
  autoChatStarterDraftAuditTitle: "Recurring audit and weekly report",
  autoChatStarterDraftHealthPrompt:
    "Check service health every 15 minutes and notify me of anomalies. Propose recovery steps, but require my approval before restarting a service or making changes.",
  autoChatStarterDraftHealthTitle: "Health monitoring with approval",
  autoChatStarterDraftLabel: "Try starting with one sentence (click to fill the input)",
  autoChatStarterDraftSchedulePrompt:
    "Every weekday at 09:00, inspect the project's recent changes and errors, then send me a concise notification. Report findings only; do not modify files.",
  autoChatStarterDraftScheduleTitle: "Scheduled inspection and notification",
  autoChatStarterModifyFailuresPrompt:
    "Review this task's recent failed runs and explain the likely causes. Suggest the smallest safe fix and save any proposed changes as a new disabled draft for my review.",
  autoChatStarterModifyFailuresTitle: "Diagnose recent failures",
  autoChatStarterModifyLabel: "Common modification prompts",
  autoChatStarterModifySchedulePrompt:
    "Change this task to run at 09:00 every weekday. Check the time zone and explain how the new schedule differs, then save a new disabled draft for my review.",
  autoChatStarterModifyScheduleTitle: "Change the schedule",
  autoChatStarterModifySkipPrompt:
    "Skip this task when there are no new changes since its last successful run. Keep the current approval boundaries and save a new disabled draft for my review.",
  autoChatStarterModifySkipTitle: "Add a skip condition",
  autoChatStepLabel: "Step",
  autoChatTaskDisabled: "Disabled",
  autoChatTaskLabel: "Task",
  autoChatUnsavedChangesBadge: "Unsaved local edits",
  autoChatUnsavedSnapshotNotice:
    "A snapshot of unsaved local workflow edits is attached. It will not overwrite the existing revision; any new AI draft takes effect only after your review.",
  autoChatViewSnapshot: "View snapshot",
};

export const zhCN: Record<string, string> = {
  autoChatAdjustFooterHint:
    "若目标远端服务器当前离线，请先重连再让 AI 修改；新建未保存任务若未指定远端则默认在本机起草。",
  autoChatAdjustMetaSummary: "基于本地编排副本 · {steps} 个步骤 · 发送后 AI 将直接基于这份快照继续修改并校验",
  autoChatAdjustMissingSecrets: "缺少密钥 {names}",
  autoChatAdjustWelcomeTitle: "基于当前编排内容让 AI 继续调整",
  autoChatAttentionOutputLabel: "可选：补填本步骤产出结果 JSON（供后续步骤引用）",
  autoChatAttentionOutputPlaceholder: '{"ok": true}',
  autoChatBackToOverview: "自动化总览",
  autoChatBackToRun: "返回运行 {run}",
  autoChatCloseSnapshot: "关闭快照",
  autoChatDraftFolderHint:
    "默认落在自动化任务空间（~/.dexon/automations）· 独立任务保存时自动建专属子目录，也可在下方切换项目或服务器",
  autoChatDraftFooterHint:
    "发送后本次对话将自动保存在左侧「自动化任务空间」，随时可找回 · AI 落盘草稿后可一键跳回自动化页",
  autoChatDraftReferenceTitle: "自动化任务起草",
  autoChatDraftWelcomeDescription:
    "用自然语言说明触发时机、处理步骤与审批边界；AI 会先校验并保存为未启用草稿，由你审查后拍板。",
  autoChatDraftWelcomeTitle: "描述你想交给后台自动做的事",
  autoChatEnabledRevision: "已启用 v{revision}",
  autoChatEnvironmentMismatch: "请先切换到任务归属环境，再发送这条请求。",
  autoChatEnvironmentSwitched: "已切换至任务归属环境",
  autoChatExitDraft: "退出起草",
  autoChatInvalidContext: "自动化引用过大或无效，请移除引用后重试。",
  autoChatLocalHost: "本机",
  autoChatModifyMetaHint: "发送时自动附带任务标识，AI 将读取完整定义",
  autoChatModifyWelcomeTitle: "告诉 AI 你想怎么修改这个任务",
  autoChatOpenInAutomation: "在自动化页打开",
  autoChatPillAdjust: "调整草稿快照：{task}",
  autoChatPillDraft: "自动化任务起草",
  autoChatPillModify: "修改任务：{task}",
  autoChatPillUnsaved: "含未保存改动",
  autoChatReferenceLabel: "已附带自动化上下文",
  autoChatRemoveReference: "移除引用",
  autoChatRevision: "修订 v{revision}",
  autoChatRunLabel: "运行",
  autoChatSealedBadge: "只读封存",
  autoChatSealedDescription: "你可以完整回看本次 AI 思考与工具调用；该运行记录已封存，底部输入框已隐藏。",
  autoChatSealedTitle: "自动化运行记录，不可续聊",
  autoChatSnapshotDescription: "这是随本次对话附带的本地编排快照，仅用于查看，不会修改或保存任务修订。",
  autoChatSnapshotDialogTitle: "已附带的工作流草稿快照",
  autoChatSnapshotJsonLabel: "草稿快照 JSON",
  autoChatSnapshotReferenceTitle: "草稿快照 · {task}",
  autoChatStarterDraftAuditPrompt: "每周审计一次依赖与配置风险，周五下午发送周报汇总变化与升级建议，不要自动修改代码。",
  autoChatStarterDraftAuditTitle: "周期审计 + 周报",
  autoChatStarterDraftHealthPrompt:
    "每 15 分钟检查一次服务健康状态，发现异常立即通知我并给出排查建议；重启服务或执行改动前必须等我审批。",
  autoChatStarterDraftHealthTitle: "健康监控 + 审批",
  autoChatStarterDraftLabel: "试试一句话开始起草（点击自动填入输入框）",
  autoChatStarterDraftSchedulePrompt:
    "每天工作日 09:00 巡检项目近 24 小时改动与异常日志，并给我发一条简明摘要，只报告问题不修改文件。",
  autoChatStarterDraftScheduleTitle: "定时巡检 + 通知",
  autoChatStarterModifyFailuresPrompt:
    "查看这个任务最近几次失败的运行记录并说明可能原因，给出最小安全修复方案并保存为新的未启用草稿供我审查。",
  autoChatStarterModifyFailuresTitle: "排查最近运行失败",
  autoChatStarterModifyLabel: "常用修改指令",
  autoChatStarterModifySchedulePrompt:
    "把定时计划改为工作日 09:00，核对时区并说明和当前计划的差异，然后保存为新的未启用草稿供我审查。",
  autoChatStarterModifyScheduleTitle: "调整定时计划",
  autoChatStarterModifySkipPrompt:
    "如果距离上次成功运行没有新的改动就跳过执行，保留现有审批边界，并保存为新的未启用草稿供我审查。",
  autoChatStarterModifySkipTitle: "添加跳过条件",
  autoChatStepLabel: "步骤",
  autoChatTaskDisabled: "已停用",
  autoChatTaskLabel: "任务",
  autoChatUnsavedChangesBadge: "含未保存改动",
  autoChatUnsavedSnapshotNotice:
    "已附带编排页未保存的本地改动快照，不会覆盖现有修订，AI 生成的新草稿需你审查后才生效。",
  autoChatViewSnapshot: "查看快照",
};
