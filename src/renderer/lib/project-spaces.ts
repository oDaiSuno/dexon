import { MAX_PROJECT_SPACES, projectKeyOf, type ProjectKey, type ProjectSpaceRef } from "@shared/project-space-state";
export interface MountedSpace extends ProjectSpaceRef {
  readonly key: ProjectKey;
  readonly displayPath: string;
}
export function mountSpace(ref: ProjectSpaceRef): MountedSpace {
  return { ...ref, key: projectKeyOf(ref), displayPath: ref.displayPath ?? ref.path };
}
export function addProjectSpace(
  spaces: readonly MountedSpace[],
  ref: ProjectSpaceRef,
  defaultSpace: ProjectSpaceRef | null = null,
): MountedSpace[] {
  const key = projectKeyOf(ref);
  if (spaces.some((space) => space.key === key) || spaces.length >= MAX_PROJECT_SPACES) return [...spaces];
  const index = defaultSpace && spaces[0]?.key === projectKeyOf(defaultSpace) ? 1 : 0;
  return [...spaces.slice(0, index), mountSpace(ref), ...spaces.slice(index)];
}
export function withDefaultSpace(spaces: readonly MountedSpace[], ref: ProjectSpaceRef | null): MountedSpace[] {
  if (!ref) return [...spaces];
  const key = projectKeyOf(ref);
  return [mountSpace(ref), ...spaces.filter((space) => space.key !== key)].slice(0, MAX_PROJECT_SPACES);
}
export function canMoveProjectSpace(
  spaces: readonly MountedSpace[],
  key: ProjectKey,
  offset: -1 | 1,
  defaultSpace: ProjectSpaceRef | null,
): boolean {
  const index = spaces.findIndex((space) => space.key === key);
  const target = index + offset;
  const pinned = defaultSpace ? projectKeyOf(defaultSpace) : null;
  return index >= 0 && target >= 0 && target < spaces.length && key !== pinned && spaces[target].key !== pinned;
}
export function moveProjectSpace(
  spaces: readonly MountedSpace[],
  key: ProjectKey,
  offset: -1 | 1,
  defaultSpace: ProjectSpaceRef | null,
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
  defaultSpace: ProjectSpaceRef | null,
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
  const pinned = defaultSpace ? projectKeyOf(defaultSpace) : null;
  if (spaces[from].key === pinned) return [...spaces];
  const next = [...spaces];
  const [moved] = next.splice(from, 1);
  next.splice(Math.min(Math.max(to > from ? to - 1 : to, spaces[0]?.key === pinned ? 1 : 0), next.length), 0, moved);
  return next;
}
