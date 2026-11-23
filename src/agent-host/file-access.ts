import { realpath } from "node:fs/promises";
import path from "node:path";
import { RpcError } from "../contract/types";
import {
  allowedRootsCacheTtlMs,
  getAdditionalAllowedRoots,
  getAllowedRootsCache,
  getAllowedRootsGeneration,
  normalizeSlashes,
  setAllowedRootsCacheIfCurrent,
} from "../shared/allowed-roots";
import { desktopUserDataPath } from "./desktop-state-file";
import { listAllSessions } from "./session-reader";
import { isFilePathReferencedBySession } from "./session-file-references";
import { pathAccess, type AllowedRoots } from "./file-access-core";
export {
  allowFileRoot,
  normalizeSlashes,
  invalidateAllowedRootsCache,
  setAllowedRootsWatcherHealthy,
} from "../shared/allowed-roots";

const PROTECTED_STATE_FILES = new Set([
  "auth-token",
  "automation.secrets.json",
  "channels.secrets.json",
  "credentials.vault.json",
  "daemon-owner.lock",
]);

async function resolveNormalizedPath(target: string): Promise<string> {
  try {
    return normalizeSlashes(await realpath(target));
  } catch {
    return normalizeSlashes(path.resolve(target));
  }
}

async function isProtectedStateFile(target: string): Promise<boolean> {
  const stateRoot = await resolveNormalizedPath(desktopUserDataPath());
  const resolved = await resolveNormalizedPath(target);
  const compare = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  const root = compare(stateRoot);
  const file = compare(resolved);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!file.startsWith(prefix)) return false;
  const relative = file.slice(prefix.length);
  if (relative.includes("/")) return false;
  if (PROTECTED_STATE_FILES.has(relative)) return true;
  for (const name of PROTECTED_STATE_FILES) {
    if (relative.startsWith(`${name}.`) && relative.endsWith(".tmp")) return true;
  }
  return false;
}

let preparedRoots: { readonly key: string; readonly allowed: Promise<AllowedRoots> } | undefined;

export async function isFilePathAllowed(target: string): Promise<boolean> {
  if (await isProtectedStateFile(target)) return false;
  const roots = [...(await getAllowedFileRoots())];
  const key = JSON.stringify(roots);
  if (preparedRoots?.key !== key) preparedRoots = { key, allowed: pathAccess.prepare(roots) };
  return (await preparedRoots.allowed).allows(target);
}

/** Reject any target outside the allowed roots unless the source session
 * references it directly (worktree file references). */
export async function assertPathAllowed(target: string, sourceSessionId?: string): Promise<void> {
  if (await isProtectedStateFile(target)) throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
  if (await isFilePathAllowed(target)) return;
  if (sourceSessionId && (await isFilePathReferencedBySession(target, sourceSessionId))) return;
  throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
}

// Cache avoids re-scanning every session for each file request. The TTL is
// watcher-aware (see allowed-roots.ts): long when the session watcher delivers
// event-driven invalidation, short as a fallback when it cannot.
export async function getAllowedFileRoots(): Promise<Set<string>> {
  const cached = getAllowedRootsCache();
  if (cached && cached.expiresAt > Date.now()) return cached.roots;

  const generation = getAllowedRootsGeneration();
  let roots = await scanAllowedFileRoots();
  if (setAllowedRootsCacheIfCurrent({ roots, expiresAt: Date.now() + allowedRootsCacheTtlMs() }, generation)) {
    return roots;
  }

  // The watcher invalidated the cache while listAllSessions() was in flight.
  // Retry once for the current caller. A second collision remains uncached, so
  // it cannot leave stale roots in place for the long watcher-backed TTL.
  const retryGeneration = getAllowedRootsGeneration();
  roots = await scanAllowedFileRoots();
  setAllowedRootsCacheIfCurrent({ roots, expiresAt: Date.now() + allowedRootsCacheTtlMs() }, retryGeneration);
  return roots;
}

async function scanAllowedFileRoots(): Promise<Set<string>> {
  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    // The project root (main repo shared by all worktrees) is browsable too —
    // the project dropdown lists it even when only worktrees have sessions.
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }

  for (const root of getAdditionalAllowedRoots()) roots.add(root);
  return roots;
}
