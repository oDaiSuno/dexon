import {
  PRIMARY_ENVIRONMENT_ID,
  qualifyProjectKey,
  type EnvironmentId,
  type ScopedProjectKey,
} from "../contract/environment.ts";
export type ProjectKey = ScopedProjectKey;
export interface ProjectSpaceRef {
  readonly environmentId: EnvironmentId;
  readonly path: string;
  readonly displayPath?: string;
}
export interface ProjectSpacesState {
  version: 2;
  spaces: ProjectSpaceRef[];
  seeded: EnvironmentId[];
  lastFocusedSpace?: ProjectSpaceRef | null;
}
export const MAX_PROJECT_SPACES = 200;
export function isAbsoluteInAnyStyle(value: string): boolean {
  return (
    /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u.test(value) && value.length <= 4096 && !/[\0\r\n]/u.test(value)
  );
}
export function projectKeyOf(ref: ProjectSpaceRef): ProjectKey {
  const windows = /^[A-Za-z]:[\\/]|^\\\\/u.test(ref.path);
  let normalized = (windows ? ref.path.replace(/\\/gu, "/") : ref.path).replace(/\/+$/u, "") || "/";
  if (windows || normalized.startsWith("//")) normalized = normalized.toLowerCase();
  return qualifyProjectKey(ref.environmentId, normalized);
}
function isEnvironmentId(value: unknown): value is EnvironmentId {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\0\r\n]/u.test(value);
}
function parseRef(value: unknown): ProjectSpaceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid project space");
  const ref = value as Record<string, unknown>;
  if (!isEnvironmentId(ref.environmentId) || typeof ref.path !== "string" || !isAbsoluteInAnyStyle(ref.path))
    throw new Error("Invalid project space identity or path");
  if (
    ref.displayPath !== undefined &&
    (typeof ref.displayPath !== "string" || ref.displayPath.length > 4096 || /[\0\r\n]/u.test(ref.displayPath))
  )
    throw new Error("Invalid project display path");
  return {
    environmentId: ref.environmentId,
    path: ref.path,
    ...(ref.displayPath === undefined ? {} : { displayPath: ref.displayPath as string }),
  };
}
export function parseProjectSpacesState(value: unknown): ProjectSpacesState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid project spaces state");
  const state = value as Record<string, unknown>;
  if (
    state.version !== 2 ||
    !Array.isArray(state.spaces) ||
    state.spaces.length > MAX_PROJECT_SPACES ||
    !Array.isArray(state.seeded) ||
    state.seeded.length > 100
  )
    throw new Error("Invalid project spaces state");
  const spaces = state.spaces.map(parseRef);
  if (new Set(spaces.map(projectKeyOf)).size !== spaces.length)
    throw new Error("Project spaces must not repeat a folder");
  const seeded = state.seeded.map((id) => {
    if (!isEnvironmentId(id)) throw new Error("Invalid seeded environment");
    return id;
  });
  return {
    version: 2,
    spaces,
    seeded: [...new Set(seeded)],
    ...(state.lastFocusedSpace === undefined
      ? {}
      : { lastFocusedSpace: state.lastFocusedSpace === null ? null : parseRef(state.lastFocusedSpace) }),
  };
}
export function recoverProjectSpacesState(value: unknown, legacyOpenProjects?: unknown): ProjectSpacesState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fromLegacyOpenProjects(legacyOpenProjects);
  const state = value as Record<string, unknown>;
  if (state.version !== 2) return fromLegacyOpenProjects(legacyOpenProjects);
  const spaces: ProjectSpaceRef[] = [];
  const keys = new Set<ProjectKey>();
  for (const entry of Array.isArray(state.spaces) ? state.spaces : []) {
    try {
      const ref = parseRef(entry);
      const key = projectKeyOf(ref);
      if (!keys.has(key)) {
        spaces.push(ref);
        keys.add(key);
      }
    } catch {}
    if (spaces.length >= MAX_PROJECT_SPACES) break;
  }
  const seeded = new Set<EnvironmentId>();
  for (const id of Array.isArray(state.seeded) ? state.seeded : []) {
    if (isEnvironmentId(id)) seeded.add(id);
    if (seeded.size >= 100) break;
  }
  const recovered: ProjectSpacesState = { version: 2, spaces, seeded: [...seeded] };
  if (state.lastFocusedSpace === null) recovered.lastFocusedSpace = null;
  else if (state.lastFocusedSpace !== undefined) {
    try {
      recovered.lastFocusedSpace = parseRef(state.lastFocusedSpace);
    } catch {}
  }
  return recovered;
}
export function fromLegacyOpenProjects(value: unknown): ProjectSpacesState {
  const spaces: ProjectSpaceRef[] = [];
  const keys = new Set<string>();
  for (const folder of Array.isArray(value) ? value : []) {
    if (typeof folder !== "string" || !isAbsoluteInAnyStyle(folder)) continue;
    const ref = { environmentId: PRIMARY_ENVIRONMENT_ID, path: folder };
    const key = projectKeyOf(ref);
    if (!keys.has(key)) {
      spaces.push(ref);
      keys.add(key);
    }
    if (spaces.length >= MAX_PROJECT_SPACES) break;
  }
  return { version: 2, spaces, seeded: [] };
}
export function toLegacyOpenProjects(state: ProjectSpacesState): string[] {
  return state.spaces.filter((ref) => ref.environmentId === PRIMARY_ENVIRONMENT_ID).map((ref) => ref.path);
}
