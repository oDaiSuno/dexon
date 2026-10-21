import type { InteractiveReceipt, InteractiveSnapshot } from "../../shared/interactive-tools";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ToolInfo } from "../../shared/pi-types";
import type { ExtensionUiResponse, ExtensionWidgetItem } from "../../shared/types";
import type { SessionEntry } from "../../shared/types";
import { browserAgentRuntime } from "../browser-agent-runtime";
import { rememberLeafChoice } from "../session-leaf-store";
import { cacheSessionPath } from "../session-reader";
import {
  isUserMessageEntry,
  newestTipUnder,
  subtreeChangesFiles,
  versionEntryIdsOf,
  versionOnPath,
} from "../session-versions";
import { setSessionOrigin } from "../session-origin-store";

import type { AgentEvent } from "./types";
export interface SessionCommandContext {
  inner: AgentSessionLike;
  getInteractiveSnapshot(): InteractiveSnapshot;
  cancelInteractiveRequests(): void;
  sessionId: string;
  promptRunning: boolean;
  isRunning(): boolean;
  enqueueTurn<T>(task: () => Promise<T>): Promise<T>;
  emit(event: AgentEvent): void;
  withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T>;
  getExtensionStatuses(): Array<{ key: string; text: string }>;
  getExtensionWidgets(): ExtensionWidgetItem[];
  dispose(options: { abort?: boolean; reason?: string }): Promise<void>;
  applyRequestedTools(names: string[]): void;
  persistToolNames(sessionId: string, names: string[]): void;
  reloadSessionResources(): Promise<void>;
  syncBrowserToolActivation(): void;
  syncSessionToolActivation(): void;
  resolveExtensionUiResponse(response: ExtensionUiResponse): InteractiveReceipt;
  handleExtensionUiInput(id: string, data: string): void;
}
type PromptImage = { type: "image"; data: string; mimeType: string };

interface PromptTurn {
  message: string;
  images?: PromptImage[];
  streamingBehavior?: "steer" | "followUp";
  beforePrompt?: () => Promise<void>;
}

function startPromptTurn(context: SessionCommandContext, turn: PromptTurn): void {
  const { message, images, streamingBehavior, beforePrompt } = turn;
  if (!streamingBehavior) browserAgentRuntime.beginTurn(context.sessionId, "local");
  const invokePrompt = async () => {
    if (beforePrompt) await beforePrompt();
    return context.inner.prompt(message, {
      ...(images?.length ? { images } : {}),
      ...(streamingBehavior ? { streamingBehavior } : {}),
      source: "rpc",
    });
  };
  const operation = streamingBehavior ? invokePrompt() : context.enqueueTurn(invokePrompt);
  operation
    .then(() => {
      if (streamingBehavior) return;
      rememberLeafChoice(context.sessionId, context.inner.sessionManager);
      context.emit({ type: "prompt_done" });
    })
    .catch((error) => {
      context.emit({
        type: "prompt_error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (!streamingBehavior) context.emit({ type: "prompt_done" });
    });
}

function createSettlement(): {
  settled: Promise<{ ok: true } | { ok: false; error: unknown }>;
  settle(outcome: { ok: true } | { ok: false; error: unknown }): void;
} {
  let settle!: (outcome: { ok: true } | { ok: false; error: unknown }) => void;
  const settled = new Promise<{ ok: true } | { ok: false; error: unknown }>((resolve) => {
    settle = resolve;
  });
  return { settled, settle };
}

function syncAgentMessages(context: SessionCommandContext): void {
  const state = context.inner.agent.state;
  if (state) state.messages = context.inner.sessionManager.buildSessionContext().messages;
}

async function moveBeforeEntry(context: SessionCommandContext, entryId: string): Promise<void> {
  const sessionManager = context.inner.sessionManager;
  if (sessionManager.getLeafId() === entryId) {
    const parentId = sessionManager.getEntry(entryId)?.parentId ?? null;
    if (parentId) sessionManager.branch(parentId);
    else sessionManager.resetLeaf();
    syncAgentMessages(context);
    return;
  }
  const result = await context.inner.navigateTree(entryId, {});
  if (result.cancelled) throw new Error("Editing this message was cancelled");
}

function commitLeaf(context: SessionCommandContext, tip: string): void {
  const sessionManager = context.inner.sessionManager;
  if (sessionManager.getLeafId() === tip) return;
  sessionManager.branch(tip);
  syncAgentMessages(context);
}

export async function sendSessionCommand(
  command: Record<string, unknown>,
  context: SessionCommandContext,
): Promise<unknown> {
  const type = command.type as string;
  switch (type) {
    case "prompt": {
      // Fire and forget — events come via subscribe
      startPromptTurn(context, {
        message: command.message as string,
        images: command.images as PromptImage[] | undefined,
        streamingBehavior: command.streamingBehavior as "steer" | "followUp" | undefined,
      });
      return null;
    }

    case "edit_message": {
      const entryId = command.entryId as string;
      if (context.isRunning()) throw new Error("Wait for the current response to finish before editing a message.");
      const entries = context.inner.sessionManager.getEntries() as unknown as SessionEntry[];
      if (!isUserMessageEntry(entries.find((candidate) => candidate.id === entryId))) {
        throw new Error("Only a question can be edited");
      }
      const navigation = createSettlement();
      startPromptTurn(context, {
        message: command.message as string,
        images: command.images as PromptImage[] | undefined,
        beforePrompt: async () => {
          try {
            await moveBeforeEntry(context, entryId);
            navigation.settle({ ok: true });
          } catch (error) {
            navigation.settle({ ok: false, error });
            throw error;
          }
        },
      });
      const outcome = await navigation.settled;
      if (!outcome.ok) throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
      return { cancelled: false };
    }

    case "switch_version": {
      if (context.isRunning()) throw new Error("Wait for the current response to finish before switching versions.");
      const entryId = command.entryId as string;
      const sessionManager = context.inner.sessionManager;
      const entries = sessionManager.getEntries() as unknown as SessionEntry[];
      if (!isUserMessageEntry(entries.find((candidate) => candidate.id === entryId))) {
        throw new Error("Only a question can be switched to another version");
      }
      const versionEntryIds = versionEntryIdsOf(entries, entryId);
      const leftVersionId = versionOnPath(entries, sessionManager.getLeafId(), versionEntryIds);
      const leftVersionChangedFiles = leftVersionId ? subtreeChangesFiles(entries, leftVersionId) : false;
      const tip = newestTipUnder(entries, entryId);
      await context.inner.navigateTree(tip, {});
      commitLeaf(context, tip);
      rememberLeafChoice(context.sessionId, sessionManager);
      return { cancelled: false, leafId: sessionManager.getLeafId(), leftVersionChangedFiles };
    }

    case "abort":
      context.cancelInteractiveRequests();
      await context.withFinalRunningNotification(() => context.inner.abort());
      return null;

    case "get_state": {
      const model = context.inner.model;
      const contextUsage = context.inner.getContextUsage();
      return {
        sessionId: context.inner.sessionId,
        sessionFile: context.inner.sessionFile ?? "",
        isStreaming: context.inner.isStreaming,
        streamingMessage: context.inner.agent.state?.streamingMessage ?? null,
        isPromptRunning: context.promptRunning,
        isCompacting: context.inner.isCompacting,
        autoCompactionEnabled: context.inner.autoCompactionEnabled,
        autoRetryEnabled: context.inner.autoRetryEnabled,
        model: model ? { id: model.id, provider: model.provider } : undefined,
        messageCount: 0,
        pendingMessageCount: context.inner.pendingMessageCount,
        queuedMessages: {
          steering: [...context.inner.getSteeringMessages()],
          followUp: [...context.inner.getFollowUpMessages()],
        },
        contextUsage: contextUsage
          ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
          : null,
        systemPrompt: context.inner.agent.state?.systemPrompt ?? "",
        thinkingLevel: context.inner.agent.state?.thinkingLevel ?? "off",
        extensionUi: context.getInteractiveSnapshot(),
        extensionStatuses: context.getExtensionStatuses(),
        extensionWidgets: context.getExtensionWidgets(),
      };
    }

    case "set_model": {
      const { provider, modelId } = command as { provider: string; modelId: string };
      const model = context.inner.modelRuntime.getModel(provider, modelId);
      if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
      await context.inner.setModel(model);
      return { id: model.id, provider: model.provider };
    }

    case "fork": {
      const entryId = command.entryId as string;
      const position = command.position ?? "before";
      if (position !== "at" && position !== "before") throw new Error(`Unsupported fork position: ${position}`);

      const sessionManager = context.inner.sessionManager;
      const currentSessionFile = context.inner.sessionFile;

      if (!sessionManager.isPersisted()) return { cancelled: true };
      if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

      const entry = sessionManager.getEntry(entryId);
      if (!entry) throw new Error("Invalid entry ID for forking");

      const sessionDir = sessionManager.getSessionDir();
      const copyEndpoint = position === "at" ? entry.id : entry.parentId;
      let newSessionFile: string;

      if (!copyEndpoint) {
        const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
        newManager.newSession({ parentSession: currentSessionFile });
        newSessionFile = newManager.getSessionFile() as string;
      } else {
        const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
        const forkedPath = sourceManager.createBranchedSession(copyEndpoint);
        if (!forkedPath) throw new Error("Failed to create forked session");
        newSessionFile = forkedPath;
      }

      const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
      cacheSessionPath(newSessionId, newSessionFile);
      setSessionOrigin(newSessionId, { relation: "fork" });
      await context.dispose({ abort: true, reason: "fork" });
      return { cancelled: false, newSessionId };
    }

    case "navigate_tree": {
      const result = await context.inner.navigateTree(command.targetId as string, {});
      rememberLeafChoice(context.sessionId, context.inner.sessionManager);
      return { cancelled: result.cancelled, leafId: context.inner.sessionManager.getLeafId() };
    }

    case "set_thinking_level": {
      const level = command.level as string;
      context.inner.setThinkingLevel(level);
      // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
      // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
      // force the state back so the compat layer can use it correctly.
      if (
        level === "xhigh" &&
        (context.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat ===
          "deepseek" &&
        context.inner.agent?.state
      ) {
        context.inner.agent.state.thinkingLevel = "xhigh";
      }
      return null;
    }

    case "compact": {
      const result = await context.withFinalRunningNotification(() =>
        context.enqueueTurn(() => context.inner.compact(command.customInstructions as string | undefined)),
      );
      return result;
    }

    case "set_session_name": {
      const name = (command.name as string | undefined)?.trim();
      if (!name) throw new Error("Session name cannot be empty");
      context.inner.setSessionName(name);
      return null;
    }

    case "get_session_stats": {
      return {
        ...context.inner.getSessionStats(),
        sessionName: context.inner.sessionManager.getSessionName(),
      };
    }

    case "get_last_assistant_text": {
      return { text: context.inner.getLastAssistantText() ?? "" };
    }

    case "set_auto_compaction": {
      context.inner.setAutoCompactionEnabled(command.enabled as boolean);
      return null;
    }

    case "clear_queue": {
      // Full clear only: pi has no single-item dequeue, and clear+requeue
      // races against the agent loop pulling messages mid-flight.
      return context.inner.clearQueue();
    }

    case "steer": {
      const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
      await context.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
      return null;
    }

    case "follow_up": {
      const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
      await context.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
      return null;
    }

    case "get_tools": {
      const all: ToolInfo[] = context.inner.getAllTools();
      const active = new Set<string>(context.inner.getActiveToolNames());
      return all.map((t) => ({
        name: t.name,
        description: t.description,
        active: active.has(t.name),
      }));
    }

    case "get_commands": {
      const commands: SlashCommandInfo[] = [];
      for (const registered of context.inner.extensionRunner.getRegisteredCommands()) {
        commands.push({
          name: registered.invocationName,
          description: registered.description,
          source: "extension",
          sourceInfo: registered.sourceInfo,
        });
      }
      for (const template of context.inner.promptTemplates) {
        commands.push({
          name: template.name,
          description: template.description,
          source: "prompt",
          sourceInfo: template.sourceInfo,
        });
      }
      for (const skill of context.inner.resourceLoader.getSkills().skills) {
        commands.push({
          name: `skill:${skill.name}`,
          description: skill.description,
          source: "skill",
          sourceInfo: skill.sourceInfo,
        });
      }
      return { commands };
    }

    case "set_tools": {
      const toolNames = command.toolNames as string[];
      context.applyRequestedTools(toolNames);
      context.persistToolNames(context.sessionId, toolNames);
      return null;
    }

    case "reload": {
      await context.enqueueTurn(() => context.reloadSessionResources());
      context.syncBrowserToolActivation();
      context.syncSessionToolActivation();
      return { success: true };
    }

    case "abort_compaction": {
      context.inner.abortCompaction();
      return null;
    }

    case "extension_ui_response": {
      return context.resolveExtensionUiResponse(command as ExtensionUiResponse);
    }

    case "extension_ui_input": {
      context.handleExtensionUiInput(command.id as string, command.data as string);
      return null;
    }

    case "set_auto_retry": {
      context.inner.setAutoRetryEnabled(command.enabled as boolean);
      return null;
    }

    default:
      throw new Error(`Unsupported command: ${type}`);
  }
}
