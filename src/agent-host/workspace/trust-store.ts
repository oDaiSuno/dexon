import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkspaceTrustMode } from "../../contract/workspace.ts";
import type { WorkspaceKey } from "../../shared/workspace-ref.ts";
import { desktopUserDataPath } from "../desktop-state-file.ts";

function trustStoreFilePath(): string {
  return path.join(desktopUserDataPath(), "ssh", "workspace-trust.json");
}

function readPersistedTrustMap(): Record<string, WorkspaceTrustMode> {
  const filePath = trustStoreFilePath();
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, WorkspaceTrustMode> = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (val === "read-only" || val === "trusted") out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export function getRemoteWorkspaceTrust(workspace: WorkspaceKey): WorkspaceTrustMode {
  const map = readPersistedTrustMap();
  return map[workspace] ?? "read-only";
}

export function isRemoteWorkspaceTrusted(workspace: WorkspaceKey): boolean {
  return getRemoteWorkspaceTrust(workspace) === "trusted";
}

export function setRemoteWorkspaceTrust(workspace: WorkspaceKey, trust: WorkspaceTrustMode): void {
  const filePath = trustStoreFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const current = readPersistedTrustMap();
  current[workspace] = trust;
  writeFileSync(filePath, JSON.stringify(current, null, 2), { encoding: "utf8", mode: 0o600 });
}
