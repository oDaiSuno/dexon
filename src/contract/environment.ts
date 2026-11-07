import type { EnvironmentStatus } from "./environment-status";
import type { RemoteRuntimeMeta } from "./environment-commands";
export const DEXON_ENVIRONMENT_PROTOCOL_VERSION = 1;
export const PRIMARY_ENVIRONMENT_ID = "primary";

export type EnvironmentId = string;

export interface EnvironmentPlatform {
  os: "linux" | "darwin" | "win32";
  arch: string;
  pathStyle: "posix" | "win32";
  home: string;
}

export interface EnvironmentCapabilities {
  browser: boolean;
  nativeDialogs: boolean;
  revealInFileManager: boolean;
  managedProcesses: boolean;
  toolchainInstall: boolean;
}

export interface EnvironmentDescriptor {
  environmentId: EnvironmentId;
  label: string;
  protocolVersion: number;
  serverVersion: string;
  platform: EnvironmentPlatform;
  capabilities: EnvironmentCapabilities;
  runtime?: { nodeVersion: string; payloadVersion: string; startedAt: number };
}

export interface SshEnvironmentTarget {
  kind: "ssh";
  sshAlias: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
  remotePort?: number;
  remoteStateDir?: string;
  expectedEnvironmentId?: EnvironmentId;
}

export interface WebSocketEnvironmentTarget {
  kind: "websocket";
  url: string;
  expectedEnvironmentId?: EnvironmentId;
}

export type EnvironmentTarget = { kind: "primary" } | SshEnvironmentTarget | WebSocketEnvironmentTarget;

export type {
  ConnectionStage,
  ConnectionBlockedReason,
  ConnectionTransientReason,
  EnvironmentStatus,
  SupervisorConnectionPhase,
} from "./environment-status";

export interface EnvironmentView {
  id: EnvironmentId;
  label: string;
  enabled: boolean;
  target: EnvironmentTarget;
  status: EnvironmentStatus;
  descriptor: EnvironmentDescriptor | null;
  runtime?: RemoteRuntimeMeta | null;
}

export interface AddEnvironmentInput {
  label: string;
  target: SshEnvironmentTarget | WebSocketEnvironmentTarget;
  authToken?: string;
  enabled?: boolean;
}

export type ScopedProjectKey = string & { readonly __brand: "ScopedProjectKey" };
export type ScopedSessionKey = string & { readonly __brand: "ScopedSessionKey" };

type ScopedKeyParts = [environmentId: EnvironmentId, localId: string];

function qualifyKey(environmentId: EnvironmentId, localId: string): string {
  if (!environmentId || !localId) throw new Error("Environment and local identifiers must not be empty");
  return JSON.stringify([environmentId, localId]);
}

function parseQualifiedKey(key: string): ScopedKeyParts | null {
  try {
    const value: unknown = JSON.parse(key);
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "string" ||
      !value[0] ||
      typeof value[1] !== "string" ||
      !value[1]
    ) {
      return null;
    }
    return [value[0], value[1]];
  } catch {
    return null;
  }
}

export function qualifyProjectKey(environmentId: EnvironmentId, normalizedPath: string): ScopedProjectKey {
  return qualifyKey(environmentId, normalizedPath) as ScopedProjectKey;
}

export function parseQualifiedProjectKey(key: string): { environmentId: EnvironmentId; path: string } | null {
  const parts = parseQualifiedKey(key);
  return parts ? { environmentId: parts[0], path: parts[1] } : null;
}

export function qualifySessionKey(environmentId: EnvironmentId, sessionId: string): ScopedSessionKey {
  return qualifyKey(environmentId, sessionId) as ScopedSessionKey;
}

export function parseQualifiedSessionKey(key: string): { environmentId: EnvironmentId; sessionId: string } | null {
  const parts = parseQualifiedKey(key);
  return parts ? { environmentId: parts[0], sessionId: parts[1] } : null;
}
