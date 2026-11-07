import type { EnvironmentId, EnvironmentView } from "@contract/environment";
import type { FolderEntry, FolderListing, FolderBrowseErrorCode } from "@contract/folder-browse";

export type BrowsableFolderListing = Extract<FolderListing, { ok: true }>;
export type FolderBrowserError = { kind: "path"; code: FolderBrowseErrorCode } | { kind: "request"; message: string };
export interface FolderBrowserRequest {
  environmentId: EnvironmentId;
  token: number;
  generation: number;
  path: string;
}
interface TargetState {
  targetEnvironmentId: EnvironmentId;
  requestToken: number;
}
interface FolderColumnsState {
  base: BrowsableFolderListing | null;
  selectedChild: FolderEntry | null;
  preview: BrowsableFolderListing | null;
  selectedPreviewChild: FolderEntry | null;
}
export type FolderBrowserState =
  | { kind: "no-servers"; targetEnvironmentId: null; requestToken: number }
  | (TargetState & { kind: "server-unavailable" })
  | (TargetState &
      FolderColumnsState & { kind: "loading"; intent: "navigate" | "preview"; request: FolderBrowserRequest })
  | (TargetState &
      FolderColumnsState & {
        kind: "ready";
        generation: number;
        base: BrowsableFolderListing;
        current: { listing: BrowsableFolderListing };
      })
  | (TargetState &
      FolderColumnsState & {
        kind: "path-error";
        generation: number;
        path: string;
        error: FolderBrowserError;
      });
export type FolderBrowserAction =
  | { type: "servers-changed"; servers: readonly EnvironmentView[]; initialEnvironmentId?: EnvironmentId }
  | { type: "select-server"; server: EnvironmentView }
  | { type: "open-path"; path: string }
  | { type: "select-child"; entry: FolderEntry }
  | { type: "completed"; request: FolderBrowserRequest; listing: FolderListing }
  | { type: "failed"; request: FolderBrowserRequest; message: string };
export interface FolderMountTarget {
  environmentId: EnvironmentId;
  path: string;
  displayPath: string;
}

function selectServer(server: EnvironmentView, requestToken: number): FolderBrowserState {
  const target = { targetEnvironmentId: server.id, requestToken };
  if (!server.enabled || server.status.phase !== "connected") return { ...target, kind: "server-unavailable" };
  return {
    ...target,
    kind: "loading",
    intent: "navigate",
    base: null,
    selectedChild: null,
    preview: null,
    selectedPreviewChild: null,
    request: { environmentId: server.id, token: requestToken, generation: server.status.generation, path: "~" },
  };
}

export function createFolderBrowserState(
  servers: readonly EnvironmentView[] = [],
  initialEnvironmentId?: EnvironmentId,
): FolderBrowserState {
  const remotes = remoteFolderServers(servers);
  const server = remotes.find((view) => view.id === initialEnvironmentId) ?? remotes[0];
  return server ? selectServer(server, 1) : { kind: "no-servers", targetEnvironmentId: null, requestToken: 0 };
}

export function remoteFolderServers(servers: readonly EnvironmentView[]): EnvironmentView[] {
  return servers.filter((view) => view.target.kind !== "primary");
}

export function folderBrowserReducer(state: FolderBrowserState, action: FolderBrowserAction): FolderBrowserState {
  if (action.type === "servers-changed") {
    const servers = remoteFolderServers(action.servers);
    if (!servers.length) {
      return state.kind === "no-servers"
        ? state
        : { kind: "no-servers", targetEnvironmentId: null, requestToken: state.requestToken + 1 };
    }
    const selected = servers.find((server) => server.id === state.targetEnvironmentId);
    if (selected) {
      if (!selected.enabled || selected.status.phase !== "connected") {
        return state.kind === "server-unavailable" ? state : selectServer(selected, state.requestToken + 1);
      }
      const generation =
        state.kind === "loading" ? state.request.generation : "generation" in state ? state.generation : null;
      return generation === selected.status.generation ? state : selectServer(selected, state.requestToken + 1);
    }
    const preferred = servers.find((server) => server.id === action.initialEnvironmentId) ?? servers[0];
    return selectServer(preferred, state.requestToken + 1);
  }
  if (action.type === "select-server") return selectServer(action.server, state.requestToken + 1);
  if (action.type === "open-path" && state.kind !== "no-servers" && state.kind !== "server-unavailable") {
    const requestToken = state.requestToken + 1;
    const generation = state.kind === "loading" ? state.request.generation : state.generation;
    return {
      kind: "loading",
      intent: "navigate",
      targetEnvironmentId: state.targetEnvironmentId,
      requestToken,
      base: state.base,
      selectedChild: state.selectedChild,
      preview: state.preview,
      selectedPreviewChild: state.selectedPreviewChild,
      request: { environmentId: state.targetEnvironmentId, token: requestToken, generation, path: action.path },
    };
  }
  if (action.type === "select-child" && "base" in state) {
    const matches = (entry: FolderEntry) =>
      entry.path === action.entry.path && entry.displayPath === action.entry.displayPath;
    const inBase = state.base?.folders.find(matches);
    const entry = inBase ?? state.preview?.folders.find(matches);
    if (!state.base || !entry) return state;
    const next = folderBrowserReducer(state, { type: "open-path", path: entry.displayPath });
    return next.kind === "loading"
      ? {
          ...next,
          intent: "preview",
          base: state.base,
          selectedChild: inBase ?? state.selectedChild,
          preview: inBase ? null : state.preview,
          selectedPreviewChild: inBase ? null : entry,
        }
      : state;
  }
  if (action.type !== "completed" && action.type !== "failed") return state;
  if (
    state.kind !== "loading" ||
    action.request.token !== state.requestToken ||
    action.request.environmentId !== state.targetEnvironmentId ||
    action.request.generation !== state.request.generation ||
    action.request.path !== state.request.path
  )
    return state;
  const target = {
    targetEnvironmentId: state.targetEnvironmentId,
    requestToken: state.requestToken,
    generation: state.request.generation,
    selectedChild: state.selectedChild,
    selectedPreviewChild: state.selectedPreviewChild,
    preview: state.preview,
  };
  const failure = { ...target, kind: "path-error" as const, base: state.base, path: state.request.path };
  if (action.type === "failed") return { ...failure, error: { kind: "request", message: action.message } };
  if (!action.listing.ok) return { ...failure, error: { kind: "path", code: action.listing.error } };
  const navigating = state.intent === "navigate";
  return {
    ...target,
    kind: "ready",
    base: navigating ? action.listing : (state.base ?? action.listing),
    selectedChild: navigating ? null : state.selectedChild,
    selectedPreviewChild: navigating ? null : state.selectedPreviewChild,
    preview: navigating ? null : state.selectedChild && !state.selectedPreviewChild ? action.listing : state.preview,
    current: { listing: action.listing },
  };
}

export function folderMountTarget(
  state: FolderBrowserState,
  servers: readonly EnvironmentView[],
): FolderMountTarget | null {
  if (state.kind !== "ready") return null;
  const server = servers.find((view) => view.id === state.targetEnvironmentId);
  if (
    !server?.enabled ||
    server.target.kind === "primary" ||
    server.status.phase !== "connected" ||
    server.status.generation !== state.generation
  )
    return null;
  const { path, displayPath } = state.current.listing;
  return { environmentId: state.targetEnvironmentId, path, displayPath };
}
