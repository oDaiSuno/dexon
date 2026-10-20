import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  SESSION_ORCHESTRATION_LIMITS,
  SESSION_THINKING_LEVELS,
  type SessionToolTargetDetails,
} from "../../shared/session-orchestration";
import { getBrowserSessionSource } from "../browser-tools";
import { getSessionOrchestrationService, SessionOrchestrationError, type SessionWaitResult } from "./service";
import { getSessionOrchestrationSettings } from "./settings";

type ToolContext = { sessionManager: { getSessionId(): string } };

const sessionId = Type.String({ minLength: 1, maxLength: 128, description: "Target session id from session_list" });
const message = Type.String({
  minLength: 1,
  maxLength: SESSION_ORCHESTRATION_LIMITS.messageMaxChars,
  description: "Message the other session receives as its next user turn",
});
const timeoutMs = Type.Optional(
  Type.Integer({
    minimum: 0,
    maximum: SESSION_ORCHESTRATION_LIMITS.waitMaxMs,
    description: "How long to wait before reporting a timeout; a timeout never stops the other session",
  }),
);
const thinkingLevel = Type.Optional(
  Type.Union(
    SESSION_THINKING_LEVELS.map((level) => Type.Literal(level)),
    { description: "Reasoning effort for the created session" },
  ),
);
const model = Type.Optional(
  Type.Object({
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
  }),
);

function text(value: unknown, details?: SessionToolTargetDetails) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details };
}

function toolError(error: unknown): never {
  if (error instanceof SessionOrchestrationError) throw new Error(error.message);
  throw error;
}

function owner(ctx: ToolContext): string {
  return ctx.sessionManager.getSessionId();
}

function assertEnabled(): void {
  if (!getSessionOrchestrationSettings().enabled) {
    throw new SessionOrchestrationError("Enable Session collaboration in Settings first");
  }
}

function assertLocalTurn(ctx: ToolContext): void {
  if (getBrowserSessionSource(ctx.sessionManager) === "channel") {
    throw new SessionOrchestrationError("Session tools are unavailable for messaging-channel turns");
  }
}

function enter(ctx: ToolContext): string {
  assertEnabled();
  assertLocalTurn(ctx);
  return owner(ctx);
}

function waitResultPayload(wait: SessionWaitResult): Record<string, unknown> {
  return {
    status: wait.status,
    stillRunning: wait.stillRunning,
    ...(wait.lastReply ? { lastReply: wait.lastReply } : {}),
    ...(wait.error ? { error: wait.error } : {}),
  };
}

export function createSessionOrchestrationToolDefinitions(): ToolDefinition[] {
  return [
    defineTool({
      name: "session_new",
      label: "start a collaborating session",
      description:
        "Create another session in the same project and hand it a first task. It appears in the sidebar under this session and keeps working independently. Only use it for work that can proceed in parallel; use cwd only for a worktree of this repository.",
      promptSnippet: "session_new: start a collaborating session with its first task",
      parameters: Type.Object({
        message,
        cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
        name: Type.Optional(Type.String({ minLength: 1, maxLength: SESSION_ORCHESTRATION_LIMITS.nameMaxChars })),
        model,
        thinkingLevel,
        wait: Type.Optional(Type.Boolean({ description: "Wait for the created session's first turn to settle" })),
        timeoutMs,
      }),
      executionMode: "sequential",
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          const created = await service.create(enter(ctx), input as never);
          return text(
            {
              sessionId: created.sessionId,
              ...(created.name ? { name: created.name } : {}),
              status: created.status,
              ...(created.wait ? waitResultPayload(created.wait) : {}),
            },
            { targetSessionId: created.sessionId, ...(created.name ? { targetTitle: created.name } : {}) },
          );
        } catch (error) {
          return toolError(error);
        }
      },
    }),
    defineTool({
      name: "session_prompt",
      label: "send a task to another session",
      description:
        "Queue another message for a session. If the target is busy the message waits until its current turn finishes; the running turn is never interrupted. With wait it returns the reply of the turn this message caused.",
      promptSnippet: "session_prompt: hand another task to a session without interrupting it",
      parameters: Type.Object({ sessionId, message, wait: Type.Optional(Type.Boolean()), timeoutMs }),
      executionMode: "sequential",
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          const result = await service.prompt(enter(ctx), input as never);
          return text(
            {
              sessionId: result.sessionId,
              status: result.status,
              ...(result.wait ? waitResultPayload(result.wait) : {}),
            },
            { targetSessionId: result.sessionId },
          );
        } catch (error) {
          return toolError(error);
        }
      },
    }),
    defineTool({
      name: "session_wait",
      label: "wait for another session",
      description:
        "Wait until a session becomes idle, fails, or asks the user a question. A timeout is not a failure: the session keeps working and the result says so.",
      promptSnippet: "session_wait: wait for a session to finish before reading its result",
      parameters: Type.Object({ sessionId, timeoutMs }),
      executionMode: "sequential",
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          enter(ctx);
          const result = await service.wait(input.sessionId, input.timeoutMs);
          return text(
            { sessionId: input.sessionId, ...waitResultPayload(result) },
            { targetSessionId: input.sessionId },
          );
        } catch (error) {
          return toolError(error);
        }
      },
    }),
    defineTool({
      name: "session_list",
      label: "list sessions",
      description:
        "List sessions with their live status and the session that created them. scope project is the default; use all to look beyond the current project.",
      parameters: Type.Object({
        scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("all")])),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_ORCHESTRATION_LIMITS.listMax })),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          return text(await service.list(enter(ctx), input as never));
        } catch (error) {
          return toolError(error);
        }
      },
    }),
    defineTool({
      name: "session_read",
      label: "read another session",
      description:
        "Read the last reply of a session plus a summary of its recent tool calls, bounded by maxChars. Use it instead of asking the user to paste results.",
      promptSnippet: "session_read: read another session's last reply and recent tool calls",
      parameters: Type.Object({
        sessionId,
        maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_ORCHESTRATION_LIMITS.readMaxChars })),
        toolCalls: Type.Optional(Type.Integer({ minimum: 0, maximum: SESSION_ORCHESTRATION_LIMITS.readToolCallsMax })),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          enter(ctx);
          const view = await service.read(input.sessionId, input);
          return text(view, { targetSessionId: input.sessionId, ...(view.title ? { targetTitle: view.title } : {}) });
        } catch (error) {
          return toolError(error);
        }
      },
    }),
    defineTool({
      name: "session_stop",
      label: "stop another session's turn",
      description:
        "Stop the current turn of a session this session created. The session stays open so it can be prompted again.",
      parameters: Type.Object({ sessionId }),
      executionMode: "sequential",
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          const result = await service.stop(enter(ctx), input.sessionId);
          return text(result, { targetSessionId: input.sessionId });
        } catch (error) {
          return toolError(error);
        }
      },
    }),
    defineTool({
      name: "session_close",
      label: "close another session",
      description:
        "Stop and release a session this session created. Its history stays in the sidebar and the user can reopen it.",
      parameters: Type.Object({ sessionId }),
      executionMode: "sequential",
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          const result = await service.close(enter(ctx), input.sessionId);
          return text(result, { targetSessionId: input.sessionId });
        } catch (error) {
          return toolError(error);
        }
      },
    }),
  ];
}
