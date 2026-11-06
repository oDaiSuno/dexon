import type { PiBridge } from "@contract/desktop";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import {
  fromLegacyOpenProjects,
  recoverProjectSpacesState,
  projectKeyOf,
  type ProjectKey,
  type ProjectSpaceRef,
  type ProjectSpacesState,
} from "@shared/project-space-state";
import {
  addProjectSpace,
  mountSpace,
  moveProjectSpace,
  reorderProjectSpaces,
  type MountedSpace,
} from "./project-spaces";
export type { ProjectKey, ProjectSpaceRef, MountedSpace };
export interface WorkspaceFocus {
  readonly environmentId: EnvironmentId;
  readonly spaceKey: ProjectKey | null;
  readonly sessionId: string | null;
}
export interface WorkspaceSnapshot {
  readonly loaded: boolean;
  readonly spaces: readonly MountedSpace[];
  readonly seeded: readonly EnvironmentId[];
  readonly focus: WorkspaceFocus;
}
type WorkspaceChange = (snapshot: WorkspaceSnapshot) => Partial<WorkspaceSnapshot>;
interface WorkspaceOperation {
  change: WorkspaceChange;
  removesFocus?: (focus: WorkspaceFocus) => boolean;
}
const primaryFocus = (): WorkspaceFocus => ({ environmentId: PRIMARY_ENVIRONMENT_ID, spaceKey: null, sessionId: null });
export class WorkspaceStore {
  private snapshot: WorkspaceSnapshot = { loaded: false, spaces: [], seeded: [], focus: primaryFocus() };
  private readonly listeners = new Set<() => void>();
  private bridge: PiBridge | undefined;
  private loading: Promise<void> | null = null;
  private pending: ProjectSpacesState | null = null;
  private writing: Promise<void> | null = null;
  private preLoadOps: WorkspaceOperation[] = [];
  private focusChangedBeforeLoad = false;
  getSnapshot = (): WorkspaceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  initialize(bridge: PiBridge): Promise<void> {
    if (this.bridge === bridge) {
      if (this.snapshot.loaded) return Promise.resolve();
      if (this.loading) return this.loading;
      this.loading = this.load(bridge);
      return this.loading;
    }
    if (this.bridge) {
      this.pending = null;
      this.snapshot = { loaded: false, spaces: [], seeded: [], focus: primaryFocus() };
    }
    this.preLoadOps = [];
    this.focusChangedBeforeLoad = false;
    this.bridge = bridge;
    this.loading = this.load(bridge);
    return this.loading;
  }
  private async load(bridge: PiBridge): Promise<void> {
    try {
      const [ui, environments] = await Promise.all([bridge.getUiState?.(), bridge.listEnvironments?.()]);
      if (this.bridge !== bridge) return;
      const changedDuringLoad = this.focusChangedBeforeLoad || this.preLoadOps.length > 0;
      const state = recoverProjectSpacesState(ui?.projectSpaces, ui?.openProjects);
      const reconciled = this.preLoadOps.reduce<WorkspaceSnapshot>(
        (snapshot, operation) => ({ ...snapshot, ...operation.change(snapshot) }),
        { ...this.snapshot, spaces: state.spaces.map(mountSpace), seeded: [...state.seeded] },
      );
      const remembered = state.lastFocusedSpace;
      const enabled =
        remembered?.environmentId === PRIMARY_ENVIRONMENT_ID ||
        environments?.environments.some((view) => view.id === remembered?.environmentId && view.enabled);
      const restored =
        remembered && enabled && reconciled.spaces.some((space) => space.key === projectKeyOf(remembered))
          ? remembered
          : null;
      const preserveFocus =
        this.focusChangedBeforeLoad &&
        !this.preLoadOps.some((operation) => operation.removesFocus?.(this.snapshot.focus));
      this.snapshot = {
        loaded: true,
        spaces: reconciled.spaces,
        seeded: reconciled.seeded,
        focus: preserveFocus
          ? this.snapshot.focus
          : restored
            ? { environmentId: restored.environmentId, spaceKey: projectKeyOf(restored), sessionId: null }
            : primaryFocus(),
      };
      this.preLoadOps = [];
      this.focusChangedBeforeLoad = false;
      this.loading = null;
      this.notify();
      if (changedDuringLoad) this.persistSnapshot();
    } catch {
      if (this.bridge === bridge) {
        this.loading = null;
        this.notify();
      }
    }
  }
  focusSession(session: { id: string; environmentId?: EnvironmentId; cwd?: string; projectRoot?: string }): void {
    const environmentId = session.environmentId ?? PRIMARY_ENVIRONMENT_ID;
    const path = session.projectRoot ?? session.cwd;
    this.commit({
      focus: { environmentId, spaceKey: path ? projectKeyOf({ environmentId, path }) : null, sessionId: session.id },
    });
  }
  openSpace(ref: ProjectSpaceRef): void {
    this.commit({ focus: { environmentId: ref.environmentId, spaceKey: projectKeyOf(ref), sessionId: null } });
  }
  async mountAndOpen(ref: ProjectSpaceRef): Promise<"opened" | "invalid"> {
    if (!this.snapshot.loaded && this.bridge) await this.initialize(this.bridge);
    if (!this.snapshot.loaded) return "invalid";
    const { getEnvironmentApiClient } = await import("./api-client");
    const result = await getEnvironmentApiClient(ref.environmentId).validateCwd(ref.path);
    if (!result.ok) return "invalid";
    const canonical = { ...ref, path: result.path ?? ref.path };
    const spaceKey = projectKeyOf(canonical);
    const spaces = addProjectSpace(this.snapshot.spaces, canonical);
    if (!spaces.some((space) => space.key === spaceKey)) return "invalid";
    this.commit((snapshot) => ({
      spaces: addProjectSpace(snapshot.spaces, canonical),
      focus: { environmentId: ref.environmentId, spaceKey, sessionId: null },
    }));
    return "opened";
  }
  noteCurrentProject(ref: ProjectSpaceRef, defaultSpace: ProjectSpaceRef | null): void {
    if (defaultSpace && projectKeyOf(ref) === projectKeyOf(defaultSpace)) return;
    if (this.snapshot.spaces.some((space) => space.key === projectKeyOf(ref))) return;
    this.commit((snapshot) => ({ spaces: addProjectSpace(snapshot.spaces, ref, defaultSpace) }));
  }
  seedFromSessions(environmentId: EnvironmentId, roots: readonly string[]): void {
    if (this.snapshot.seeded.includes(environmentId)) return;
    const refs = fromLegacyOpenProjects(roots)
      .spaces.slice(0, 20)
      .map((ref) => ({ ...ref, environmentId }))
      .reverse();
    this.commit((snapshot) => {
      if (snapshot.seeded.includes(environmentId)) return {};
      let spaces = [...snapshot.spaces];
      for (const ref of refs) spaces = addProjectSpace(spaces, ref);
      return { spaces, seeded: [...snapshot.seeded, environmentId] };
    });
  }
  unmount(key: ProjectKey): void {
    const removesFocus = (focus: WorkspaceFocus) => focus.spaceKey === key;
    this.commit(
      (snapshot) => ({
        spaces: snapshot.spaces.filter((space) => space.key !== key),
        ...(removesFocus(snapshot.focus) ? { focus: primaryFocus() } : {}),
      }),
      removesFocus,
    );
  }
  unmountEnvironment(environmentId: EnvironmentId): void {
    const removesFocus = (focus: WorkspaceFocus) => focus.environmentId === environmentId;
    this.commit(
      (snapshot) => ({
        spaces: snapshot.spaces.filter((space) => space.environmentId !== environmentId),
        ...(removesFocus(snapshot.focus) ? { focus: primaryFocus() } : {}),
      }),
      removesFocus,
    );
  }
  move(key: ProjectKey, offset: -1 | 1, defaultSpace: ProjectSpaceRef | null): void {
    this.commit((snapshot) => ({ spaces: moveProjectSpace(snapshot.spaces, key, offset, defaultSpace) }));
  }
  reorder(from: number, to: number, defaultSpace: ProjectSpaceRef | null): void {
    this.commit((snapshot) => ({ spaces: reorderProjectSpaces(snapshot.spaces, from, to, defaultSpace) }));
  }
  private commit(
    change: Pick<WorkspaceSnapshot, "focus"> | WorkspaceChange,
    removesFocus?: (focus: WorkspaceFocus) => boolean,
  ): void {
    const patch = typeof change === "function" ? change(this.snapshot) : change;
    if (!this.snapshot.loaded) {
      if (typeof change === "function") this.preLoadOps.push({ change, removesFocus });
      if ("focus" in patch) this.focusChangedBeforeLoad = true;
    }
    this.snapshot = { ...this.snapshot, ...patch };
    this.notify();
    if (this.snapshot.loaded) this.persistSnapshot();
  }
  private persistSnapshot(): void {
    const focused = this.snapshot.spaces.find((space) => space.key === this.snapshot.focus.spaceKey);
    this.pending = {
      version: 2,
      spaces: this.snapshot.spaces.map(({ environmentId, path, displayPath }) => ({
        environmentId,
        path,
        displayPath,
      })),
      seeded: [...this.snapshot.seeded],
      lastFocusedSpace: focused
        ? { environmentId: focused.environmentId, path: focused.path, displayPath: focused.displayPath }
        : null,
    };
    if (!this.writing)
      this.writing = this.persist().finally(() => {
        this.writing = null;
        if (this.pending) this.persistSnapshot();
      });
  }
  private async persist(): Promise<void> {
    while (this.pending) {
      const projectSpaces = this.pending;
      this.pending = null;
      try {
        await this.bridge?.setUiState?.({ projectSpaces });
      } catch {}
    }
  }
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
export const workspaceStore = new WorkspaceStore();
