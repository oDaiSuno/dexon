import { type AgentSessionRuntimeDiagnostic } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "crypto";
import type { ChannelId } from "../../shared/channel-types";
import type { AgentSessionLike, ExtensionUiContextLike } from "../../shared/pi-types";
import type { ChannelMessageAttachment, ExtensionUiRequest } from "../../shared/types";
import { browserAgentRuntime } from "../browser-agent-runtime";
import { browserCapabilityRuntime } from "../browser-capability-runtime";
import { browserToolNamesForSnapshot, isBrowserToolName, setBrowserSessionSource } from "../browser-tools";
import { projectExtensionDiagnostics } from "../extension-diagnostics";
import { stripToolchainMarkers } from "../session-entry-compat";
import { setDesktopSessionToolNames } from "../session-tool-store";

import { notifyRunningChange } from "../rpc-manager";
import { sendSessionCommand } from "./commands";
import { stripLegacyChannelPrompts, withExtensionTools } from "./compat";
import { disposeSession } from "./dispose";
import { SessionExtensionUi } from "./extension-ui";
import type {
  AgentEvent,
  EventListener,
  ExtensionBindingOptions,
  ExtensionCommandContextActionsLike,
  ExternalSessionCommand,
} from "./types";

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper extends SessionExtensionUi {
  public readonly inner: AgentSessionLike;
  private listeners: EventListener[] = [];
  private promptRunning = false;
  private queuedTurnCount = 0;
  private turnTail: Promise<void> = Promise.resolve();
  protected externalTurnActive = false;
  private externalTurnChannel: ChannelId | null = null;
  private externalTurnAttachments: ChannelMessageAttachment[] | null = null;
  private externalTurnProgress: ((event: AgentEvent) => void) | null = null;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private extensionBindingAttempt = 0;
  private forceEmptySystemPrompt = false;
  private toolchainPrompt = "";
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyCallbacks = new Set<() => void>();
  private disposePromise: Promise<void> | null = null;
  private _alive = true;
  private requestedToolNames: string[] | undefined;
  private readonly persistToolNames: (sessionId: string, toolNames: string[]) => void;

  constructor(
    inner: AgentSessionLike,
    requestedToolNames?: string[],
    persistToolNames: (sessionId: string, toolNames: string[]) => void = setDesktopSessionToolNames,
  ) {
    super();
    this.inner = inner;
    this.persistToolNames = persistToolNames;
    this.requestedToolNames = requestedToolNames ? [...requestedToolNames] : requestedToolNames;
    this.forceEmptySystemPrompt = requestedToolNames?.length === 0;
    const messages = this.inner.agent.state?.messages;
    if (Array.isArray(messages)) this.inner.agent.state!.messages = stripLegacyChannelPrompts(messages);
    this.applyForcedEmptySystemPrompt();
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  get cwd(): string {
    const cwd = this.inner.sessionManager.getHeader()?.cwd;
    return typeof cwd === "string" ? cwd : "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return (
      this._alive &&
      (this.promptRunning || this.queuedTurnCount > 0 || this.inner.isStreaming || this.inner.isCompacting)
    );
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      const displayEvent = this.withExternalChannelSource(event);
      this.emit(displayEvent);
      try {
        this.externalTurnProgress?.(displayEvent);
      } catch {
        // Channel progress is best-effort and must never interrupt the Agent.
      }
      // Streaming / compaction / tool events flow through here; re-broadcast
      // the running-status snapshot so the sidebar can update live.
      notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  syncBrowserToolActivation(): void {
    if (this.forceEmptySystemPrompt) {
      this.inner.setActiveToolsByName([]);
      return;
    }
    const current = this.inner.getActiveToolNames().filter((name) => !isBrowserToolName(name));
    const browserTools = browserToolNamesForSnapshot(browserCapabilityRuntime.getSnapshot());
    this.inner.setActiveToolsByName([...new Set([...current, ...browserTools])]);
  }

  private withExternalChannelSource(event: AgentEvent): AgentEvent {
    if (!this.externalTurnChannel || (event.type !== "message_start" && event.type !== "message_end")) return event;
    const message = event.message;
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") return event;
    return {
      ...event,
      message: {
        ...(message as Record<string, unknown>),
        channelSource: this.externalTurnChannel,
        ...(this.externalTurnAttachments?.length ? { channelAttachments: this.externalTurnAttachments } : {}),
      },
    };
  }

  setToolchainSummary(revision: number, summary: readonly string[]): void {
    this.toolchainPrompt = [`<dexon-toolchain revision="${revision}">`, ...summary, "</dexon-toolchain>"].join("\n");
    this.applyToolchainSummary();
  }

  setRuntimeDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
    this.runtimeDiagnosticStatuses = new Map(
      projectExtensionDiagnostics(diagnostics).map(({ key, text }) => [key, text]),
    );
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error(
        "[dexon] failed to dispatch session_start to extensions:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    const attempt = ++this.extensionBindingAttempt;
    const startedAt = Date.now();
    const bindingPromise: Promise<void> = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () =>
            this.emit({
              type: "extension_ui_request",
              id: randomUUID(),
              method: "notify",
              notifyType: "warning",
              message: "Extension requested shutdown, but shutdown is not supported in Pi Desktop.",
            } as ExtensionUiRequest as AgentEvent),
          onError: (error) =>
            this.emit({
              type: "extension_error",
              extensionPath: error.extensionPath,
              event: error.event,
              error: error.error,
            }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
      console.log(`[dexon] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })()
      .catch((err) => {
        this.extensionBindingError = err;
        console.warn(
          `[dexon] extension binding attempt ${attempt} failed after ${Date.now() - startedAt}ms for session ${this.inner.sessionId}`,
        );
        throw err;
      })
      .finally(() => {
        if (this.extensionBindingPromise === bindingPromise) this.extensionBindingPromise = null;
      });
    this.extensionBindingPromise = bindingPromise;

    return bindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (!this.extensionsBound) await this.ensureExtensionsBound();
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }

  protected applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private applyRequestedTools(toolNames: string[]): void {
    this.requestedToolNames = [...toolNames];
    this.forceEmptySystemPrompt = toolNames.length === 0;
    this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
    this.syncBrowserToolActivation();
    this.applyForcedEmptySystemPrompt();
  }

  private applyToolchainSummary(): void {
    if (this.forceEmptySystemPrompt || !this.toolchainPrompt || !this.inner.agent.state) return;
    const base = stripToolchainMarkers(String(this.inner.agent.state.systemPrompt ?? ""));
    this.inner.agent.state.systemPrompt = `${base}\n\n${this.toolchainPrompt}`.trim();
  }

  protected emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* Observers must never strand a request. */
      }
    }
  }

  private enqueueTurn<T>(task: () => Promise<T>): Promise<T> {
    this.queuedTurnCount += 1;
    notifyRunningChange();
    const run = this.turnTail
      .catch(() => undefined)
      .then(async () => {
        if (!this._alive) throw new Error("Agent session is no longer available");
        this.promptRunning = true;
        notifyRunningChange();
        try {
          return await task();
        } finally {
          this.promptRunning = false;
          this.queuedTurnCount = Math.max(0, this.queuedTurnCount - 1);
          notifyRunningChange();
        }
      });
    this.turnTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async runExternalTurn(params: {
    runId: string;
    message: string;
    channel: ChannelId;
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    channelAttachments?: ChannelMessageAttachment[];
    attachmentContext?: string;
    onProgress?: (event: AgentEvent) => void;
  }): Promise<{ runId: string; finalText: string }> {
    return this.enqueueTurn(async () => {
      this.emit({ type: "channel_turn_start", runId: params.runId });
      this.externalTurnActive = true;
      this.externalTurnChannel = params.channel;
      this.externalTurnAttachments = params.channelAttachments ?? null;
      setBrowserSessionSource(this.inner.sessionManager, "channel");
      browserAgentRuntime.beginTurn(this.sessionId, "channel");
      this.externalTurnProgress = params.onProgress ?? null;
      try {
        this.inner.sessionManager.appendCustomEntry("dexon-channel-source", {
          runId: params.runId,
          channel: params.channel,
          ...(params.channelAttachments?.length ? { attachments: params.channelAttachments } : {}),
        });
        if (params.attachmentContext) {
          await this.inner.sendCustomMessage(
            {
              customType: "dexon-channel-attachment-context",
              content: params.attachmentContext,
              display: false,
            },
            { deliverAs: "nextTurn" },
          );
        }
        await this.inner.prompt(params.message, {
          ...(params.images?.length ? { images: params.images } : {}),
          expandPromptTemplates: false,
          source: "rpc",
        });
        const finalText = this.inner.getLastAssistantText()?.trim() ?? "";
        this.emit({ type: "channel_turn_end", runId: params.runId, finalText });
        return { runId: params.runId, finalText };
      } catch (error) {
        try {
          this.inner.sessionManager.appendCustomEntry("dexon-channel-source-cancelled", { runId: params.runId });
        } catch {
          // A best-effort UI marker must never hide the original turn failure.
        }
        this.emit({
          type: "channel_turn_error",
          runId: params.runId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        this.externalTurnProgress = null;
        this.externalTurnActive = false;
        this.externalTurnChannel = null;
        this.externalTurnAttachments = null;
        setBrowserSessionSource(this.inner.sessionManager, "local");
      }
    });
  }

  private async reloadSessionResources(): Promise<void> {
    if (this.extensionBindingPromise) {
      try {
        await this.extensionBindingPromise;
      } catch {
        // Reload is the explicit recovery path for a failed extension bind.
      }
    }
    this.extensionsBound = false;
    this.extensionBindingPromise = null;
    this.extensionBindingError = null;
    this.cancelInteractiveRequests();
    this.extensionStatuses.clear();
    this.extensionWidgets.clear();
    await this.inner.reload();
    await this.ensureExtensionsBound();
    if (this.requestedToolNames !== undefined) this.applyRequestedTools(this.requestedToolNames);
    this.applyForcedEmptySystemPrompt();
    this.applyToolchainSummary();
  }

  async runExternalCommand(params: { command: ExternalSessionCommand; customInstructions?: string }): Promise<void> {
    await this.enqueueTurn(async () => {
      if (params.command === "compact") {
        await this.inner.compact(params.customInstructions);
        return;
      }
      await this.reloadSessionResources();
    });
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => {
        // Never idle-evict a still-running agent (ISSUE-003)
        if (this.isRunning()) {
          this.resetIdleTimer();
          return;
        }
        void this.dispose({ abort: true, reason: "idle-eviction" });
      },
      10 * 60 * 1000,
    );
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    listener({ type: "extension_ui_snapshot", snapshot: this.getInteractiveSnapshot() });
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): () => void {
    if (!this._alive) {
      cb();
      return () => undefined;
    }
    this.destroyCallbacks.add(cb);
    return () => this.destroyCallbacks.delete(cb);
  }
  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    if (this.shouldWaitForExtensions(command.type as string)) await this.waitForExtensionsBound();
    return sendSessionCommand(command, {
      sessionId: this.sessionId,
      inner: this.inner,
      getInteractiveSnapshot: this.getInteractiveSnapshot.bind(this),
      cancelInteractiveRequests: this.cancelInteractiveRequests.bind(this),
      enqueueTurn: this.enqueueTurn.bind(this),
      emit: this.emit.bind(this),
      withFinalRunningNotification: this.withFinalRunningNotification.bind(this),
      promptRunning: this.promptRunning,
      getExtensionStatuses: this.getExtensionStatuses.bind(this),
      getExtensionWidgets: this.getExtensionWidgets.bind(this),
      dispose: this.dispose.bind(this),
      applyRequestedTools: this.applyRequestedTools.bind(this),
      persistToolNames: this.persistToolNames,
      reloadSessionResources: this.reloadSessionResources.bind(this),
      syncBrowserToolActivation: this.syncBrowserToolActivation.bind(this),
      resolveExtensionUiResponse: this.resolveExtensionUiResponse.bind(this),
      handleExtensionUiInput: this.handleExtensionUiInput.bind(this),
    });
  }

  /**
   * Stop the underlying agent and release resources. Calls are idempotent and
   * concurrent owners share one teardown attempt.
   */
  dispose(options: { abort?: boolean; reason?: string; timeoutMs?: number } = {}): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    const abort = options.abort !== false;
    const reason = options.reason ?? "explicit";
    const timeoutMs = options.timeoutMs ?? 5_000;
    this.destroy();

    this.disposePromise = disposeSession(this.inner, abort, reason, timeoutMs);
    return this.disposePromise;
  }

  async abortAndDispose(): Promise<void> {
    await this.dispose({ abort: true, reason: "explicit" });
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    browserAgentRuntime.clearSession(this.sessionId);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.uiRequests.destroy();
    this.listeners = [];
    const destroyCallbacks = [...this.destroyCallbacks];
    this.destroyCallbacks.clear();
    for (const callback of destroyCallbacks) {
      try {
        callback();
      } catch {
        /* isolate teardown owners */
      }
    }
    notifyRunningChange();
  }
}
