import { useSyncExternalStore } from "react";
import {
  PRIMARY_ENVIRONMENT_ID,
  type AddEnvironmentInput,
  type EnvironmentId,
  type EnvironmentView,
} from "@contract/environment";
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
  private activeId: EnvironmentId = PRIMARY_ENVIRONMENT_ID;
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
    this.replaceViews([defaultPrimaryEnvironmentView]);
    if (typeof bridge?.listEnvironments !== "function") return;
    if (typeof bridge.onEnvironmentsChanged === "function") {
      this.offChanges = bridge.onEnvironmentsChanged((views) => {
        if (this.bridge !== bridge) return;
        this.revision += 1;
        this.replaceViews(views);
      });
    }
    void bridge
      .listEnvironments()
      .then((views) => {
        if (this.bridge === bridge && this.revision === revision) this.replaceViews(views);
      })
      .catch(() => {});
  };

  getEnvironments = (): EnvironmentView[] => this.views;
  getActiveEnvironmentId = (): EnvironmentId => this.activeId;
  getActiveEnvironment = (): EnvironmentView =>
    this.views.find((view) => view.id === this.activeId) ?? defaultPrimaryEnvironmentView;

  subscribe = (listener: () => void): (() => void) => {
    this.initialize();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setActiveEnvironmentId(id: EnvironmentId): void {
    this.initialize();
    if (!this.views.some((view) => view.id === id)) throw new Error("Unknown environment ID");
    if (this.activeId === id) return;
    this.activeId = id;
    this.notify();
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
    if (owners?.has(this.activeId)) return this.activeId;
    return owners?.values().next().value ?? this.activeId;
  }

  activateSession(sessionId: string, environmentId?: EnvironmentId): void {
    this.setActiveEnvironmentId(environmentId ?? this.getSessionEnvironmentId(sessionId));
  }

  async addRemoteEnvironment(input: AddEnvironmentInput): Promise<EnvironmentView> {
    this.initialize();
    if (typeof this.bridge?.addEnvironment !== "function") throw new Error("Remote environments are unavailable");
    const revision = this.revision;
    const view = await this.bridge.addEnvironment(input);
    if (revision === this.revision) this.mergeView(view);
    return view;
  }

  async removeRemoteEnvironment(id: EnvironmentId): Promise<{ ok: boolean }> {
    this.initialize();
    if (id === PRIMARY_ENVIRONMENT_ID) throw new Error("The Primary environment cannot be removed");
    if (typeof this.bridge?.removeEnvironment !== "function") throw new Error("Remote environments are unavailable");
    const result = await this.bridge.removeEnvironment(id);
    if (result.ok) {
      this.revision += 1;
      this.replaceViews(this.views.filter((view) => view.id !== id));
    }
    return result;
  }

  async connectRemoteEnvironment(id: EnvironmentId): Promise<EnvironmentView> {
    this.initialize();
    if (typeof this.bridge?.connectEnvironment !== "function") throw new Error("Remote environments are unavailable");
    const revision = this.revision;
    const view = await this.bridge.connectEnvironment(id);
    if (revision === this.revision) this.mergeView(view);
    return view;
  }

  async disconnectRemoteEnvironment(id: EnvironmentId): Promise<EnvironmentView> {
    this.initialize();
    if (typeof this.bridge?.disconnectEnvironment !== "function")
      throw new Error("Remote environments are unavailable");
    const revision = this.revision;
    const view = await this.bridge.disconnectEnvironment(id);
    if (revision === this.revision) this.mergeView(view);
    return view;
  }

  private mergeView(view: EnvironmentView): void {
    this.revision += 1;
    this.replaceViews(
      this.views.some((item) => item.id === view.id)
        ? this.views.map((item) => (item.id === view.id ? view : item))
        : [...this.views, view],
    );
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
    if (!ids.has(this.activeId)) this.activeId = PRIMARY_ENVIRONMENT_ID;
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
export const setActiveEnvironmentId = (id: EnvironmentId) => environmentRegistry.setActiveEnvironmentId(id);
export const activateEnvironmentSession = (sessionId: string, id?: EnvironmentId) =>
  environmentRegistry.activateSession(sessionId, id);
export const addRemoteEnvironment = (input: AddEnvironmentInput) => environmentRegistry.addRemoteEnvironment(input);
export const removeRemoteEnvironment = (id: EnvironmentId) => environmentRegistry.removeRemoteEnvironment(id);
export const connectRemoteEnvironment = (id: EnvironmentId) => environmentRegistry.connectRemoteEnvironment(id);
export const disconnectRemoteEnvironment = (id: EnvironmentId) => environmentRegistry.disconnectRemoteEnvironment(id);

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
