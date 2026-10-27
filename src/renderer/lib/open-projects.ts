import { sessionProjectKey } from "./session-list";

export const MAX_OPEN_PROJECTS = 200;

export function readOpenProjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const folders: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry) continue;
    const key = sessionProjectKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push(entry);
  }
  return folders.slice(0, MAX_OPEN_PROJECTS);
}

export function withDefaultSpace(projects: readonly string[], defaultSpace: string | null): string[] {
  const folders = readOpenProjects(projects);
  if (!defaultSpace) return folders;
  const defaultKey = sessionProjectKey(defaultSpace);
  return [defaultSpace, ...folders.filter((folder) => sessionProjectKey(folder) !== defaultKey)];
}

export function isListedProject(projects: readonly string[], folder: string): boolean {
  const key = sessionProjectKey(folder);
  return projects.some((project) => sessionProjectKey(project) === key);
}

export function addOpenProject(projects: readonly string[], folder: string, defaultSpace: string | null): string[] {
  const list = withDefaultSpace(projects, defaultSpace);
  if (isListedProject(list, folder)) return list;
  const insertion = defaultSpace ? 1 : 0;
  return [...list.slice(0, insertion), folder, ...list.slice(insertion)];
}

export function removeOpenProject(projects: readonly string[], folder: string): string[] {
  const key = sessionProjectKey(folder);
  return projects.filter((project) => sessionProjectKey(project) !== key);
}

export function canMoveOpenProject(
  projects: readonly string[],
  folder: string,
  offset: -1 | 1,
  defaultSpace: string | null,
): boolean {
  const key = sessionProjectKey(folder);
  const index = projects.findIndex((project) => sessionProjectKey(project) === key);
  if (index < 0) return false;
  const target = index + offset;
  if (target < 0 || target >= projects.length) return false;
  if (defaultSpace) {
    const defaultKey = sessionProjectKey(defaultSpace);
    if (sessionProjectKey(projects[target]) === defaultKey) return false;
    if (sessionProjectKey(projects[index]) === defaultKey) return false;
  }
  return true;
}

export function moveOpenProject(
  projects: readonly string[],
  folder: string,
  offset: -1 | 1,
  defaultSpace: string | null,
): string[] {
  if (!canMoveOpenProject(projects, folder, offset, defaultSpace)) return [...projects];
  const key = sessionProjectKey(folder);
  const index = projects.findIndex((project) => sessionProjectKey(project) === key);
  const next = [...projects];
  const [moved] = next.splice(index, 1);
  next.splice(index + offset, 0, moved);
  return next;
}

export function reorderOpenProjects(
  projects: readonly string[],
  from: number,
  to: number,
  defaultSpace: string | null,
): string[] {
  if (from === to || from < 0 || from >= projects.length || to < 0) return [...projects];
  const next = [...projects];
  const [moved] = next.splice(from, 1);
  const lowest = defaultSpace ? 1 : 0;
  const insertion = Math.min(Math.max(to > from ? to - 1 : to, lowest), next.length);
  next.splice(insertion, 0, moved);
  return next;
}
