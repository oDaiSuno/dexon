import path from "node:path";
import { desktopUserDataPath } from "../desktop-state-file.ts";
import { hostIdOf, keyOf, parseWorkspaceInput, type HostId, type WorkspaceKey } from "../../shared/workspace-ref.ts";
import { SshConnection } from "./host/ssh/connection.ts";
import type { ExecutionHost } from "./host/execution-host.ts";

const hosts = new Map<HostId, SshConnection>();
const workspacesByHost = new Map<HostId, Set<WorkspaceKey>>();

function dexonSshDirectory(): string {
  return path.join(desktopUserDataPath(), "ssh");
}

export function getOrCreateHost(workspace: WorkspaceKey): ExecutionHost | null {
  const parsed = parseWorkspaceInput(workspace);
  if (!parsed.ok || parsed.value.kind !== "ssh") return null;
  const ref = parsed.value;
  const id = hostIdOf(ref);
  let activeSet = workspacesByHost.get(id);
  if (!activeSet) {
    activeSet = new Set();
    workspacesByHost.set(id, activeSet);
  }
  activeSet.add(keyOf(ref));
  const existing = hosts.get(id);
  if (existing && !existing.isDisposed()) return existing;
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
  const existing = hosts.get(id);
  return existing && !existing.isDisposed() ? existing : null;
}

export async function releaseWorkspaceHost(workspace: WorkspaceKey): Promise<void> {
  const parsed = parseWorkspaceInput(workspace);
  if (!parsed.ok || parsed.value.kind !== "ssh") return;
  const ref = parsed.value;
  const id = hostIdOf(ref);
  const canonicalKey = keyOf(ref);
  const activeSet = workspacesByHost.get(id);
  activeSet?.delete(canonicalKey);
  if (!activeSet || activeSet.size === 0) {
    workspacesByHost.delete(id);
    const host = hosts.get(id);
    hosts.delete(id);
    if (host) await host.dispose().catch(() => undefined);
  }
}

export async function disposeAllHosts(): Promise<void> {
  await Promise.allSettled([...hosts.values()].map((host) => host.dispose()));
  hosts.clear();
  workspacesByHost.clear();
}
