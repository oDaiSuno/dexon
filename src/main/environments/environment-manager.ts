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
import type { HostManager, HostStatus } from "../host-manager.ts";
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
  private readonly listeners = new Set<(environments: EnvironmentView[]) => void>();
  private primaryGeneration = 0;
  private primarySince = Date.now();
  private primaryDescriptor: EnvironmentDescriptor | null = null;
  private primaryStatus: HostStatus;
  private disposed = false;

  private readonly options: {
    hostManager: HostManager;
    userDataDir: string;
    onChanged?: (environments: EnvironmentView[]) => void;
    sshTunnelManager?: SshEnvironmentManager;
  };

  constructor(options: {
    hostManager: HostManager;
    userDataDir: string;
    onChanged?: (environments: EnvironmentView[]) => void;
    sshTunnelManager?: SshEnvironmentManager;
  }) {
    this.options = options;
    this.store = new EnvironmentStore(options.userDataDir);
    this.sshTunnelManager = options.sshTunnelManager ?? new SshEnvironmentManager();
    this.primaryStatus = options.hostManager.getStatus();
    this.primaryDescriptor = this.buildPrimaryDescriptor();
    if (options.onChanged) this.listeners.add(options.onChanged);
    for (const configuration of this.store.load()) this.register(configuration);
    queueMicrotask(() => {
      if (this.disposed) return;
      for (const { configuration, supervisor } of this.environments.values()) {
        if (configuration.enabled) void supervisor.connect();
      }
      this.notifyPrimaryStatus(this.options.hostManager.getStatus());
    });
  }

  listEnvironments(): EnvironmentView[] {
    const primary: EnvironmentView = {
      id: PRIMARY_ENVIRONMENT_ID,
      label: "Primary",
      enabled: true,
      target: { kind: "primary" },
      descriptor: this.primaryDescriptor,
      status:
        this.primaryStatus === "ready"
          ? { phase: "connected", generation: this.primaryGeneration, since: this.primarySince }
          : this.primaryStatus === "starting"
            ? { phase: "connecting", stage: "preparing", attempt: 1 }
            : { phase: "offline" },
    };
    return structuredClone([primary, ...[...this.environments.values()].map((entry) => this.view(entry))]);
  }

  async addEnvironment(input: AddEnvironmentInput): Promise<EnvironmentView> {
    this.assertActive();
    if (this.environments.size >= 100) throw new Error("Too many environments");
    const configuration = this.store.create(input);
    const key =
      configuration.target.kind === "ssh" ? targetConnectionKey(configuration.target) : configuration.target.url;
    for (const existing of this.environments.values()) {
      const target = existing.configuration.target;
      if (target.kind !== configuration.target.kind) continue;
      if ((target.kind === "ssh" ? targetConnectionKey(target) : target.url) === key)
        throw new Error("Environment target already exists");
    }
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

  removeEnvironment(environmentId: EnvironmentId): Promise<{ ok: boolean }> {
    return this.withEnvironmentLock(environmentId, async () => {
      this.assertActive();
      if (environmentId === PRIMARY_ENVIRONMENT_ID) throw new Error("The Primary environment cannot be removed");
      const entry = this.environments.get(environmentId);
      if (!entry) return { ok: false };
      await entry.supervisor.dispose();
      this.environments.delete(environmentId);
      try {
        this.persist();
      } catch (error) {
        const replacement = this.register(entry.configuration);
        if (entry.configuration.enabled) void replacement.supervisor.connect();
        throw error;
      }
      this.emit();
      return { ok: true };
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
          { environmentId: PRIMARY_ENVIRONMENT_ID, generation: this.primaryGeneration },
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

  notifyPrimaryStatus(status: HostStatus): void {
    if (this.disposed) return;
    if (status === "ready" && (this.primaryStatus !== "ready" || this.primaryGeneration === 0)) {
      this.primaryGeneration += 1;
      this.primarySince = Date.now();
    }
    this.primaryStatus = status;
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

  subscribe(listener: (environments: EnvironmentView[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    await Promise.all([
      this.sshTunnelManager.dispose(),
      ...[...this.environments.values()].map((entry) => entry.supervisor.dispose()),
    ]);
    await Promise.all([...this.locks.values()]);
  }

  private register(configuration: StoredEnvironment): EnvironmentEntry {
    const supervisor = new EnvironmentSupervisor({
      configuration,
      sshTunnelManager: this.sshTunnelManager,
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
    };
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(this.listEnvironments());
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
