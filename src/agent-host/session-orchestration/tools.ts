import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  SESSION_ORCHESTRATION_LIMITS,
  SESSION_THINKING_LEVELS,
  type SessionToolTargetDetails,
} from "../../shared/session-orchestration";
import { getBrowserSessionSource } from "../browser-tools";
import { CHANNEL_REFUSAL, DISABLED_REFUSAL } from "./errors";
import { getSessionOrchestrationService, SessionOrchestrationError, type SessionWaitResult } from "./service";
import { getSessionOrchestrationSettings } from "./settings";
import { limitReply } from "./transcript";

type ToolContext = { sessionManager: { getSessionId(): string } };

const PARALLEL_GUIDELINE = "To run work in parallel, start every session without wait first, then wait on them.";

const sessionId = Type.String({ minLength: 1, maxLength: 128, description: "Target session id from session_list" });
const firstMessage = Type.String({
  minLength: 1,
  maxLength: SESSION_ORCHESTRATION_LIMITS.messageMaxChars,
  description: "First task the new session receives as its first user message",
});
const nextMessage = Type.String({
  minLength: 1,
  maxLength: SESSION_ORCHESTRATION_LIMITS.messageMaxChars,
  description: "Message the other session receives as its next user turn",
});
const cwd = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: 4_096,
    description: "Directory inside this project or a worktree of this repository; defaults to the caller's directory",
  }),
);
const name = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: SESSION_ORCHESTRATION_LIMITS.nameMaxChars,
    description: "Title of the new session in the sidebar",
  }),
);
const timeoutSeconds = Type.Optional(
  Type.Integer({
    minimum: 0,
    maximum: SESSION_ORCHESTRATION_LIMITS.waitMaxSeconds,
    description:
      "Seconds to wait before reporting a timeout (default 900, maximum 7200); a timeout never stops the other session",
  }),
);
const thinkingLevel = Type.Optional(
  Type.Union(
    SESSION_THINKING_LEVELS.map((level) => Type.Literal(level)),
    {
      description:
        "Reasoning effort for the new session; defaults to the Settings choice, otherwise the caller's own level",
    },
  ),
);
const model = Type.Optional(
  Type.Object(
    {
      provider: Type.String({ minLength: 1, maxLength: 256, description: "Provider id of the model" }),
      modelId: Type.String({ minLength: 1, maxLength: 256, description: "Model id within that provider" }),
    },
    {
      description:
        "Provider and model id for the new session; defaults to the Settings choice, otherwise the caller's own model",
    },
  ),
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
  if (!getSessionOrchestrationSettings().enabled) throw new SessionOrchestrationError(DISABLED_REFUSAL);
}

function assertLocalTurn(ctx: ToolContext): void {
  if (getBrowserSessionSource(ctx.sessionManager) === "channel") {
    throw new SessionOrchestrationError(CHANNEL_REFUSAL);
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
    ...(wait.lastReply ? limitReply(wait.lastReply) : {}),
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
      promptGuidelines: [PARALLEL_GUIDELINE],
      parameters: Type.Object({
        message: firstMessage,
        cwd,
        name,
        model,
        thinkingLevel,
        wait: Type.Optional(
          Type.Boolean({ description: "Wait for the first turn of the new session to settle before returning" }),
        ),
        timeoutSeconds,
      }),
      async execute(_toolCallId, input, signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          const created = await service.create(enter(ctx), input as never, signal);
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
      parameters: Type.Object({
        sessionId,
        message: nextMessage,
        wait: Type.Optional(
          Type.Boolean({ description: "Wait for the turn this message causes to settle before returning" }),
        ),
        timeoutSeconds,
      }),
      async execute(_toolCallId, input, signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          const result = await service.prompt(enter(ctx), input as never, signal);
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
        "Wait until a session settles and return the outcome: idle, error, awaiting_input, stopped or timeout. A timeout is not a failure: the session keeps working and the result says so.",
      promptSnippet: "session_wait: wait for a session to finish before reading its result",
      promptGuidelines: [PARALLEL_GUIDELINE],
      parameters: Type.Object({ sessionId, timeoutSeconds }),
      async execute(_toolCallId, input, signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          const result = await service.wait(enter(ctx), input.sessionId, input.timeoutSeconds, signal);
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
      description: "List the sessions of this project with their live status and the session that created each one.",
      promptSnippet: "session_list: list the sessions of this project with their live status",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: SESSION_ORCHESTRATION_LIMITS.listMax,
            description: "How many sessions to list (default 30, maximum 100)",
          }),
        ),
      }),
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
        "Return the last reply of a session and write its whole history — every message, thinking, tool call input and result — to a Markdown snapshot at transcript.path. Explore that file with read, grep or bash; it is a snapshot of this moment, so call again for a fresh one.",
      promptSnippet: "session_read: read another session's last reply and its full transcript file",
      parameters: Type.Object({ sessionId }),
      async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
        try {
          const service = getSessionOrchestrationService();
          const view = await service.read(enter(ctx), input.sessionId);
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
        "Stop the current turn of a session this session created and cancel the messages this session queued for it that have not started. The session stays open and can be prompted again.",
      promptSnippet: "session_stop: stop a session's current turn and drop the messages this session queued",
      parameters: Type.Object({ sessionId }),
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
      promptSnippet: "session_close: close a session, keeping its history in the sidebar",
      parameters: Type.Object({ sessionId }),
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
