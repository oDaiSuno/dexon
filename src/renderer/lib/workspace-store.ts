import type { PiBridge } from "@contract/desktop";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import {
  fromLegacyOpenProjects,
  parseProjectSpacesState,
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
const primaryFocus = (): WorkspaceFocus => ({ environmentId: PRIMARY_ENVIRONMENT_ID, spaceKey: null, sessionId: null });
export class WorkspaceStore {
  private snapshot: WorkspaceSnapshot = { loaded: false, spaces: [], seeded: [], focus: primaryFocus() };
  private readonly listeners = new Set<() => void>();
  private bridge: PiBridge | undefined;
  private loading: Promise<void> | null = null;
  private touched = false;
  private pending: ProjectSpacesState | null = null;
  private writing: Promise<void> | null = null;
  getSnapshot = (): WorkspaceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  initialize(bridge: PiBridge): Promise<void> {
    if (this.bridge === bridge) return this.loading ?? Promise.resolve();
    if (this.bridge) {
      this.touched = false;
      this.snapshot = { loaded: false, spaces: [], seeded: [], focus: primaryFocus() };
    }
    this.bridge = bridge;
    this.loading = this.load(bridge);
    return this.loading;
  }
  private async load(bridge: PiBridge): Promise<void> {
    try {
      const [ui, environments] = await Promise.all([bridge.getUiState?.(), bridge.listEnvironments?.()]);
      if (this.bridge !== bridge || this.touched) return;
      const state = ui?.projectSpaces
        ? parseProjectSpacesState(ui.projectSpaces)
        : fromLegacyOpenProjects(ui?.openProjects);
      const remembered = state.lastFocusedSpace;
      const enabled =
        remembered?.environmentId === PRIMARY_ENVIRONMENT_ID ||
        environments?.environments.some((view) => view.id === remembered?.environmentId && view.enabled);
      const restored =
        remembered && enabled && state.spaces.some((space) => projectKeyOf(space) === projectKeyOf(remembered))
          ? remembered
          : null;
      this.snapshot = {
        loaded: true,
        spaces: state.spaces.map(mountSpace),
        seeded: state.seeded,
        focus: restored
          ? { environmentId: restored.environmentId, spaceKey: projectKeyOf(restored), sessionId: null }
          : primaryFocus(),
      };
    } catch {
      this.snapshot = { ...this.snapshot, loaded: true };
    } finally {
      if (this.bridge === bridge) {
        this.snapshot = { ...this.snapshot, loaded: true };
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
    const { getEnvironmentApiClient } = await import("./api-client");
    const result = await getEnvironmentApiClient(ref.environmentId).validateCwd(ref.path);
    if (!result.ok) return "invalid";
    const canonical = { ...ref, path: result.path ?? ref.path };
    this.commit({
      spaces: addProjectSpace(this.snapshot.spaces, canonical),
      focus: { environmentId: ref.environmentId, spaceKey: projectKeyOf(canonical), sessionId: null },
    });
    return "opened";
  }
  noteCurrentProject(ref: ProjectSpaceRef, defaultSpace: ProjectSpaceRef | null): void {
    if (defaultSpace && projectKeyOf(ref) === projectKeyOf(defaultSpace)) return;
    if (this.snapshot.spaces.some((space) => space.key === projectKeyOf(ref))) return;
    this.commit({ spaces: addProjectSpace(this.snapshot.spaces, ref, defaultSpace) });
  }
  seedFromSessions(environmentId: EnvironmentId, roots: readonly string[]): void {
    if (this.snapshot.seeded.includes(environmentId)) return;
    const refs = fromLegacyOpenProjects(roots)
      .spaces.slice(0, 20)
      .map((ref) => ({ ...ref, environmentId }));
    let spaces = [...this.snapshot.spaces];
    for (const ref of refs.reverse()) spaces = addProjectSpace(spaces, ref);
    this.commit({ spaces, seeded: [...this.snapshot.seeded, environmentId] });
  }
  unmount(key: ProjectKey): void {
    this.commit({
      spaces: this.snapshot.spaces.filter((space) => space.key !== key),
      ...(this.snapshot.focus.spaceKey === key ? { focus: primaryFocus() } : {}),
    });
  }
  unmountEnvironment(environmentId: EnvironmentId): void {
    this.commit({
      spaces: this.snapshot.spaces.filter((space) => space.environmentId !== environmentId),
      ...(this.snapshot.focus.environmentId === environmentId ? { focus: primaryFocus() } : {}),
    });
  }
  move(key: ProjectKey, offset: -1 | 1, defaultSpace: ProjectSpaceRef | null): void {
    this.commit({ spaces: moveProjectSpace(this.snapshot.spaces, key, offset, defaultSpace) });
  }
  reorder(from: number, to: number, defaultSpace: ProjectSpaceRef | null): void {
    this.commit({ spaces: reorderProjectSpaces(this.snapshot.spaces, from, to, defaultSpace) });
  }
  private commit(patch: Partial<WorkspaceSnapshot>): void {
    this.touched = true;
    this.snapshot = { ...this.snapshot, ...patch };
    this.notify();
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
