import { isAbsoluteLocalFilePath, normalizeLocalFilePath } from "@shared/file-url";
import { parseCodemodeDetails, type CodemodeNestedCall, type CodemodeToolDetails } from "@shared/codemode";
import type { LiveToolUpdate } from "@/hooks/agent-session/shared";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";

export type CodemodeLifecycle = "starting" | "running" | "done" | "error" | "cancelled";

export type CodemodeStep = {
  call: CodemodeNestedCall;
  verb: string;
  target: string;
  filePath?: string;
  tabId?: string;
  widthRatio: number;
};

type Translate = (key: string, fallback: string) => string;
type Counts = { ok: number; error: number; cancelled: number; running: number };
type DetailImage = { src: string; mimeType: string };
type DetailError = { title: string; detail: string; step?: CodemodeStep; stepNumber?: number };

const SCRIPT_HEADER =
  /^Script (completed|failed)\b[^\r\n]*(?:\r?\n|$)(?:Wall time[^\r\n]*(?:\r?\n|$))?(?:Output:\r?\n)?/;

export function codemodeToolDetail({
  block,
  result,
  liveUpdate,
  cwd,
  t,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  liveUpdate?: LiveToolUpdate;
  cwd?: string;
  t: (key: string, fallback: string) => string;
}): {
  code: string;
  lineCount: number;
  details: CodemodeToolDetails;
  steps: CodemodeStep[];
  images: { src: string; mimeType: string }[];
  output: string;
  errorTitle: string;
  errorDetail: string;
  errorStepId?: string;
  lifecycle: CodemodeLifecycle;
  counts: { ok: number; error: number; cancelled: number; running: number };
  totalCost: number;
  summary: string;
} {
  const source: unknown = result ?? liveUpdate?.partialResult;
  const payload = recordOf(source);
  const content = contentOf(payload?.content ?? (typeof source === "string" && !payload ? source : undefined));
  const firstText = content.map(recordOf).find((item) => item?.type === "text");
  const header =
    firstText?.type === "text" && typeof firstText.text === "string" ? firstText.text.match(SCRIPT_HEADER) : null;
  const failed =
    (result !== undefined ? result.isError === true : liveUpdate?.isError === true || payload?.isError === true) ||
    header?.[1] === "failed";
  const final =
    result !== undefined || (typeof liveUpdate?.endedAt === "number" && Number.isFinite(liveUpdate.endedAt));
  const text = outputText(content, header?.[0]);
  const split = splitOutput(text, failed);
  const parsedDetails = detailsOf(payload);
  const errorDetail =
    split.errorDetail || (failed ? (parsedDetails.calls.find((call) => call.error)?.error ?? "") : "");
  const images = content.flatMap((item) => {
    const image = imageOf(item);
    return image ? [image] : [];
  });
  const cancelled =
    isCancellation(errorDetail) ||
    (!failed && parsedDetails.calls.some((call) => call.status === "cancelled" || call.status === "running"));
  const lifecycle: CodemodeLifecycle = final
    ? cancelled
      ? "cancelled"
      : failed
        ? "error"
        : "done"
    : parsedDetails.calls.length > 0 || text.length > 0 || images.length > 0
      ? "running"
      : "starting";
  const details: CodemodeToolDetails = {
    ...parsedDetails,
    calls: parsedDetails.calls.map((call): CodemodeNestedCall =>
      final && call.status === "running"
        ? { ...call, status: lifecycle === "error" && call.error ? "error" : "cancelled" }
        : call,
    ),
  };
  const counts: Counts = { ok: 0, error: 0, cancelled: 0, running: 0 };
  let totalCost = 0;
  let maxDuration = 0;
  for (const call of details.calls) {
    counts[call.status] += 1;
    totalCost += call.cost ?? 0;
    maxDuration = Math.max(maxDuration, call.durationMs ?? 0);
  }
  const steps = details.calls.map((call) => stepOf(call, maxDuration, cwd, t));
  const errorTitle =
    lifecycle === "cancelled"
      ? t("codemodeCancelled", "Cancelled")
      : lifecycle === "error"
        ? isTimeout(errorDetail)
          ? t("codemodeTimeout", "Script timed out")
          : t("codemodeFailed", "Failed")
        : "";
  const errorStep = failed
    ? (steps.find((step) => step.call.status === "error" && step.call.error && errorDetail.includes(step.call.error)) ??
      steps.find((step) => step.call.status === "error"))
    : undefined;
  const input = recordOf(block.input);
  const runtimeArguments = recordOf((block as ToolCallContent & { arguments?: unknown }).arguments);
  const code =
    typeof input?.code === "string"
      ? input.code
      : typeof runtimeArguments?.code === "string"
        ? runtimeArguments.code
        : "";
  return {
    code,
    lineCount: code ? code.split(/\r\n|\r|\n/).length : 0,
    details,
    steps,
    images,
    output: split.output,
    errorTitle,
    errorDetail,
    ...(errorStep ? { errorStepId: errorStep.call.id } : {}),
    lifecycle,
    counts,
    totalCost,
    summary: summaryOf(
      lifecycle,
      steps,
      counts,
      images.length,
      {
        title: errorTitle,
        detail: errorDetail,
        step: errorStep,
        stepNumber: errorStep ? steps.indexOf(errorStep) + 1 : undefined,
      },
      t,
    ),
  };
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function detailsOf(payload: Record<string, unknown> | null): CodemodeToolDetails {
  const details = recordOf(payload?.details) ?? payload;
  const parsed = parseCodemodeDetails(details);
  if (parsed) return parsed;
  const fullOutputPath = details?.fullOutputPath;
  return typeof fullOutputPath === "string" && fullOutputPath.trim() ? { calls: [], fullOutputPath } : { calls: [] };
}

function contentOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : typeof value === "string" ? [{ type: "text", text: value }] : [];
}

function outputText(content: unknown[], header: string | undefined): string {
  const texts: string[] = [];
  let first = true;
  for (const item of content) {
    const block = recordOf(item);
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    const stripped = first && header;
    const text = stripped ? block.text.slice(stripped.length) : block.text;
    first = false;
    if (stripped && !text) continue;
    texts.push(text);
  }
  return texts.join("\n");
}

function splitOutput(text: string, failed: boolean): { output: string; errorDetail: string } {
  if (!failed) return { output: text, errorDetail: "" };
  const matches = [...text.matchAll(/(?:^|\r?\n)Script error:\r?\n/g)];
  const marker = matches[matches.length - 1];
  if (!marker) return { output: "", errorDetail: text };
  const index = marker.index ?? 0;
  return { output: text.slice(0, index), errorDetail: text.slice(index + marker[0].length) };
}

function firstErrorLine(error: string): string {
  return error.trimStart().split(/\r?\n/, 1)[0] ?? "";
}

function isCancellation(error: string): boolean {
  return /^(?:AbortError\b|(?:Error:\s*)?(?:(?:Script|Execution|Operation|Request)\s+(?:was\s+)?)?(?:aborted|cancelled|canceled)\b)/i.test(
    firstErrorLine(error),
  );
}

function isTimeout(error: string): boolean {
  return /^(?:TimeoutError\b|(?:Error:\s*)?(?:(?:Script|Execution|Operation|Request)\s+)?(?:timed?\s*out|timeout)\b)/i.test(
    firstErrorLine(error),
  );
}

function imageOf(value: unknown): DetailImage | null {
  const block = recordOf(value);
  if (block?.type !== "image" || block.deferredContent) return null;
  const source = recordOf(block.source);
  const mimeType =
    typeof source?.media_type === "string"
      ? source.media_type
      : typeof block.mimeType === "string"
        ? block.mimeType
        : "image/png";
  if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) return null;
  if (
    source?.type === "url" &&
    typeof source.url === "string" &&
    /^(?:https?:\/\/|data:image\/|blob:)/i.test(source.url)
  ) {
    return { src: source.url, mimeType };
  }
  const data = typeof source?.data === "string" ? source.data : typeof block.data === "string" ? block.data : "";
  return data ? { src: `data:${mimeType};base64,${data}`, mimeType } : null;
}

function argumentText(args: Record<string, unknown> | null, raw: string, keys: string[]): string {
  for (const key of keys) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim()) return value;
    if (args) continue;
    const match = raw.match(new RegExp(`(?:^\\s*\\{|,)\\s*"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`));
    if (!match) continue;
    try {
      const parsed: unknown = JSON.parse(match[1]);
      if (typeof parsed === "string" && parsed.trim()) return parsed;
    } catch {
      continue;
    }
  }
  return "";
}

function stepOf(call: CodemodeNestedCall, maxDuration: number, cwd: string | undefined, t: Translate): CodemodeStep {
  const args = recordOf(call.args);
  const path = argumentText(args, call.args, ["path", "file_path", "filePath"]);
  const fileTool = ["read", "grep", "find", "ls", "edit", "write"].includes(call.name);
  const filePath = ["read", "edit", "write"].includes(call.name) && path ? resolveNestedFilePath(path, cwd) : null;
  const browser = call.name.startsWith("browser_");
  const tabId = browser ? argumentText(args, call.args, ["tabId", "tab_id"]) : "";
  const target = fileTool
    ? ["grep", "find"].includes(call.name)
      ? [argumentText(args, call.args, ["pattern", "query", "glob"]), path].filter(Boolean).join(" · ")
      : path || (call.name === "ls" ? t("codemodeCurrentDirectory", "Current directory") : call.args)
    : call.name === "bash"
      ? argumentText(args, call.args, ["command"]) || call.args
      : browser
        ? argumentText(args, call.args, ["url", "selector", "text", "query"]) ||
          (tabId ? t("codemodeTab", "Tab {tabId}").replace("{tabId}", tabId) : call.args)
        : argumentText(args, call.args, ["model", "modelId", "prompt", "text", "query", "input", "label"]) || call.args;
  return {
    call,
    verb: verbOf(call.name, t),
    target: (target || call.name).replace(/\s+/g, " ").slice(0, 120),
    ...(filePath ? { filePath } : {}),
    ...(tabId ? { tabId } : {}),
    widthRatio: maxDuration > 0 ? (call.durationMs ?? 0) / maxDuration : 0,
  };
}

function resolveNestedFilePath(path: string, cwd?: string): string | null {
  if (!path || path.startsWith("~")) return null;
  if (isAbsoluteLocalFilePath(path)) return normalizeLocalFilePath(path);
  if (!cwd) return null;
  const root = normalizeLocalFilePath(cwd);
  return root ? normalizeLocalFilePath(`${root}/${path}`) : null;
}

function verbOf(name: string, t: Translate): string {
  switch (name) {
    case "read":
      return t("codemodeRead", "Read");
    case "grep":
      return t("codemodeGrep", "Search");
    case "find":
      return t("codemodeFind", "Find");
    case "ls":
      return t("codemodeLs", "List");
    case "bash":
      return t("codemodeBash", "Terminal");
    case "edit":
      return t("codemodeEdit", "Edit");
    case "write":
      return t("codemodeWrite", "Write");
    case "models.classify":
      return t("codemodeClassify", "Model classification");
    case "models.generateImages":
      return t("codemodeGenerateImages", "Generate images");
    default:
      return name.startsWith("browser_") ? t("codemodeBrowse", "Browser") : t("codemodeCall", "Call tool");
  }
}

function stepAction(step: CodemodeStep): string {
  return `${step.verb} ${step.target}`;
}

function errorSummaryOf(error: DetailError, t: Translate): string {
  const firstLine = firstErrorLine(error.detail);
  if (!firstLine) return error.title;
  if (!isTimeout(firstLine)) return firstLine;
  const duration = firstLine.match(/\b(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s)\b/i);
  if (!duration) return firstLine;
  const seconds = Number(duration[1]) / (/^(?:ms|milliseconds?)$/i.test(duration[2]) ? 1000 : 1);
  const summary = t("codemodeTimeoutSummary", "Timed out after {seconds}s").replace("{seconds}", String(seconds));
  return error.step && error.stepNumber
    ? `${summary} · ${t("codemodeTimeoutStep", "Step {number} · {action} did not return").replace("{number}", String(error.stepNumber)).replace("{action}", error.step.verb)}`
    : summary;
}

function summaryOf(
  lifecycle: CodemodeLifecycle,
  steps: CodemodeStep[],
  counts: Counts,
  imageCount: number,
  error: DetailError,
  t: Translate,
): string {
  if (lifecycle === "starting") return t("codemodeStarting", "Preparing sandbox…");
  if (lifecycle === "error") return errorSummaryOf(error, t);
  if (lifecycle === "cancelled") {
    return steps.length > 0
      ? t("codemodeCancelledSummary", "{ok} completed · {cancelled} cancelled")
          .replace("{ok}", String(counts.ok))
          .replace("{cancelled}", String(counts.cancelled))
      : t("codemodeStopped", "Stopped script");
  }
  if (lifecycle === "running") {
    const activeStep = steps.findLast((step) => step.call.status === "running");
    const action = activeStep ? stepAction(activeStep) : t("codemodeRun", "Run script");
    return t("codemodeRunningSummary", "Running: {action} · {count} steps completed")
      .replace("{action}", action)
      .replace("{count}", String(counts.ok));
  }
  const summary = t("codemodeDoneSummary", "{count} steps").replace("{count}", String(steps.length));
  return imageCount > 0
    ? `${summary} · ${t("codemodeImageSummary", "{count} images").replace("{count}", String(imageCount))}`
    : summary;
}
