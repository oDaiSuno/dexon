import { randomBytes, randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import path from "node:path";
import {
  DEXON_ENVIRONMENT_PROTOCOL_VERSION,
  type EnvironmentCapabilities,
  type EnvironmentDescriptor,
  type EnvironmentId,
} from "../contract/environment.ts";
import { desktopUserDataPath } from "./desktop-state-file.ts";
import { readOrCreatePrivateFile } from "./private-state-file.ts";

const startedAt = Date.now();

export interface EnvironmentIdentity {
  environmentId: EnvironmentId;
  label: string;
  authToken: string;
  stateDir: string;
}

export function ensureEnvironmentIdentity(options: { stateDir?: string; label?: string } = {}): EnvironmentIdentity {
  const stateDir = path.resolve(options.stateDir ?? desktopUserDataPath());
  const label = options.label?.trim() || hostname();
  const stored: unknown = JSON.parse(
    readOrCreatePrivateFile(
      path.join(stateDir, "environment.json"),
      JSON.stringify({ environmentId: randomUUID(), label }),
    ),
  );
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error("Invalid environment identity file");
  }
  const identity = stored as { environmentId?: unknown; label?: unknown };
  if (
    typeof identity.environmentId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(identity.environmentId)
  ) {
    throw new Error("Invalid persisted environment ID");
  }
  const authToken = readOrCreatePrivateFile(path.join(stateDir, "auth-token"), randomBytes(32).toString("hex")).trim();
  if (!/^[a-f0-9]{64}$/u.test(authToken)) throw new Error("Invalid persisted environment auth token");
  return {
    environmentId: identity.environmentId,
    label: options.label?.trim() || (typeof identity.label === "string" && identity.label.trim()) || label,
    authToken,
    stateDir,
  };
}

export function buildEnvironmentDescriptor(options: {
  environmentId: EnvironmentId;
  label: string;
  piVersion: string;
  capabilities: EnvironmentCapabilities;
}): EnvironmentDescriptor {
  const os = process.platform;
  if (os !== "linux" && os !== "darwin" && os !== "win32") throw new Error(`Unsupported environment OS: ${os}`);
  return {
    environmentId: options.environmentId,
    label: options.label,
    protocolVersion: DEXON_ENVIRONMENT_PROTOCOL_VERSION,
    serverVersion: options.piVersion,
    platform: { os, arch: process.arch, pathStyle: os === "win32" ? "win32" : "posix", home: homedir() },
    capabilities: { ...options.capabilities },
    runtime: {
      nodeVersion: process.versions.node,
      payloadVersion: process.env.DEXON_REMOTE_PAYLOAD_VERSION ?? "development",
      startedAt,
    },
  };
}
