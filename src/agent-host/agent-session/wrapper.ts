import { type AgentSessionRuntimeDiagnostic } from "@earendil-works/pi-coding-agent";
import type { ChannelId } from "../../shared/channel-types";
import type { AgentSessionLike, ToolLoadoutReader } from "../../shared/pi-types";
import type { SessionLiveStatus, SessionSourceRef } from "../../shared/session-orchestration";
import type { AgentMessage, ChannelMessageAttachment } from "../../shared/types";
import { browserAgentRuntime } from "../browser-agent-runtime";
import { setBrowserSessionSource } from "../browser-tools";
import { toDisplayEvent } from "../display-message";
import { projectExtensionDiagnostics } from "../extension-diagnostics";
import { desktopToolIntents } from "../session-tool-store";
import { isReadOnlyAgentCommand, type SessionMutationOperation } from "../session-origin-store";
import type { ChosenSessionModel } from "../session-model";

import { notifyRunningChange } from "../rpc-manager";
import { BlockTimingRecorder } from "./block-timing";
import { sendSessionCommand } from "./commands";
import { disposeSession } from "./dispose";
import { SessionExtensionUi } from "./extension-ui";
import { type ExternalTurnParams, runExternalTurn as runExternalTurnOn } from "./external-turn";
import { announceSavedMessage } from "./message-saved";
import { decorateUserMessageEvent } from "./message-sources";
import { runOrchestratedTurn as runOrchestratedTurnOn } from "./orchestrated-turn";
import { QueuedTurns } from "./queued-turns";
import { RetryOutcomeRecorder } from "./retry-outcome";
import { readToolGlobals, type RunPolicy, type ToolchainSection } from "./run-policy";
import {
  headlessReason,
  immutableExecutionProfile,
  ExecutionProfileControl,
  ProfileRunPolicy,
  type SessionExecutionProfile,
} from "./execution-profile";
import {
  runAutomationTurn as runAutomationTurnOn,
  type AutomationTurnOptions,
  type AutomationTurnOutput,
} from "./automation-turn";
import type { EffectObservation } from "../effect-observation";
import { SessionModelState } from "./session-model-state";
import type { ToolIntentStore } from "./tool-intent";
import { SessionTurnStatus } from "./turn-status";
import type { AgentEvent, EventListener, ExternalSessionCommand, OrchestratedTurnOutcome } from "./types";

export class AgentSessionWrapper extends SessionExtensionUi {
  public readonly inner: AgentSessionLike & ToolLoadoutReader;
  private listeners: EventListener[] = [];
  private promptRunning = false;
  private queuedTurnCount = 0;
  private turnTail: Promise<void> = Promise.resolve();
  private orchestratedSource: SessionSourceRef | null = null;
  public readonly queuedTurns = new QueuedTurns();
  private readonly turnStatus = new SessionTurnStatus();
  private readonly retryOutcome = new RetryOutcomeRecorder();
  private readonly blockTiming = new BlockTimingRecorder();
  protected externalTurnActive = false;
  private externalTurnChannel: ChannelId | null = null;
  private externalTurnAttachments: ChannelMessageAttachment[] | null = null;
  private externalTurnProgress: ((event: AgentEvent) => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyCallbacks = new Set<() => void>();
  private disposePromise: Promise<void> | null = null;
  private _alive = true;
  public readonly sessionModel = new SessionModelState();
  public readonly runPolicy: RunPolicy;
  public readonly executionToolchain: ToolchainSection | null;
  private readonly profile: SessionExecutionProfile;
  private readonly execution: ExecutionProfileControl;

  constructor(
    inner: AgentSessionLike & ToolLoadoutReader,
    options: {
      profile?: SessionExecutionProfile;
      intents?: ToolIntentStore;
      toolchain?: ToolchainSection | null;
    } = {},
  ) {
    super();
    this.inner = inner;
    this.profile = immutableExecutionProfile(options.profile ?? { kind: "interactive" });
    this.executionToolchain = options.toolchain ?? null;
    this.runPolicy = new ProfileRunPolicy(this.profile, {
      session: inner,
      toolchain: options.toolchain ?? null,
      intents: options.intents ?? desktopToolIntents,
      globals: readToolGlobals,
    });
    this.execution = new ExecutionProfileControl(this.profile, inner, this.runPolicy, (event) => this.emit(event));
  }
  get executionProfile(): SessionExecutionProfile {
    return this.profile;
  }

  protected headlessReason(): "automation" | "channel" | null {
    return headlessReason(this.profile, this.externalTurnActive);
  }
  applyActiveTools(): void {
    this.execution.applyActiveTools();
  }
  syncBrowserToolActivation(): void {
    this.applyActiveTools();
  }
  syncSessionToolActivation(): void {
    this.applyActiveTools();
  }
  automationToolBlocked(name: string): boolean {
    return this.execution.blocked(name);
  }
  blockAutomationTools(): void {
    this.execution.block();
  }
  private authorizeMutation(operation: SessionMutationOperation): void {
    this.execution.authorizeMutation(this.sessionId, operation);
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

  chosenModel(): ChosenSessionModel {
    return this.sessionModel.choice(this.inner);
  }

  isRunning(): boolean {
    return (
      this._alive &&
      (this.promptRunning || this.queuedTurnCount > 0 || this.inner.isStreaming || this.inner.isCompacting)
    );
  }

  streamingMessage(): AgentMessage | null {
    const message = this.inner.agent.state?.streamingMessage;
    if (!message || typeof message !== "object") return null;
    return this.blockTiming.decorate(message) as AgentMessage;
  }

  recordTurnError(message: string): void {
    this.turnStatus.fail(message);
    notifyRunningChange();
  }

  start(): void {
    if (this.profile.kind !== "interactive") this.applyActiveTools();
    this.unsubscribe = this.inner.subscribe((sourceEvent: AgentEvent) => {
      this.resetIdleTimer();
      const event = toDisplayEvent(sourceEvent);
      if (!event) return;
      this.turnStatus.observe(event);
      this.retryOutcome.observe(event, this.inner.sessionManager);
      const displayEvent = this.withMessageSources(this.blockTiming.observe(event));
      this.emit(displayEvent);
      if (event.type === "message_end") {
        announceSavedMessage(this.inner.sessionManager, event.message, (saved) => {
          if (this._alive) this.emit(saved);
        });
      }
      try {
        this.externalTurnProgress?.(displayEvent);
      } catch {}
      notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  liveStatus(): SessionLiveStatus | "idle" {
    return this.turnStatus.status({
      alive: this._alive,
      awaitingInput: this.getInteractiveSnapshot().requests.length > 0,
      running: this.isRunning(),
    });
  }

  lastTurnErrorMessage(): string | null {
    return this.turnStatus.error();
  }

  private withMessageSources(event: AgentEvent): AgentEvent {
    return decorateUserMessageEvent(event, {
      channel: this.externalTurnChannel,
      attachments: this.externalTurnAttachments,
      session: this.orchestratedSource,
    });
  }

  protected override onExtensionsBound(): void {
    if (this.profile.kind !== "interactive") this.applyActiveTools();
  }

  setRuntimeDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
    this.runtimeDiagnosticStatuses = new Map(
      projectExtensionDiagnostics(diagnostics).map(({ key, text }) => [key, text]),
    );
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }

  public emit(event: AgentEvent): void {
    if (event.type === "prompt_error") {
      notifyRunningChange();
    } else if (event.type === "extension_ui_snapshot") {
      notifyRunningChange();
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  enqueueTurn<T>(task: () => Promise<T>): Promise<T> {
    this.queuedTurnCount += 1;
    this.turnStatus.beginTurn();
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

  runOrchestratedTurn(params: { message: string; source?: SessionSourceRef }): Promise<OrchestratedTurnOutcome> {
    this.authorizeMutation("session_prompt");
    return runOrchestratedTurnOn(
      {
        inner: this.inner,
        sessionId: this.sessionId,
        enqueueTurn: (task) => this.enqueueTurn(task),
        queuedTurns: this.queuedTurns,
        chosenModel: () => this.chosenModel(),
        waitForExtensionsBound: () => this.waitForExtensionsBound(),
        emit: (event) => this.emit(event),
        assertModelUsable: () => this.sessionModel.assertUsable(this.inner),
        recordTurnError: (message) => this.recordTurnError(message),
        setMessageSource: (source) => {
          this.orchestratedSource = source;
        },
      },
      params,
    );
  }

  runExternalTurn(params: ExternalTurnParams): Promise<{ runId: string; finalText: string }> {
    this.authorizeMutation("session_prompt");
    return runExternalTurnOn(
      {
        inner: this.inner,
        sessionId: this.sessionId,
        enqueueTurn: (task) => this.enqueueTurn(task),
        emit: (event) => this.emit(event),
        chosenModel: () => this.chosenModel(),
        assertModelUsable: () => this.sessionModel.assertUsable(this.inner),
        beginExternalTurn: (context) => {
          this.externalTurnActive = true;
          this.externalTurnChannel = context.channel;
          this.externalTurnAttachments = context.attachments;
          this.externalTurnProgress = context.progress;
        },
        endExternalTurn: () => {
          this.externalTurnProgress = null;
          this.externalTurnActive = false;
          this.externalTurnChannel = null;
          this.externalTurnAttachments = null;
        },
        setBrowserSource: (source, channel) => setBrowserSessionSource(this.inner.sessionManager, source, channel),
      },
      params,
    );
  }

  runAutomationTurn<T>(
    prompt: string,
    options: AutomationTurnOptions<T>,
  ): Promise<EffectObservation<AutomationTurnOutput<T>>> {
    return runAutomationTurnOn(this, prompt, options);
  }

  async runExternalCommand(params: { command: ExternalSessionCommand; customInstructions?: string }): Promise<void> {
    this.authorizeMutation("agent_command");
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
  async configureLaunch(settings: {
    provider?: string;
    modelId?: string;
    thinkingLevel?: string;
    name?: string;
  }): Promise<void> {
    this.execution.authorizeLaunchConfiguration(this.sessionId, this.isRunning());
    if (settings.provider && settings.modelId)
      await this.dispatchCommand({ type: "set_model", provider: settings.provider, modelId: settings.modelId });
    if (settings.thinkingLevel)
      await this.dispatchCommand({ type: "set_thinking_level", level: settings.thinkingLevel });
    if (settings.name) await this.dispatchCommand({ type: "set_session_name", name: settings.name });
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    if (!isReadOnlyAgentCommand(command.type)) this.authorizeMutation("agent_command");
    return this.dispatchCommand(command);
  }

  private async dispatchCommand(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    if (["prompt", "edit_message", "steer", "follow_up", "get_commands"].includes(String(command.type)))
      await this.waitForExtensionsBound();
    const result = await sendSessionCommand(command, {
      sessionId: this.sessionId,
      inner: this.inner,
      getInteractiveSnapshot: this.getInteractiveSnapshot.bind(this),
      cancelInteractiveRequests: this.cancelInteractiveRequests.bind(this),
      enqueueTurn: this.enqueueTurn.bind(this),
      emit: this.emit.bind(this),
      withFinalRunningNotification: this.withFinalRunningNotification.bind(this),
      markTurnStopped: () => this.turnStatus.stop(),
      promptRunning: this.promptRunning,
      isRunning: () => this.isRunning(),
      streamingMessage: () => this.streamingMessage(),
      chosenModel: () => this.chosenModel(),
      assertModelUsable: () => this.sessionModel.assertUsable(this.inner),
      getExtensionStatuses: this.getExtensionStatuses.bind(this),
      getExtensionWidgets: this.getExtensionWidgets.bind(this),
      dispose: this.dispose.bind(this),
      runPolicy: this.runPolicy,
      reloadSessionResources: this.reloadSessionResources.bind(this),
      resolveExtensionUiResponse: this.resolveExtensionUiResponse.bind(this),
      handleExtensionUiInput: this.handleExtensionUiInput.bind(this),
    });
    if (command.type === "set_model") this.sessionModel.clear();
    return result;
  }

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
      } catch {}
    }
    notifyRunningChange();
  }
}
