import path from "node:path";
import { desktopUserDataPath } from "../desktop-state-file.ts";
import { hostIdOf, parseWorkspaceInput, type HostId, type WorkspaceKey } from "../../shared/workspace-ref.ts";
import { SshConnection } from "./host/ssh/connection.ts";
import type { ExecutionHost } from "./host/execution-host.ts";

const hosts = new Map<HostId, ExecutionHost>();

function dexonSshDirectory(): string {
  return path.join(desktopUserDataPath(), "ssh");
}

export function getOrCreateHost(workspace: WorkspaceKey): ExecutionHost | null {
  const parsed = parseWorkspaceInput(workspace);
  if (!parsed.ok || parsed.value.kind !== "ssh") return null;
  const ref = parsed.value;
  const id = hostIdOf(ref);
  const existing = hosts.get(id);
  if (existing) return existing;
  const conn = new SshConnection(id, ref.target, {
    dexonKnownHostsPath: `${dexonSshDirectory()}/known_hosts`,
  });
  hosts.set(id, conn);
  return conn;
}

export function getHost(workspace: WorkspaceKey): ExecutionHost | null {
  const parsed = parseWorkspaceInput(workspace);
  if (!parsed.ok || parsed.value.kind !== "ssh") return null;
  const id = hostIdOf(parsed.value);
  return hosts.get(id) ?? null;
}

export async function disposeAllHosts(): Promise<void> {
  await Promise.allSettled([...hosts.values()].map((host) => host.dispose()));
  hosts.clear();
}
