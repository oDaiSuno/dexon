import { MAX_PROJECT_SPACES, projectKeyOf, type ProjectKey, type ProjectSpaceRef } from "@shared/project-space-state";
export interface MountedSpace extends ProjectSpaceRef {
  readonly key: ProjectKey;
  readonly displayPath: string;
}
export type PinnedSpaces = ProjectSpaceRef | readonly ProjectSpaceRef[] | null;
function pinnedRefsOf(pinned: PinnedSpaces): readonly ProjectSpaceRef[] {
  return pinned === null ? [] : "path" in pinned ? [pinned] : pinned;
}
function pinnedKeysOf(pinned: PinnedSpaces): ReadonlySet<ProjectKey> {
  return new Set(pinnedRefsOf(pinned).map(projectKeyOf));
}
export function mountSpace(ref: ProjectSpaceRef): MountedSpace {
  return { ...ref, key: projectKeyOf(ref), displayPath: ref.displayPath ?? ref.path };
}
export function leadingPinnedCount(spaces: readonly MountedSpace[], pinned: PinnedSpaces): number {
  const keys = pinnedKeysOf(pinned);
  const firstOrdinary = spaces.findIndex((space) => !keys.has(space.key));
  return firstOrdinary < 0 ? spaces.length : firstOrdinary;
}
export function addProjectSpace(
  spaces: readonly MountedSpace[],
  ref: ProjectSpaceRef,
  defaultSpace: PinnedSpaces = null,
): MountedSpace[] {
  const key = projectKeyOf(ref);
  if (spaces.some((space) => space.key === key) || spaces.length >= MAX_PROJECT_SPACES) return [...spaces];
  const index = leadingPinnedCount(spaces, defaultSpace);
  return [...spaces.slice(0, index), mountSpace(ref), ...spaces.slice(index)];
}
export function withPinnedSpaces(spaces: readonly MountedSpace[], pinned: PinnedSpaces): MountedSpace[] {
  const refs = pinnedRefsOf(pinned);
  if (refs.length === 0) return [...spaces];
  const mounted = new Map<ProjectKey, MountedSpace>();
  for (const ref of refs) {
    const key = projectKeyOf(ref);
    if (!mounted.has(key)) mounted.set(key, mountSpace(ref));
  }
  return [...mounted.values(), ...spaces.filter((space) => !mounted.has(space.key))].slice(0, MAX_PROJECT_SPACES);
}
export function withDefaultSpace(spaces: readonly MountedSpace[], ref: ProjectSpaceRef | null): MountedSpace[] {
  return withPinnedSpaces(spaces, ref);
}
export function canMoveProjectSpace(
  spaces: readonly MountedSpace[],
  key: ProjectKey,
  offset: -1 | 1,
  defaultSpace: PinnedSpaces,
): boolean {
  const index = spaces.findIndex((space) => space.key === key);
  const target = index + offset;
  const pinned = pinnedKeysOf(defaultSpace);
  return index >= 0 && target >= 0 && target < spaces.length && !pinned.has(key) && !pinned.has(spaces[target].key);
}
export function moveProjectSpace(
  spaces: readonly MountedSpace[],
  key: ProjectKey,
  offset: -1 | 1,
  defaultSpace: PinnedSpaces,
): MountedSpace[] {
  if (!canMoveProjectSpace(spaces, key, offset, defaultSpace)) return [...spaces];
  const next = [...spaces];
  const index = next.findIndex((space) => space.key === key);
  const [space] = next.splice(index, 1);
  next.splice(index + offset, 0, space);
  return next;
}
export function reorderProjectSpaces(
  spaces: readonly MountedSpace[],
  from: number,
  to: number,
  defaultSpace: PinnedSpaces,
): MountedSpace[] {
  if (
    from < 0 ||
    from >= spaces.length ||
    to < 0 ||
    to > spaces.length ||
    !Number.isInteger(from) ||
    !Number.isInteger(to)
  )
    return [...spaces];
  if (pinnedKeysOf(defaultSpace).has(spaces[from].key)) return [...spaces];
  const next = [...spaces];
  const [moved] = next.splice(from, 1);
  const floor = leadingPinnedCount(spaces, defaultSpace);
  next.splice(Math.min(Math.max(to > from ? to - 1 : to, floor), next.length), 0, moved);
  return next;
}
