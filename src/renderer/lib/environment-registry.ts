import { useSyncExternalStore } from "react";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentView } from "@contract/environment";
import {
  DEFAULT_LIFECYCLE_POLICY,
  type EnvironmentCommand,
  type EnvironmentCommandResult,
  type EnvironmentsSnapshot,
} from "@contract/environment-commands";
import { workspaceStore } from "./workspace-store";
import type { PiBridge } from "@contract/desktop";
import type { SessionInfo } from "./types";
import { EnvironmentConnection } from "./environment-connection";
import { environmentAffordances } from "./environment-affordances";

export const defaultPrimaryEnvironmentView: EnvironmentView = {
  id: PRIMARY_ENVIRONMENT_ID,
  label: "Primary",
  enabled: true,
  target: { kind: "primary" },
  status: { phase: "available" },
  descriptor: null,
};

export class EnvironmentRegistry {
  private views: EnvironmentView[] = [defaultPrimaryEnvironmentView];
  private snapshot: EnvironmentsSnapshot = { revision: -1, policy: DEFAULT_LIFECYCLE_POLICY, environments: this.views };
  private readonly connections = new Map<EnvironmentId, EnvironmentConnection>();
  private readonly sessionOwners = new Map<string, Set<EnvironmentId>>();
  private readonly environmentSessions = new Map<EnvironmentId, Set<string>>();
  private readonly listeners = new Set<() => void>();
  private bridge: PiBridge | undefined;
  private offChanges: (() => void) | undefined;
  private revision = 0;

  initialize = (): void => {
    const bridge = typeof window === "undefined" ? undefined : window.piBridge;
    if (this.bridge === bridge) return;
    this.offChanges?.();
    this.offChanges = undefined;
    this.bridge = bridge;
    const revision = ++this.revision;
    this.snapshot = { revision: -1, policy: DEFAULT_LIFECYCLE_POLICY, environments: [defaultPrimaryEnvironmentView] };
    this.replaceViews([defaultPrimaryEnvironmentView]);
    if (typeof bridge?.listEnvironments !== "function") return;
    void workspaceStore.initialize(bridge);
    if (typeof bridge.onEnvironmentsChanged === "function") {
      this.offChanges = bridge.onEnvironmentsChanged((views) => {
        if (this.bridge !== bridge) return;
        this.revision += 1;
        this.acceptSnapshot(views);
      });
    }
    void bridge
      .listEnvironments()
      .then((views) => {
        if (this.bridge === bridge && this.revision === revision) this.acceptSnapshot(views);
      })
      .catch(() => {});
  };

  getEnvironments = (): EnvironmentView[] => this.views;
  getActiveEnvironmentId = (): EnvironmentId => workspaceStore.getSnapshot().focus.environmentId;
  getActiveEnvironment = (): EnvironmentView =>
    this.views.find((view) => view.id === this.getActiveEnvironmentId()) ?? defaultPrimaryEnvironmentView;

  subscribe = (listener: () => void): (() => void) => {
    this.initialize();
    this.listeners.add(listener);
    const offFocus = workspaceStore.subscribe(listener);
    return () => {
      offFocus();
      this.listeners.delete(listener);
    };
  };

  findConnection(id: EnvironmentId): EnvironmentConnection | undefined {
    return this.connections.get(id);
  }

  getConnection(id: EnvironmentId): EnvironmentConnection {
    this.initialize();
    let connection = this.connections.get(id);
    if (!connection) {
      connection = new EnvironmentConnection(
        id,
        (sessions) => this.registerSessions(id, sessions),
        (sessionId) => this.registerSession(id, sessionId),
      );
      this.connections.set(id, connection);
      const view = this.views.find((item) => item.id === id);
      if (view) connection.updateStatus(view.status);
    }
    return connection;
  }

  registerSessions(id: EnvironmentId, sessions: readonly Pick<SessionInfo, "id">[]): void {
    for (const sessionId of this.environmentSessions.get(id) ?? []) {
      const owners = this.sessionOwners.get(sessionId);
      owners?.delete(id);
      if (!owners?.size) this.sessionOwners.delete(sessionId);
    }
    const sessionIds = new Set(sessions.map((session) => session.id));
    this.environmentSessions.set(id, sessionIds);
    for (const sessionId of sessionIds) {
      const owners = this.sessionOwners.get(sessionId) ?? new Set<EnvironmentId>();
      owners.add(id);
      this.sessionOwners.set(sessionId, owners);
    }
  }

  registerSession(id: EnvironmentId, sessionId: string): void {
    const sessionIds = this.environmentSessions.get(id) ?? new Set<string>();
    sessionIds.add(sessionId);
    this.environmentSessions.set(id, sessionIds);
    const owners = this.sessionOwners.get(sessionId) ?? new Set<EnvironmentId>();
    owners.add(id);
    this.sessionOwners.set(sessionId, owners);
  }

  getSessionEnvironmentId(sessionId: string): EnvironmentId {
    const owners = this.sessionOwners.get(sessionId);
    if (owners?.has(this.getActiveEnvironmentId())) return this.getActiveEnvironmentId();
    return owners?.values().next().value ?? this.getActiveEnvironmentId();
  }

  async runCommand<C extends EnvironmentCommand>(command: C): Promise<EnvironmentCommandResult<C>> {
    this.initialize();
    if (typeof this.bridge?.environmentCommand !== "function") throw new Error("Remote environments are unavailable");
    const result = await this.bridge.environmentCommand(command);
    if (command.type === "remove") workspaceStore.unmountEnvironment(command.environmentId);
    const snapshot = await this.bridge.listEnvironments();
    this.acceptSnapshot(snapshot);
    return result;
  }

  getSnapshot = (): EnvironmentsSnapshot => this.snapshot;

  private acceptSnapshot(snapshot: EnvironmentsSnapshot): void {
    if (snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot;
    this.replaceViews(snapshot.environments);
  }

  private replaceViews(views: EnvironmentView[]): void {
    this.views = views.some((view) => view.id === PRIMARY_ENVIRONMENT_ID)
      ? views
      : [defaultPrimaryEnvironmentView, ...views];
    const ids = new Set(this.views.map((view) => view.id));
    for (const [id, connection] of this.connections) {
      if (!ids.has(id)) {
        connection.close();
        this.connections.delete(id);
        this.registerSessions(id, []);
        this.environmentSessions.delete(id);
      }
    }
    for (const view of this.views) this.connections.get(view.id)?.updateStatus(view.status);

    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const environmentRegistry = new EnvironmentRegistry();
export const getEnvironmentConnection = (id: EnvironmentId) => environmentRegistry.getConnection(id);
export const getActiveEnvironmentId = () => environmentRegistry.getActiveEnvironmentId();
export const getActiveEnvironmentConnection = () => getEnvironmentConnection(getActiveEnvironmentId());
export const getSessionEnvironmentId = (sessionId: string) => environmentRegistry.getSessionEnvironmentId(sessionId);
export const registerEnvironmentSession = (id: EnvironmentId, sessionId: string) =>
  environmentRegistry.registerSession(id, sessionId);
export const registerEnvironmentSessions = (id: EnvironmentId, sessions: readonly Pick<SessionInfo, "id">[]) =>
  environmentRegistry.registerSessions(id, sessions);
export const runEnvironmentCommand = <C extends EnvironmentCommand>(command: C) =>
  environmentRegistry.runCommand(command);
export function useEnvironmentsSnapshot(): EnvironmentsSnapshot {
  return useSyncExternalStore(
    environmentRegistry.subscribe,
    environmentRegistry.getSnapshot,
    environmentRegistry.getSnapshot,
  );
}

export function useEnvironments(): EnvironmentView[] {
  return useSyncExternalStore(
    environmentRegistry.subscribe,
    environmentRegistry.getEnvironments,
    environmentRegistry.getEnvironments,
  );
}

export function useActiveEnvironment(): EnvironmentView {
  return useSyncExternalStore(
    environmentRegistry.subscribe,
    environmentRegistry.getActiveEnvironment,
    environmentRegistry.getActiveEnvironment,
  );
}

export function useActiveEnvironmentAffordances() {
  return environmentAffordances(useActiveEnvironment());
}
