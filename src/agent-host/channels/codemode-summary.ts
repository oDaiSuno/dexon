import { parseCodemodeDetails, type CodemodeNestedCall, type CodemodeToolDetails } from "../../shared/codemode";

export interface CodemodeToolState {
  readonly running: boolean;
  readonly isError: boolean;
  readonly output?: unknown;
  readonly timing?: { readonly startedAt: number; readonly endedAt?: number };
}

const VERBS = new Map([
  ["read", "读取文件"],
  ["grep", "搜索文本"],
  ["find", "查找文件"],
  ["ls", "列出文件"],
  ["bash", "执行命令"],
  ["edit", "编辑文件"],
  ["write", "写入文件"],
  ["models.classify", "分类内容"],
  ["models.generateImages", "生成图片"],
]);

function detailsOf(output: unknown): CodemodeToolDetails | null {
  try {
    if (!output || typeof output !== "object" || Array.isArray(output)) return null;
    const record = output as Record<string, unknown>;
    return (
      parseCodemodeDetails(record.details) ??
      parseCodemodeDetails(record.structuredContent) ??
      parseCodemodeDetails(record)
    );
  } catch {
    return null;
  }
}

export function retainCodemodeOutput(previous: unknown, next: unknown): unknown {
  const details = detailsOf(previous);
  if (!details || detailsOf(next)) return next;
  if (next && typeof next === "object" && !Array.isArray(next)) return { ...next, details };
  return { content: typeof next === "string" ? [{ type: "text", text: next }] : [], details };
}

function verbOf(name: string): string {
  return VERBS.get(name) ?? (name.startsWith("browser_") ? "操作浏览器" : "调用工具");
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output.slice(0, 4096);
  if (!output || typeof output !== "object") return "";
  const content = (output as Record<string, unknown>).content;
  if (!Array.isArray(content)) return "";
  return content
    .slice(0, 16)
    .map((block) => {
      if (!block || typeof block !== "object" || block.type !== "text" || typeof block.text !== "string") return "";
      return block.text.slice(0, 1024);
    })
    .join("\n");
}

function durationSeconds(state: CodemodeToolState): number | null {
  const timing = state.timing;
  if (timing?.endedAt !== undefined && Number.isFinite(timing.startedAt) && Number.isFinite(timing.endedAt)) {
    return Math.max(0, (timing.endedAt - timing.startedAt) / 1000);
  }
  const match = /^Script (?:completed|failed)\s*\nWall time (\d+(?:\.\d+)?) seconds/m.exec(outputText(state.output));
  return match ? Number(match[1]) : null;
}

function durationText(seconds: number): string {
  return seconds.toFixed(1);
}

function errorText(calls: readonly CodemodeNestedCall[], state: CodemodeToolState): string {
  const nested = calls.find((call) => call.status === "error" || call.status === "cancelled")?.error;
  const scriptError = /Script error:\s*([\s\S]*)/.exec(outputText(state.output))?.[1];
  return (nested ?? scriptError ?? "").slice(0, 1024);
}

function callError(calls: readonly CodemodeNestedCall[], state: CodemodeToolState): string {
  const error = errorText(calls, state);
  if (/SyntaxError/i.test(error)) return "脚本语法错误";
  if (/permission|forbidden|EACCES|EPERM|权限/i.test(error)) return "权限不足";
  if (/not found|ENOENT|不存在/i.test(error)) return "未找到所需资源";
  if (/abort|cancel|取消/i.test(error)) return "执行已取消";
  const failed = calls.find((call) => call.status === "error" || call.status === "cancelled");
  return failed ? `${verbOf(failed.name)}失败` : "脚本运行异常";
}

function isTimeout(calls: readonly CodemodeNestedCall[], state: CodemodeToolState): boolean {
  const error = errorText(calls, state);
  return (
    /timeout|timed out|超时|deadline/i.test(error) ||
    (state.isError && !error && calls.some((call) => call.status === "running"))
  );
}

function summarizeRunning(calls: readonly CodemodeNestedCall[]): string {
  if (calls.length === 0) return "正在运行脚本 · 准备沙箱环境…";
  const completed = calls.filter((call) => call.status !== "running").length;
  const current = calls.findLast((call) => call.status === "running") ?? calls.at(-1)!;
  return `正在运行脚本 · 已完成 ${completed} 步（当前：${verbOf(current.name)}）`;
}

export function summarizeCodemodeTool(state: CodemodeToolState): string {
  const details = detailsOf(state.output);
  const calls = details?.calls ?? [];
  if (state.running) return summarizeRunning(calls);
  if (state.isError) {
    const completed = calls.filter((call) => call.status === "ok").length;
    if (isTimeout(calls, state)) {
      const failedIndex = calls.findIndex(
        (call) => call.status === "running" || call.status === "error" || call.status === "cancelled",
      );
      const step = failedIndex >= 0 ? `，第 ${failedIndex + 1} 步${verbOf(calls[failedIndex].name)}未返回` : "";
      const duration = durationSeconds(state);
      const seconds = duration === null ? "" : `（${durationText(duration)}s）`;
      return `脚本执行超时${seconds}${seconds ? "·" : " ·"} 已完成 ${completed} 步${step}`;
    }
    return `脚本执行失败 · 已完成 ${completed} 步，${callError(calls, state)}`;
  }
  const seconds = durationSeconds(state);
  return `运行脚本完成 · 调用了 ${calls.length} 个工具${seconds === null ? "" : ` · 耗时 ${durationText(seconds)}s`}`;
}
