import { parseSshAddress, parseSshCommand } from "./ssh-input.ts";

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };
export type LocalAbsPath = Brand<string, "LocalAbsPath">;
export type PosixAbsPath = Brand<string, "PosixAbsPath">;
export type WorkspaceKey = Brand<string, "WorkspaceKey">;
export type HostId = Brand<string, "HostId">;

export interface SshTarget {
  readonly user?: string;
  readonly host: string;
  readonly port?: number;
}

export type WorkspaceRef =
  | { readonly kind: "local"; readonly root: LocalAbsPath }
  | { readonly kind: "ssh"; readonly target: SshTarget; readonly root: PosixAbsPath };

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export type SshConnectParsed =
  | { readonly kind: "workspace"; readonly ref: Extract<WorkspaceRef, { kind: "ssh" }> }
  | { readonly kind: "host-only"; readonly target: SshTarget; readonly suggestedPath?: string };

export function normalizePosixPath(raw: string): PosixAbsPath {
  if (!raw.startsWith("/") || /\p{Cc}/u.test(raw))
    throw new Error("An absolute server path without control characters is required");
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}` as PosixAbsPath;
}

export function parseWorkspaceInput(input: string): ParseResult<WorkspaceRef> {
  if (typeof input !== "string" || /\p{Cc}/u.test(input) || !input.trim())
    return { ok: false, error: "A workspace address without control characters is required" };
  const raw = input.trim();
  if (raw.startsWith("/") || /^[A-Za-z]:[/\\]/.test(raw) || /^\\\\[^\\]+\\[^\\]+/.test(raw))
    return { ok: true, value: { kind: "local", root: raw as LocalAbsPath } };
  const remote = parseSshAddress(raw);
  if (!remote.ok) return remote;
  if (!remote.value.path?.startsWith("/") || /\p{Cc}/u.test(remote.value.path))
    return { ok: false, error: "An absolute server path without control characters is required" };
  return { ok: true, value: { kind: "ssh", target: remote.value.target, root: normalizePosixPath(remote.value.path) } };
}

export function formatSshHostLabel(target: SshTarget): string {
  const host = target.host.replace(/^\[|\]$/g, "");
  return host.includes(":") ? `[${host}]` : host;
}

export function formatSshAuthority(target: SshTarget): string {
  return `${target.user ? `${target.user}@` : ""}${formatSshHostLabel(target)}${target.port && target.port !== 22 ? `:${target.port}` : ""}`;
}

export function keyOf(ref: WorkspaceRef): WorkspaceKey {
  if (ref.kind === "local") return ref.root as string as WorkspaceKey;
  const root = normalizePosixPath(ref.root).replace(/[%?#]/g, (character) => encodeURIComponent(character));
  return `ssh://${formatSshAuthority(ref.target)}${root}` as WorkspaceKey;
}

export function fromKey(key: string): ParseResult<WorkspaceRef> {
  return parseWorkspaceInput(key);
}

export function hostIdOf(ref: WorkspaceRef): HostId {
  if (ref.kind === "local") return "local" as HostId;
  const { user, port } = ref.target;
  return `ssh://${user ? `${user}@` : ""}${formatSshHostLabel(ref.target)}:${port ?? 22}` as HostId;
}

export function describeWorkspaceKey(keyOrPath: string) {
  const parsed = fromKey(keyOrPath);
  const ref = parsed.ok ? parsed.value : undefined;
  const isSsh = ref?.kind === "ssh";
  const displayPath = ref?.root ?? keyOrPath;
  const namePath = isSsh ? displayPath : displayPath.replace(/\\/g, "/");
  const folderName = namePath.replace(/\/+$/, "").split("/").pop() || displayPath;
  const hostLabel = isSsh ? formatSshHostLabel(ref.target) : null;
  return {
    isSsh,
    workspaceKey: ref ? keyOf(ref) : keyOrPath,
    folderName,
    hostLabel,
    authorityLabel: isSsh ? formatSshAuthority(ref.target) : null,
    displayPath,
    pulsePrefix: hostLabel ? `${folderName}@${hostLabel}` : folderName,
  };
}

export function parseSshConnectInput(input: string): ParseResult<SshConnectParsed> {
  if (typeof input !== "string" || /\p{Cc}/u.test(input) || !input.trim())
    return { ok: false, error: "A server address without control characters is required" };
  const raw = input.trim();
  const parsed = /^ssh(?:\s|$)/.test(raw) ? parseSshCommand(raw) : parseSshAddress(raw);
  if (!parsed.ok) return parsed;
  const { target, path } = parsed.value;
  if (path !== undefined && /\p{Cc}/u.test(path)) return { ok: false, error: "Invalid server path" };
  if (path?.startsWith("/"))
    return { ok: true, value: { kind: "workspace", ref: { kind: "ssh", target, root: normalizePosixPath(path) } } };
  return { ok: true, value: { kind: "host-only", target, ...(path ? { suggestedPath: path } : {}) } };
}

export function isPosixPathUnder(child: PosixAbsPath, root: PosixAbsPath): boolean {
  const parent = normalizePosixPath(root);
  const candidate = normalizePosixPath(child);
  return candidate === parent || candidate.startsWith(parent === "/" ? "/" : `${parent}/`);
}

function isWindowsPath(raw: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(raw) || raw.startsWith("\\\\") || /^\/\/[^/]+\/[^/]+/.test(raw);
}

function normalizeLocalPath(raw: string): string {
  if (!isWindowsPath(raw)) return normalizePosixPath(raw);
  const slashed = raw.replace(/\\/g, "/");
  const drive = slashed.match(/^([A-Za-z]:)(\/.*)$/);
  if (drive) return `${drive[1]}${normalizePosixPath(drive[2])}`;
  const unc = slashed.match(/^(\/\/[^/]+\/[^/]+)(\/.*)?$/);
  if (!unc) throw new Error("Invalid absolute local path");
  const suffix = normalizePosixPath(unc[2] ?? "/");
  return `${unc[1]}${suffix === "/" ? "" : suffix}`;
}

export function joinWorkspaceKeyPath(workspaceOrDirKey: string, childRelativePosix: string): string {
  const parsed = fromKey(workspaceOrDirKey);
  if (!parsed.ok) throw new Error(parsed.error);
  if (/\p{Cc}/u.test(childRelativePosix) || /^[/\\]|^[A-Za-z][A-Za-z0-9+.-]*:\//.test(childRelativePosix))
    throw new Error("A relative child path is required");
  const ref = parsed.value;
  if (ref.kind === "ssh") return keyOf({ ...ref, root: normalizePosixPath(`${ref.root}/${childRelativePosix}`) });
  const joined = normalizeLocalPath(`${ref.root}/${childRelativePosix}`);
  return isWindowsPath(ref.root) && ref.root.includes("\\") ? joined.replace(/\//g, "\\") : joined;
}

export function relativeWorkspacePath(rootKey: string, targetKeyOrPath: string): string | null {
  const root = fromKey(rootKey);
  if (!root.ok) return null;
  const target =
    root.value.kind === "ssh" && targetKeyOrPath.startsWith("/")
      ? { ok: true as const, value: { ...root.value, root: normalizePosixPath(targetKeyOrPath) } }
      : fromKey(targetKeyOrPath);
  if (!target.ok || root.value.kind !== target.value.kind || hostIdOf(root.value) !== hostIdOf(target.value))
    return null;
  const remote = root.value.kind === "ssh";
  const rootPath = remote ? normalizePosixPath(root.value.root) : normalizeLocalPath(root.value.root);
  const targetPath = remote ? normalizePosixPath(target.value.root) : normalizeLocalPath(target.value.root);
  const fold = !remote && isWindowsPath(root.value.root);
  const comparedRoot = fold ? rootPath.toLocaleLowerCase("en-US") : rootPath;
  const comparedTarget = fold ? targetPath.toLocaleLowerCase("en-US") : targetPath;
  if (comparedTarget === comparedRoot) return "";
  const prefix = comparedRoot.endsWith("/") ? comparedRoot : `${comparedRoot}/`;
  return comparedTarget.startsWith(prefix) ? targetPath.slice(prefix.length) : null;
}
