export type AllowedRootsCache = { roots: Set<string>; expiresAt: number };

const additionalAllowedRoots = new Set<string>();
let allowedRootsCache: AllowedRootsCache | undefined;
let allowedRootsGeneration = 0;

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function getAdditionalAllowedRoots(): Set<string> {
  return additionalAllowedRoots;
}

export function getAllowedRootsCache(): AllowedRootsCache | undefined {
  return allowedRootsCache;
}

export function setAllowedRootsCache(cache: AllowedRootsCache | undefined): void {
  allowedRootsCache = cache;
}

export function getAllowedRootsGeneration(): number {
  return allowedRootsGeneration;
}

export function setAllowedRootsCacheIfCurrent(cache: AllowedRootsCache, generation: number): boolean {
  if (generation !== allowedRootsGeneration) return false;
  allowedRootsCache = cache;
  return true;
}

export function allowFileRoot(root: string): void {
  if (!root) return;
  const normalizedRoot = normalizeSlashes(root);
  const additionalRoots = getAdditionalAllowedRoots();
  const added = !additionalRoots.has(normalizedRoot);
  additionalRoots.add(normalizedRoot);
  allowedRootsCache?.roots.add(normalizedRoot);
  if (added) allowedRootsGeneration++;
}

export function invalidateAllowedRootsCache(): void {
  allowedRootsCache = undefined;
  allowedRootsGeneration++;
}

const WATCHED_TTL_MS = 10 * 60_000;
const FALLBACK_TTL_MS = 5_000;
let watcherHealthy = false;

export function setAllowedRootsWatcherHealthy(healthy: boolean): void {
  watcherHealthy = healthy;
}

export function isAllowedRootsWatcherHealthy(): boolean {
  return watcherHealthy;
}

export function allowedRootsCacheTtlMs(): number {
  return watcherHealthy ? WATCHED_TTL_MS : FALLBACK_TTL_MS;
}
