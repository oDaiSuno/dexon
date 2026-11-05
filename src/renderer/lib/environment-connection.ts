import { createRpcClient, type PiRpc, type RpcClientPort } from "@contract/rpc";
import type { ApiMethod, ApiParams, ApiResult, StreamTopic, Streams } from "@contract/api";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentStatus } from "@contract/environment";
import type { DefaultThinkingLevel } from "@contract/types";
import type { SessionInfo } from "./types";
import { requestEnvironmentPort } from "./environment-port";

type LogicalSubscription = {
  topic: StreamTopic;
  key: string;
  listener: (event: Streams[StreamTopic]) => void;
  onGap?: () => void;
  unsubscribeCurrent?: () => void;
};

export interface EnvironmentApiTransport {
  call: PiRpc["call"];
  subscribe<T extends StreamTopic>(
    topic: T,
    key: string,
    listener: (event: Streams[T]) => void,
    onGap?: () => void,
  ): Promise<() => void>;
}

export class EnvironmentConnection implements EnvironmentApiTransport {
  private rpc: PiRpc | null = null;
  private pending: Promise<PiRpc> | null = null;
  private controller: AbortController | null = null;
  private readonly subscriptions = new Map<string, LogicalSubscription>();
  private nextSubscriptionId = 0;
  private epoch = 0;
  private connectedBefore = false;
  private recoveryNeeded = false;
  private status: EnvironmentStatus = { phase: "available" };
  readonly environmentId: EnvironmentId;
  private readonly onSessionsLoaded?: (sessions: SessionInfo[]) => void;
  private readonly onSessionCreated?: (sessionId: string) => void;
  generation = -1;

  constructor(
    environmentId: EnvironmentId,
    onSessionsLoaded?: (sessions: SessionInfo[]) => void,
    onSessionCreated?: (sessionId: string) => void,
  ) {
    this.environmentId = environmentId;
    this.onSessionsLoaded = onSessionsLoaded;
    this.onSessionCreated = onSessionCreated;
  }

  getRpc(): PiRpc | null {
    return this.rpc;
  }

  updateStatus(status: EnvironmentStatus): void {
    const previous = this.status;
    this.status = status;
    if (status.phase !== "connected") {
      if (this.rpc || this.pending) this.reset();
      return;
    }
    if (this.generation === status.generation && this.rpc) return;
    if (this.pending && previous.phase === "connected" && previous.generation === status.generation) return;
    const needed = this.rpc !== null || this.pending !== null || this.subscriptions.size > 0;
    this.reset();
    if (needed) void this.ensureRpc().catch(() => {});
  }

  ensureRpc(): Promise<PiRpc> {
    if (this.rpc) return Promise.resolve(this.rpc);
    if (this.pending) return this.pending;
    if (
      this.environmentId !== PRIMARY_ENVIRONMENT_ID &&
      this.status.phase !== "connected" &&
      this.status.phase !== "available"
    ) {
      return Promise.reject(new Error("Environment is not connected"));
    }
    const epoch = this.epoch;
    const expectedGeneration = this.status.phase === "connected" ? this.status.generation : undefined;
    const controller = new AbortController();
    this.controller = controller;
    const pending = requestEnvironmentPort(this.environmentId, controller.signal, expectedGeneration).then(
      ({ port, generation }) => {
        if (
          epoch !== this.epoch ||
          (generation !== undefined && expectedGeneration !== undefined && generation !== expectedGeneration)
        ) {
          port.close();
          throw new Error("Environment connection was superseded");
        }
        return this.replacePort(port, generation ?? expectedGeneration ?? 0);
      },
    );
    this.pending = pending;
    void pending
      .finally(() => {
        if (this.pending !== pending) return;
        this.pending = null;
        this.controller = null;
      })
      .catch(() => {});
    return pending;
  }

  replacePort(port: RpcClientPort, generation: number = this.generation + 1): PiRpc {
    this.reset();
    this.generation = generation;
    const client = createRpcClient(port);
    this.rpc = client;
    for (const entry of this.subscriptions.values()) {
      entry.unsubscribeCurrent = client.subscribe(entry.topic, entry.key, entry.listener);
    }
    const gap = this.connectedBefore || this.recoveryNeeded;
    this.connectedBefore = true;
    this.recoveryNeeded = false;
    if (gap) {
      for (const entry of this.subscriptions.values()) {
        try {
          entry.onGap?.();
        } catch {
          continue;
        }
      }
    }
    return client;
  }

  reconnect(): Promise<PiRpc> {
    this.reset();
    return this.ensureRpc();
  }

  reset(): void {
    this.epoch += 1;
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    for (const entry of this.subscriptions.values()) {
      entry.unsubscribeCurrent?.();
      entry.unsubscribeCurrent = undefined;
    }
    this.rpc?.close();
    this.rpc = null;
  }

  close(): void {
    this.reset();
    this.subscriptions.clear();
  }

  async call<M extends ApiMethod>(
    method: M,
    ...args: ApiParams<M> extends void ? [] | [void] : [ApiParams<M>]
  ): Promise<ApiResult<M>> {
    const client = await this.ensureRpc();
    const result = await client.call(method, ...(args as never));
    if (method === "sessions.list" && Array.isArray((result as ApiResult<"sessions.list">)?.sessions))
      this.onSessionsLoaded?.((result as ApiResult<"sessions.list">).sessions);
    if (method === "agent.new" && typeof (result as ApiResult<"agent.new">)?.sessionId === "string")
      this.onSessionCreated?.((result as ApiResult<"agent.new">).sessionId);
    return result;
  }

  async subscribe<T extends StreamTopic>(
    topic: T,
    key: string,
    listener: (event: Streams[T]) => void,
    onGap?: () => void,
  ): Promise<() => void> {
    const id = String(++this.nextSubscriptionId);
    const entry: LogicalSubscription = { topic, key, listener: listener as LogicalSubscription["listener"], onGap };
    this.subscriptions.set(id, entry);
    try {
      const client = await this.ensureRpc();
      if (this.subscriptions.has(id) && !entry.unsubscribeCurrent) {
        entry.unsubscribeCurrent = client.subscribe(topic, key, listener);
      }
    } catch (error) {
      if (!this.subscriptions.has(id)) throw error;
      this.recoveryNeeded = true;
    }
    return () => {
      this.subscriptions.delete(id);
      entry.unsubscribeCurrent?.();
      entry.unsubscribeCurrent = undefined;
    };
  }
}

export function createEnvironmentApiClient(connection: EnvironmentApiTransport) {
  const call: PiRpc["call"] = connection.call.bind(connection);
  const subscribe: EnvironmentApiTransport["subscribe"] = connection.subscribe.bind(connection);
  return {
    call,
    subscribe,
    listSessions: () => call("sessions.list"),
    getSession: (
      id: string,
      includeState?: boolean,
      traceId?: string,
      historyWindow?: ApiParams<"sessions.get">["historyWindow"],
    ) => call("sessions.get", { id, includeState, traceId, historyWindow }),
    getSessionContext: (id: string, leafId?: string, historyWindow?: ApiParams<"sessions.context">["historyWindow"]) =>
      call("sessions.context", { id, leafId, historyWindow }),
    getSessionContextPage: (id: string, cursor: string, maxTurns?: number, maxBytes?: number) =>
      call("sessions.contextPage", { id, cursor, maxTurns, maxBytes }),
    getSessionEntryContent: (id: string, entryId: string, blockIndex?: number) =>
      call("sessions.entryContent", { id, entryId, blockIndex }),
    exportSession: (id: string, format: "md" | "json" = "md") => call("sessions.export", { id, format }),
    deleteSession: (id: string) => call("sessions.delete", { id }),
    getSessionDescendants: (id: string) => call("sessions.descendants", { id }),
    renameSession: (id: string, name: string) => call("sessions.rename", { id, name }),
    newAgent: (params: ApiParams<"agent.new">) => call("agent.new", params),
    agentCommand: (sessionId: string, command: Record<string, unknown>) =>
      call("agent.command", { sessionId, command: command as never }),
    agentState: (sessionId: string) => call("agent.state", { sessionId }),
    listModels: (cwd?: string) => call("models.list", cwd ? { cwd } : undefined),
    refreshModels: (cwd: string | undefined, requestId: string) =>
      call("models.refresh", { ...(cwd ? { cwd } : {}), requestId }),
    cancelModelsRefresh: (requestId: string) => call("models.refreshCancel", { requestId }),
    getModelPreferences: (cwd?: string) => call("models.preferences.get", cwd ? { cwd } : undefined),
    setModelPreferences: (cwd: string | undefined, enabledModels: string[] | null) =>
      call("models.preferences.set", { ...(cwd ? { cwd } : {}), enabledModels }),
    getModelDefaults: (cwd?: string) => call("models.defaults.get", cwd ? { cwd } : undefined),
    setModelDefaults: (
      cwd: string | undefined,
      change: { model?: { provider: string; modelId: string }; thinkingLevel?: DefaultThinkingLevel },
    ) => call("models.defaults.set", { ...(cwd ? { cwd } : {}), ...change }),
    getProviderChannels: () => call("modelsConfig.channels.get"),
    setProviderChannelEnabled: (provider: string, enabled: boolean) =>
      call("modelsConfig.channels.setEnabled", { provider, enabled }),
    testProviderChannel: (provider: string) => call("modelsConfig.channels.test", { provider }),
    listWorktrees: (projectRoot: string) => call("worktrees.list", { projectRoot }),
    validateCwd: (path: string) => call("system.validateCwd", { path }),
    defaultCwd: () => call("system.defaultCwd"),
    getHome: () => call("system.home"),
    listFiles: (path: string) => call("files.list", { path }),
    readFile: (path: string, sourceSessionId?: string) => call("files.read", { path, sourceSessionId }),
    fileMeta: (path: string, sourceSessionId?: string) => call("files.meta", { path, sourceSessionId }),
    fileIndex: (root: string, query?: string) => call("files.index", { root, query }),
    subscribeAgentEvents: (sessionId: string, on: (event: Streams["agent.events"]) => void, onGap?: () => void) =>
      subscribe("agent.events", sessionId, on, onGap),
    subscribeRunning: (on: (event: Streams["agent.running"]) => void, onGap?: () => void) =>
      subscribe("agent.running", "*", on, onGap),
    subscribeSessionsChanged: (on: (event: Streams["sessions.changed"]) => void, onGap?: () => void) =>
      subscribe("sessions.changed", "*", on, onGap),
    subscribeAuthLogin: (provider: string, on: (event: Streams["auth.login"]) => void, onGap?: () => void) =>
      subscribe("auth.login", provider, on, onGap),
  };
}
