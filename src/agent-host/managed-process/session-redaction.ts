import type { SessionManager, SessionProjection } from "@earendil-works/pi-coding-agent";
import { isManagedProcessToolName } from "./tool-names.ts";
import { PROCESS_ERROR_CODES, type ManagedProcessErrorCode } from "../../contract/processes.ts";

type PersistedMessage = {
  role?: unknown;
  content?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  isError?: unknown;
  details?: unknown;
  [key: string]: unknown;
};

type SessionManagerLike = Partial<Pick<SessionManager, "buildSessionProjection" | "buildSessionContext">> & {
  appendMessage: (message: unknown) => string;
};

const installed = new WeakSet<object>();
const OMITTED_RESULT = "[Sensitive managed process result was not saved. Open Processes to view current state.]";
const PROCESS_ERROR_CODE_SET = new Set<string>(PROCESS_ERROR_CODES);

function safePersistedErrorCode(content: unknown): ManagedProcessErrorCode | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string") continue;
    const code = text.match(/\bPROCESS_[A-Z_]+\b/u)?.[0];
    if (code && PROCESS_ERROR_CODE_SET.has(code)) return code as ManagedProcessErrorCode;
  }
  return null;
}

function redactArguments(toolName: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const args = { ...(value as Record<string, unknown>) };
  if (toolName === "process_start") {
    if ("command" in args) args.command = "[redacted managed process command]";
    if ("cwd" in args) args.cwd = "[redacted managed process cwd]";
  }
  if (toolName === "process_write" && "text" in args) args.text = "[redacted managed process stdin]";
  if ((toolName === "process_wait" || toolName === "process_restart") && "contains" in args) {
    args.contains = "[redacted readiness text]";
  }
  if (toolName === "process_restart" && args.waitFor && typeof args.waitFor === "object") {
    const waitFor = { ...(args.waitFor as Record<string, unknown>) };
    if ("contains" in waitFor) waitFor.contains = "[redacted readiness text]";
    args.waitFor = waitFor;
  }
  return args;
}

export function redactManagedProcessPersistedMessage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const message = value as PersistedMessage;
  if (
    message.role === "toolResult" &&
    typeof message.toolName === "string" &&
    isManagedProcessToolName(message.toolName)
  ) {
    const errorCode = message.isError === true ? safePersistedErrorCode(message.content) : null;
    const projected: PersistedMessage = {
      role: "toolResult",
      toolName: message.toolName,
      content: [
        {
          type: "text",
          text: errorCode
            ? `${errorCode}: Managed process request failed. Sensitive details were not saved.`
            : OMITTED_RESULT,
        },
      ],
      isError: message.isError === true,
    };
    if (typeof message.toolCallId === "string") projected.toolCallId = message.toolCallId;
    if (errorCode) projected.errorCode = errorCode;
    return projected;
  }
  if (message.role !== "assistant" || !Array.isArray(message.content)) return value;
  let changed = false;
  const content = message.content.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return block;
    const toolCall = block as { type?: unknown; name?: unknown; arguments?: unknown };
    if (toolCall.type !== "toolCall" || typeof toolCall.name !== "string" || !isManagedProcessToolName(toolCall.name)) {
      return block;
    }
    changed = true;
    return { ...toolCall, arguments: redactArguments(toolCall.name, toolCall.arguments) };
  });
  return changed ? { ...message, content } : value;
}

export function installManagedProcessSessionRedaction(sessionManager: object): void {
  if (installed.has(sessionManager)) return;
  const manager = sessionManager as SessionManagerLike;
  const liveMessages = new Map<string, unknown>();
  const appendMessage = manager.appendMessage.bind(sessionManager);
  manager.appendMessage = (message: unknown) => {
    const redacted = redactManagedProcessPersistedMessage(message);
    const entryId = appendMessage(redacted);
    if (redacted !== message) liveMessages.set(entryId, message);
    return entryId;
  };
  if (typeof manager.buildSessionProjection === "function") {
    const buildSessionProjection = manager.buildSessionProjection.bind(sessionManager);
    manager.buildSessionProjection = (...args) => {
      const projection = buildSessionProjection(...args);
      const editedIds = new Set(
        projection.entries.flatMap(({ sourceEntry }) =>
          sourceEntry.type === "context_edit" ? [sourceEntry.targetId] : [],
        ),
      );
      const entries = projection.entries.map((entry) => {
        if (editedIds.has(entry.sourceEntry.id) || !liveMessages.has(entry.sourceEntry.id)) return entry;
        return {
          ...entry,
          messages: [liveMessages.get(entry.sourceEntry.id) as SessionProjection["messages"][number]],
        };
      });
      return { ...projection, entries, messages: entries.flatMap((entry) => entry.messages) };
    };
  }
  if (typeof manager.buildSessionContext === "function") {
    const buildSessionContext = manager.buildSessionContext.bind(sessionManager);
    manager.buildSessionContext = (...args) => {
      if (typeof manager.buildSessionProjection !== "function") return buildSessionContext(...args);
      const { messages, thinkingLevel, model } = manager.buildSessionProjection(...args);
      return { messages, thinkingLevel, model };
    };
  }
  installed.add(sessionManager);
}
