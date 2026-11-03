import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { keyOf, parseWorkspaceInput, type WorkspaceKey, type WorkspaceRef } from "../../shared/workspace-ref.ts";

const BINDING_TYPE = "dexon.workspace.v1";

interface WorkspaceBinding {
  readonly workspace: WorkspaceKey;
  readonly kind: "local" | "ssh";
  readonly hostLabel: string | null;
  readonly remotePath: string | null;
  readonly authorityLabel: string | null;
}

function extractBinding(entry: unknown): WorkspaceBinding | null {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (record.type !== "custom" || record.customType !== BINDING_TYPE) return null;
  const data = record.data;
  if (typeof data !== "object" || data === null) return null;
  const raw = (data as Record<string, unknown>).workspace;
  if (typeof raw !== "string") return null;
  const parsed = parseWorkspaceInput(raw);
  if (!parsed.ok) return null;
  const ref = parsed.value;
  return describeRef(ref);
}

function describeRef(ref: WorkspaceRef): WorkspaceBinding {
  if (ref.kind === "local") {
    return {
      workspace: keyOf(ref),
      kind: "local",
      hostLabel: null,
      remotePath: null,
      authorityLabel: null,
    };
  }
  const authority = `${ref.target.user ? `${ref.target.user}@` : ""}${ref.target.host}${ref.target.port && ref.target.port !== 22 ? `:${ref.target.port}` : ""}`;
  return {
    workspace: keyOf(ref),
    kind: "ssh",
    hostLabel: ref.target.host,
    remotePath: ref.root,
    authorityLabel: authority,
  };
}

export function writeWorkspaceBinding(manager: SessionManager, ref: WorkspaceRef): void {
  const binding = describeRef(ref);
  const existing = readWorkspaceBinding(manager);
  if (existing && existing.workspace === binding.workspace) return;
  manager.appendCustomEntry(BINDING_TYPE, { workspace: binding.workspace });
}

export function readWorkspaceBinding(manager: SessionManager): WorkspaceBinding | null {
  const entries = (manager as unknown as { fileEntries?: unknown[] }).fileEntries ?? [];
  for (const entry of entries) {
    const binding = extractBinding(entry);
    if (binding) return binding;
  }
  return null;
}

export function resolveSessionWorkspace(manager: SessionManager): WorkspaceBinding {
  return readWorkspaceBinding(manager) ?? describeRef({ kind: "local", root: manager.getCwd() as never });
}

export function resolveSessionWorkspaceByFile(filePath: string): WorkspaceBinding {
  if (!existsSync(filePath)) {
    return describeRef({ kind: "local", root: process.cwd() as never });
  }
  try {
    const manager = SessionManager.open(filePath);
    return resolveSessionWorkspace(manager);
  } catch {
    return describeRef({ kind: "local", root: process.cwd() as never });
  }
}

export function isRemoteWorkspace(binding: WorkspaceBinding): boolean {
  return binding.kind === "ssh";
}

export { describeRef, type WorkspaceBinding };
