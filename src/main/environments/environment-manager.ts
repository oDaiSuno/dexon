import { planEnvironmentUpdate } from "./environment-editing.ts";
import { closeModeFor, removeWithChoice, shutdownAll } from "./environment-lifecycle.ts";
import { testEnvironment } from "./environment-tester.ts";
import { discoverSshHosts } from "./ssh-config-discovery.ts";
import {
  type LifecyclePolicy,
  type RemoteDaemonChoice,
  type RemoveOutcome,
  type EnvironmentDraft,
  type EnvironmentsSnapshot,
} from "../../contract/environment-commands.ts";
import { homedir } from "node:os";
import { MessageChannelMain, type WebContents } from "electron";
import {
  DEXON_ENVIRONMENT_PROTOCOL_VERSION,
  PRIMARY_ENVIRONMENT_ID,
  type AddEnvironmentInput,
  type EnvironmentDescriptor,
  type EnvironmentId,
  type EnvironmentView,
} from "../../contract/environment.ts";
import type { HostManager } from "../host-manager.ts";
import { EnvironmentStore, type StoredEnvironment } from "./environment-store.ts";
import { EnvironmentSupervisor, type EnvironmentWakeupReason } from "./environment-supervisor.ts";
import { bridgeRendererPort } from "./renderer-port-bridge.ts";
import { targetConnectionKey } from "./ssh-scripts.ts";
import { SshEnvironmentManager } from "./ssh-tunnel-manager.ts";
import { EnvironmentConnectionError } from "./supervisor-policy.ts";

interface EnvironmentEntry {
  configuration: StoredEnvironment;
  supervisor: EnvironmentSupervisor;
}

export class EnvironmentManager {
  private readonly store: EnvironmentStore;
  private readonly sshTunnelManager: SshEnvironmentManager;
  private readonly environments = new Map<EnvironmentId, EnvironmentEntry>();
  private readonly locks = new Map<EnvironmentId, Promise<void>>();
  private readonly listeners = new Set<(snapshot: EnvironmentsSnapshot) => void>();
  private revision = 0;
  private primaryDescriptor: EnvironmentDescriptor | null = null;
  private disposed = false;

  private readonly options: {
    hostManager: HostManager;
    userDataDir: string;
    onChanged?: (snapshot: EnvironmentsSnapshot) => void;
    sshTunnelManager?: SshEnvironmentManager;
    payloadDirectory?: string;
  };

  constructor(options: {
    hostManager: HostManager;
    userDataDir: string;
    onChanged?: (snapshot: EnvironmentsSnapshot) => void;
    sshTunnelManager?: SshEnvironmentManager;
    payloadDirectory?: string;
  }) {
    this.options = options;
    this.store = new EnvironmentStore(options.userDataDir);
    this.sshTunnelManager =
      options.sshTunnelManager ?? new SshEnvironmentManager({ payloadDirectory: options.payloadDirectory });
    this.primaryDescriptor = this.buildPrimaryDescriptor();
    if (options.onChanged) this.listeners.add(options.onChanged);
    for (const configuration of this.store.load()) this.register(configuration);
    queueMicrotask(() => {
      if (this.disposed) return;
      for (const { configuration, supervisor } of this.environments.values()) {
        if (configuration.enabled) void supervisor.connect();
      }
      this.notifyPrimaryStatus();
    });
  }

  listEnvironments(): EnvironmentView[] {
    const host = this.options.hostManager;
    const primary: EnvironmentView = {
      id: PRIMARY_ENVIRONMENT_ID,
      label: "Primary",
      enabled: true,
      target: { kind: "primary" },
      descriptor: this.primaryDescriptor,
      status:
        host.getStatus() === "ready"
          ? { phase: "connected", generation: host.getGeneration(), since: host.getReadySince()! }
          : host.getStatus() === "starting"
            ? { phase: "connecting", stage: "authenticating", attempt: 1, progress: null }
            : { phase: "offline", lastFailure: null },
    };
    return structuredClone([primary, ...[...this.environments.values()].map((entry) => this.view(entry))]);
  }

  snapshot(): EnvironmentsSnapshot {
    return { revision: this.revision, policy: { ...this.store.policy }, environments: this.listEnvironments() };
  }

  async addEnvironment(input: AddEnvironmentInput): Promise<EnvironmentView> {
    this.assertActive();
    if (this.environments.size >= 100) throw new Error("Too many environments");
    const configuration = this.store.create(input);
    this.assertUniqueTarget(configuration);
    const entry = this.register(configuration);
    try {
      this.persist();
    } catch (error) {
      this.environments.delete(configuration.id);
      throw error;
    }
    this.emit();
    if (configuration.enabled) void entry.supervisor.connect();
    return structuredClone(this.view(entry));
  }

  removeEnvironment(environmentId: EnvironmentId, choice: RemoteDaemonChoice = "keep"): Promise<RemoveOutcome> {
    return this.withEnvironmentLock(environmentId, async () => {
      this.assertActive();
      if (environmentId === PRIMARY_ENVIRONMENT_ID) throw new Error("The Primary environment cannot be removed");
      const entry = this.requireEnvironment(environmentId);
      return removeWithChoice(choice, {
        stopManaged: () =>
          entry.configuration.target.kind === "ssh"
            ? this.sshTunnelManager.stopRemoteDaemon(entry.configuration.target)
            : Promise.resolve("not-owned"),
        disconnect: () => entry.supervisor.dispose("disconnect"),
        remove: () => {
          this.environments.delete(environmentId);
          try {
            this.persist();
          } catch (error) {
            const replacement = this.register(entry.configuration);
            if (entry.configuration.enabled) void replacement.supervisor.connect();
            throw error;
          }
          this.emit();
        },
      });
    });
  }

  updateEnvironment(environmentId: EnvironmentId, draft: EnvironmentDraft): Promise<EnvironmentView> {
    return this.withEnvironmentLock(environmentId, async () => {
      this.assertActive();
      const entry = this.requireEnvironment(environmentId);
      const plan = planEnvironmentUpdate(entry.configuration, draft);
      this.assertUniqueTarget(plan.configuration, environmentId);
      const previous = entry.configuration;
      entry.configuration = plan.configuration;
      try {
        this.persist();
      } catch (error) {
        entry.configuration = previous;
        throw error;
      }
      if (plan.reconnect) {
        await entry.supervisor.dispose("disconnect");
        const next = this.register(plan.configuration);
        if (plan.configuration.enabled) void next.supervisor.connect();
      } else {
        Object.assign(previous, plan.configuration);
        entry.configuration = previous;
      }
      this.emit();
      return structuredClone(this.view(this.requireEnvironment(environmentId)));
    });
  }

  test(subject: { environmentId: EnvironmentId } | { draft: EnvironmentDraft }) {
    this.assertActive();
    return testEnvironment(
      "draft" in subject ? subject.draft : this.requireEnvironment(subject.environmentId).configuration,
      this.sshTunnelManager,
    );
  }

  discoverSshHosts() {
    this.assertActive();
    return discoverSshHosts([...this.environments.values()].map((entry) => entry.configuration));
  }

  async setPolicy(patch: Partial<LifecyclePolicy>): Promise<LifecyclePolicy> {
    this.assertActive();
    const policy = { ...this.store.policy, ...patch };
    this.store.save(
      [...this.environments.values()].map((entry) => entry.configuration),
      policy,
    );
    for (const entry of this.environments.values()) entry.supervisor.policyChanged();
    this.emit();
    return { ...policy };
  }

  trust(environmentId: EnvironmentId, trust: "host-key" | "environment-identity"): Promise<EnvironmentView> {
    return this.withEnvironmentLock(environmentId, async () => {
      this.assertActive();
      const entry = this.requireEnvironment(environmentId);
      const status = entry.supervisor.state.status;
      const diagnosis = status.phase === "blocked" ? status.diagnosis : null;
      if (trust === "host-key") {
        if (entry.configuration.target.kind !== "ssh" || diagnosis?.reason !== "host-key-changed")
          throw new Error("No changed SSH host key to trust");
        await this.sshTunnelManager.trustHostKey(
          entry.configuration.target,
          diagnosis.knownHost,
          diagnosis.knownHostsFile,
        );
      } else {
        if (diagnosis?.reason !== "identity-mismatch") throw new Error("No changed environment identity to trust");
        const previous = entry.configuration.target.expectedEnvironmentId;
        delete entry.configuration.target.expectedEnvironmentId;
        try {
          this.persist();
        } catch (error) {
          entry.configuration.target.expectedEnvironmentId = previous;
          throw error;
        }
      }
      this.setEnabled(entry, true);
      await entry.supervisor.connect();
      return structuredClone(this.view(entry));
    });
  }

  restartDaemon(environmentId: EnvironmentId): Promise<EnvironmentView> {
    return this.withEnvironmentLock(environmentId, async () => {
      this.assertActive();
      const entry = this.requireEnvironment(environmentId);
      if (entry.configuration.target.kind !== "ssh") throw new Error("Only managed SSH daemons can be restarted");
      const outcome = await this.sshTunnelManager.stopRemoteDaemon(entry.configuration.target);
      if (outcome !== "stopped") throw new Error("The remote daemon is not managed by this desktop");
      await entry.supervisor.disconnect("disconnect");
      this.setEnabled(entry, true);
      await entry.supervisor.connect();
      return structuredClone(this.view(entry));
    });
  }

  connectEnvironment(environmentId: EnvironmentId): Promise<EnvironmentView> {
    return this.withEnvironmentLock(environmentId, async () => {
      this.assertActive();
      if (environmentId === PRIMARY_ENVIRONMENT_ID) return this.listEnvironments()[0];
      const entry = this.requireEnvironment(environmentId);
      this.setEnabled(entry, true);
      await entry.supervisor.connect();
      return structuredClone(this.view(entry));
    });
  }

  disconnectEnvironment(environmentId: EnvironmentId): Promise<EnvironmentView> {
    return this.withEnvironmentLock(environmentId, async () => {
      this.assertActive();
      if (environmentId === PRIMARY_ENVIRONMENT_ID) return this.listEnvironments()[0];
      const entry = this.requireEnvironment(environmentId);
      this.setEnabled(entry, false);
      await entry.supervisor.disconnect();
      return structuredClone(this.view(entry));
    });
  }

  attachRendererEnvironmentPort(environmentId: EnvironmentId, sender: WebContents): void {
    this.assertActive();
    if (typeof environmentId !== "string" || sender.isDestroyed()) throw new Error("Invalid environment port request");
    if (environmentId === PRIMARY_ENVIRONMENT_ID) {
      const { port1 } = this.options.hostManager.createRendererChannel();
      try {
        sender.postMessage(
          "desktop:host-port",
          { environmentId: PRIMARY_ENVIRONMENT_ID, generation: this.options.hostManager.getGeneration() },
          [port1],
        );
      } catch (error) {
        port1.close();
        throw error;
      }
      return;
    }
    const entry = this.requireEnvironment(environmentId);
    const connection = entry.supervisor.connection;
    if (!connection || entry.supervisor.state.status.phase !== "connected")
      throw new Error("Environment is not connected");
    const { port1, port2 } = new MessageChannelMain();
    const close = bridgeRendererPort(port2, connection.channel);
    sender.once("destroyed", close);
    port2.once("close", () => sender.removeListener("destroyed", close));
    try {
      sender.postMessage("desktop:host-port", { environmentId, generation: entry.supervisor.state.generation }, [
        port1,
      ]);
    } catch (error) {
      close();
      port1.close();
      throw error;
    }
  }

  notifyWakeup(reason: EnvironmentWakeupReason): void {
    if (this.disposed) return;
    for (const entry of this.environments.values()) entry.supervisor.wakeup(reason);
  }

  notifyPrimaryStatus(): void {
    if (this.disposed) return;
    this.primaryDescriptor = this.buildPrimaryDescriptor();
    this.emit();
  }

  private buildPrimaryDescriptor(): EnvironmentDescriptor {
    const os = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
    return {
      environmentId: PRIMARY_ENVIRONMENT_ID,
      label: "Primary",
      protocolVersion: DEXON_ENVIRONMENT_PROTOCOL_VERSION,
      serverVersion: this.options.hostManager.getPiVersion() ?? "0.0.0",
      platform: {
        os,
        arch: process.arch,
        pathStyle: os === "win32" ? "win32" : "posix",
        home: homedir(),
      },
      capabilities: {
        browser: true,
        nativeDialogs: true,
        revealInFileManager: true,
        managedProcesses: true,
        toolchainInstall: true,
      },
    };
  }

  subscribe(listener: (snapshot: EnvironmentsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    await shutdownAll(
      [...this.environments.values()].map(
        (entry) => () => entry.supervisor.dispose(closeModeFor("shutdown", this.store.policy)),
      ),
    );
    await shutdownAll(
      [() => this.sshTunnelManager.dispose(), ...[...this.locks.values()].map((lock) => () => lock)],
      0,
    );
  }

  async dispose(): Promise<void> {
    await this.shutdown();
  }

  private register(configuration: StoredEnvironment): EnvironmentEntry {
    const supervisor = new EnvironmentSupervisor({
      configuration,
      sshTunnelManager: this.sshTunnelManager,
      policy: () => this.store.policy,
      onBound: (descriptor) => {
        for (const entry of this.environments.values()) {
          if (
            entry.configuration.id !== configuration.id &&
            entry.configuration.target.expectedEnvironmentId === descriptor.environmentId
          ) {
            throw new EnvironmentConnectionError(
              "blocked",
              "configuration",
              "Remote environment identity is already registered",
            );
          }
        }
        if (configuration.target.expectedEnvironmentId === descriptor.environmentId) return;
        configuration.target.expectedEnvironmentId = descriptor.environmentId;
        try {
          this.persist();
        } catch (error) {
          delete configuration.target.expectedEnvironmentId;
          throw error;
        }
      },
      onChange: () => this.emit(),
    });
    const entry = { configuration, supervisor };
    this.environments.set(configuration.id, entry);
    return entry;
  }

  private assertUniqueTarget(configuration: StoredEnvironment, excludedId?: string): void {
    const key =
      configuration.target.kind === "ssh" ? targetConnectionKey(configuration.target) : configuration.target.url;
    for (const existing of this.environments.values()) {
      if (existing.configuration.id === excludedId) continue;
      const target = existing.configuration.target;
      if (target.kind !== configuration.target.kind) continue;
      if ((target.kind === "ssh" ? targetConnectionKey(target) : target.url) === key)
        throw new Error("Environment target already exists");
    }
  }

  private requireEnvironment(environmentId: EnvironmentId): EnvironmentEntry {
    if (typeof environmentId !== "string") throw new Error("Invalid environment ID");
    const entry = this.environments.get(environmentId);
    if (!entry) throw new Error("Unknown environment ID");
    return entry;
  }

  private view({ configuration, supervisor }: EnvironmentEntry): EnvironmentView {
    return {
      id: configuration.id,
      label: configuration.label,
      enabled: configuration.enabled,
      target: configuration.target,
      status: supervisor.state.status,
      descriptor: supervisor.descriptor,
      runtime: supervisor.runtime,
    };
  }

  private emit(): void {
    if (this.disposed) return;
    this.revision += 1;
    for (const listener of this.listeners) listener(this.snapshot());
  }

  private persist(): void {
    this.store.save([...this.environments.values()].map((entry) => entry.configuration));
  }

  private setEnabled(entry: EnvironmentEntry, enabled: boolean): void {
    const previous = entry.configuration.enabled;
    entry.configuration.enabled = enabled;
    try {
      this.persist();
    } catch (error) {
      entry.configuration.enabled = previous;
      throw error;
    }
    this.emit();
  }

  private async withEnvironmentLock<T>(environmentId: EnvironmentId, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(environmentId) ?? Promise.resolve();
    const running = previous.then(fn);
    const settled = running.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(environmentId, settled);
    try {
      return await running;
    } finally {
      if (this.locks.get(environmentId) === settled) this.locks.delete(environmentId);
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Environment manager is disposed");
  }
}
