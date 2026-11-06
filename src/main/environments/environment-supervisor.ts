import {
  DEFAULT_LIFECYCLE_POLICY,
  type LifecyclePolicy,
  type RemoteRuntimeMeta,
} from "../../contract/environment-commands.ts";
import { closeModeFor, type EnvironmentCloseMode } from "./environment-lifecycle.ts";
import type {
  EnvironmentDescriptor,
  SshEnvironmentTarget,
  WebSocketEnvironmentTarget,
} from "../../contract/environment.ts";
import { evaluateHeartbeatTick } from "../../shared/heartbeat-liveness.ts";
import {
  fetchUnauthenticatedDescriptor,
  openRemoteConnection,
  resolveWebSocketTarget,
  type RemoteConnection,
  type RemoteEndpoint,
} from "./remote-endpoint.ts";
import type { SshEnvironmentManager } from "./ssh-tunnel-manager.ts";
import {
  EnvironmentConnectionError,
  initialSupervisorState,
  QUICK_PROBE_TIMEOUT_MS,
  reduceSupervisor,
  REMOTE_SILENT_SOCKET_AFTER_MS,
  SILENT_SOCKET_CHECK_AFTER_MS,
  SILENT_SOCKET_RECHECK_EVERY_MS,
  type SupervisorEvent,
} from "./supervisor-policy.ts";

export type EnvironmentWakeupReason = "resume" | "network-changed" | "application-active";

export interface RemoteEnvironmentConfiguration {
  target: SshEnvironmentTarget | WebSocketEnvironmentTarget;
  authToken?: string;
}

export class EnvironmentSupervisor {
  state = initialSupervisorState();
  connection: RemoteConnection | null = null;
  descriptor: EnvironmentDescriptor | null = null;
  runtime: RemoteRuntimeMeta | null = null;
  private enabled = false;
  private disposed = false;
  private epoch = 0;
  private task: Promise<void> | null = null;
  private attemptController: AbortController | null = null;
  private openingConnection: RemoteConnection | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private silentTimer: ReturnType<typeof setTimeout> | null = null;
  private probePending = false;
  private lastProbeAt = 0;
  private lastAcknowledgedAt = 0;
  private lastTickAt = 0;

  private readonly options: {
    policy?: () => LifecyclePolicy;
    configuration: RemoteEnvironmentConfiguration;
    sshTunnelManager: SshEnvironmentManager;
    onBound: (descriptor: EnvironmentDescriptor) => void;
    onChange: () => void;
  };

  constructor(options: {
    policy?: () => LifecyclePolicy;
    configuration: RemoteEnvironmentConfiguration;
    sshTunnelManager: SshEnvironmentManager;
    onBound: (descriptor: EnvironmentDescriptor) => void;
    onChange: () => void;
  }) {
    this.options = options;
  }

  connect(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.enabled = true;
    if (this.connection || this.task) return this.task ?? Promise.resolve();
    this.clearTimers();
    this.publish({ type: "disconnect" });
    return this.startAttempt();
  }

  async disconnect(mode = closeModeFor("disconnect", this.policy)): Promise<void> {
    this.enabled = false;
    this.epoch += 1;
    this.releaseConnection();
    this.publish({ type: "disconnect" });
    await this.task;
    const { target } = this.options.configuration;
    if (target.kind === "ssh") await this.options.sshTunnelManager.closeTunnel(target, mode);
  }

  async dispose(mode: EnvironmentCloseMode = "disconnect"): Promise<void> {
    this.disposed = true;
    await this.disconnect(mode);
  }

  wakeup(_reason: EnvironmentWakeupReason): void {
    if (
      !this.enabled ||
      this.disposed ||
      this.state.status.phase === "blocked" ||
      (!this.policy.autoReconnect && !this.connection)
    )
      return;
    if (this.connection) {
      this.lastTickAt = Date.now();
      this.lastAcknowledgedAt = this.lastTickAt;
      this.probe(this.connection);
    } else if (!this.task) {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      void this.startAttempt();
    }
  }

  private get policy(): LifecyclePolicy {
    return this.options.policy?.() ?? DEFAULT_LIFECYCLE_POLICY;
  }

  policyChanged(): void {
    if (!this.policy.autoReconnect && this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.publish({ type: "policy-changed" });
    if (
      this.policy.autoReconnect &&
      this.enabled &&
      this.state.status.phase === "offline" &&
      this.state.status.lastFailure &&
      !this.task
    )
      void this.startAttempt();
  }

  private publish(event: SupervisorEvent): void {
    const next = reduceSupervisor(this.state, event, this.policy);
    if (next === this.state) return;
    const previousStatus = this.state.status;
    this.state = next;
    if (next.status !== previousStatus) this.options.onChange();
  }

  private startAttempt(): Promise<void> {
    if (!this.enabled || this.disposed || this.task) return this.task ?? Promise.resolve();
    const epoch = ++this.epoch;
    this.publish({ type: "start" });
    const controller = new AbortController();
    this.attemptController = controller;
    this.task = this.attempt(epoch, controller.signal).finally(() => {
      if (this.attemptController === controller) this.attemptController = null;
      this.task = null;
    });
    return this.task;
  }

  private async attempt(epoch: number, signal: AbortSignal): Promise<void> {
    let connection: RemoteConnection | null = null;
    const current = () => this.enabled && !this.disposed && epoch === this.epoch;
    try {
      const configuration = this.options.configuration;
      const target = configuration.target;
      const endpoint: RemoteEndpoint =
        target.kind === "ssh"
          ? await this.options.sshTunnelManager.ensureTunnel(target, signal, (stage, progress) => {
              if (current()) this.publish({ type: "stage", stage, progress });
            })
          : resolveWebSocketTarget(target, configuration.authToken);
      if (!current()) return;
      this.publish({ type: "stage", stage: "verifying" });
      const descriptor = await fetchUnauthenticatedDescriptor(
        endpoint.httpBaseUrl,
        target.expectedEnvironmentId,
        undefined,
        signal,
      );
      if (!current()) return;
      this.options.onBound(descriptor);
      this.publish({ type: "stage", stage: "opening" });
      connection = await openRemoteConnection(endpoint, descriptor, signal);
      if (!current()) return;
      this.openingConnection = connection;
      this.publish({ type: "stage", stage: "synchronizing" });
      const pong = await connection.rpc.call("host.ping");
      if (!pong?.ok)
        throw new EnvironmentConnectionError("transient", "remote-unavailable", "Remote Host did not acknowledge ping");
      if (!current()) return;
      this.openingConnection = null;
      this.connection = connection;
      this.descriptor = descriptor;
      this.runtime =
        "runtime" in endpoint
          ? (endpoint.runtime as RemoteRuntimeMeta)
          : descriptor.runtime
            ? { ...descriptor.runtime, ownership: "external", updatePending: false }
            : null;
      this.publish({ type: "connected", now: Date.now() });
      connection.channel.onClose(() => {
        if (this.connection === connection)
          this.fail(new EnvironmentConnectionError("transient", "transport", "Remote WebSocket closed"));
      });
      if (this.connection === connection) this.monitor(connection);
    } catch (error) {
      if (current()) this.fail(error);
    } finally {
      if (this.openingConnection === connection) this.openingConnection = null;
      if (connection && this.connection !== connection) connection.close();
    }
  }

  private fail(error: unknown): void {
    this.epoch += 1;
    this.releaseConnection();
    if (!this.enabled || this.disposed) return;
    this.publish({ type: "failure", error, now: Date.now() });
    if (this.state.status.phase === "backoff") {
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = null;
          void this.startAttempt();
        },
        Math.max(0, this.state.status.retryAt - Date.now()),
      );
      this.retryTimer.unref();
    }
  }

  private monitor(connection: RemoteConnection): void {
    this.lastTickAt = Date.now();
    this.lastAcknowledgedAt = this.lastTickAt;
    this.lastProbeAt = this.lastTickAt;
    this.heartbeatTimer = setInterval(() => {
      if (this.connection !== connection) return;
      const now = Date.now();
      const heartbeat = evaluateHeartbeatTick({
        now,
        lastTickAt: this.lastTickAt,
        lastAcknowledgedAt: this.lastAcknowledgedAt,
        intervalMs: 15_000,
        timeoutMs: 15_000,
      });
      this.lastTickAt = now;
      if (heartbeat.clockDiscontinuity) this.lastAcknowledgedAt = now;
      if (heartbeat.timedOut) {
        this.fail(new EnvironmentConnectionError("transient", "timeout", "Remote heartbeat timed out"));
        return;
      }
      this.publish({ type: "tick", now });
      if (heartbeat.clockDiscontinuity || now - this.lastProbeAt >= 15_000) this.probe(connection);
    }, 1_000);
    this.heartbeatTimer.unref();
  }

  private probe(connection: RemoteConnection): void {
    if (this.probePending || this.connection !== connection) return;
    this.probePending = true;
    this.lastProbeAt = Date.now();
    const framesBefore = connection.wsPort.inboundFrames;
    this.publish({ type: "probe", unanswered: true });
    this.silentTimer = setTimeout(() => {
      void this.checkSilentSocket(connection, framesBefore);
    }, SILENT_SOCKET_CHECK_AFTER_MS);
    this.silentTimer.unref();
    void connection.rpc
      .call("host.ping")
      .then((pong) => {
        if (this.connection !== connection) return;
        if (!pong?.ok)
          throw new EnvironmentConnectionError(
            "transient",
            "remote-unavailable",
            "Remote Host did not acknowledge ping",
          );
        this.probePending = false;
        this.lastAcknowledgedAt = Date.now();
        if (this.silentTimer) clearTimeout(this.silentTimer);
        this.silentTimer = null;
        this.publish({ type: "probe", unanswered: false });
      })
      .catch((error) => {
        if (this.connection === connection) this.fail(error);
      });
  }

  private async checkSilentSocket(connection: RemoteConnection, framesBefore: number): Promise<void> {
    this.silentTimer = null;
    if (this.connection !== connection || !this.probePending) return;
    try {
      if (
        Date.now() - this.lastProbeAt >= REMOTE_SILENT_SOCKET_AFTER_MS &&
        connection.wsPort.inboundFrames === framesBefore
      ) {
        await fetchUnauthenticatedDescriptor(
          connection.httpBaseUrl,
          connection.descriptor.environmentId,
          QUICK_PROBE_TIMEOUT_MS,
        );
        if (this.connection === connection && this.probePending && connection.wsPort.inboundFrames === framesBefore) {
          this.epoch += 1;
          this.releaseConnection();
          if (this.policy.autoReconnect) {
            this.publish({ type: "silent-socket" });
            void this.startAttempt();
          } else this.fail(new EnvironmentConnectionError("transient", "silent-socket", "Remote socket is silent"));
          return;
        }
      }
    } catch {
      if (this.connection !== connection) return;
    }
    if (this.connection === connection && this.probePending) {
      this.silentTimer = setTimeout(() => {
        void this.checkSilentSocket(connection, framesBefore);
      }, SILENT_SOCKET_RECHECK_EVERY_MS);
      this.silentTimer.unref();
    }
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.silentTimer) clearTimeout(this.silentTimer);
    this.retryTimer = null;
    this.heartbeatTimer = null;
    this.silentTimer = null;
  }

  private releaseConnection(): void {
    this.clearTimers();
    this.attemptController?.abort();
    this.attemptController = null;
    const connection = this.connection;
    const opening = this.openingConnection;
    this.connection = null;
    this.openingConnection = null;
    this.probePending = false;
    opening?.close();
    connection?.close();
  }
}
