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
  if (/^[A-Za-z]:\//u.test(normalized) || normalized.startsWith("//")) normalized = normalized.toLowerCase();
  return qualifyProjectKey(ref.environmentId, normalized);
}
function parseRef(value: unknown): ProjectSpaceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid project space");
  const ref = value as Record<string, unknown>;
  if (
    typeof ref.environmentId !== "string" ||
    !ref.environmentId ||
    ref.environmentId.length > 1024 ||
    /[\0\r\n]/u.test(ref.environmentId) ||
    typeof ref.path !== "string" ||
    !isAbsoluteInAnyStyle(ref.path)
  )
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
    if (typeof id !== "string" || !id || id.length > 1024 || /[\0\r\n]/u.test(id))
      throw new Error("Invalid seeded environment");
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
