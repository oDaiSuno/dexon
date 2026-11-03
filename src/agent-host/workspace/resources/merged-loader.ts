import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import * as tar from "tar";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExecutionHost } from "../host/execution-host.ts";
import type { PosixAbsPath } from "../../../shared/workspace-ref.ts";

const BLOCKED_LOCAL_FILES = new Set([
  "auth.json",
  "models.json",
  "settings.json",
  "pstack-models.md",
  "pstack-models.json",
]);

interface AgentsFileEntry {
  path: string;
  content: string;
}

export interface MirrorSnapshot {
  readonly localAgentsFiles: readonly AgentsFileEntry[];
  readonly remoteAgentsFiles: readonly AgentsFileEntry[];
  readonly mirrorRoot: string;
  readonly syncedAt: number;
}

function readLocalAgentsFiles(): AgentsFileEntry[] {
  const agentDir = getAgentDir();
  const results: AgentsFileEntry[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const filePath = path.join(agentDir, name);
    if (existsSync(filePath)) {
      try {
        results.push({ path: filePath, content: readFileSync(filePath, "utf8") });
      } catch {
        /* skip unreadable */
      }
    }
  }
  return results;
}

async function extractRemoteResources(tarBytes: Buffer, mirrorRoot: string): Promise<AgentsFileEntry[]> {
  if (!tarBytes.length) return [];
  mkdirSync(mirrorRoot, { recursive: true, mode: 0o700 });
  try {
    await new Promise<void>((resolve, reject) => {
      const readable = Readable.from(tarBytes);
      const proc = tar.x({ C: mirrorRoot, strip: 0 });
      readable.pipe(proc as unknown as NodeJS.WritableStream);
      (proc as unknown as NodeJS.EventEmitter).on("finish", () => resolve());
      (proc as unknown as NodeJS.EventEmitter).on("error", reject);
    });
  } catch {
    /* best effort extraction */
  }
  const entries: AgentsFileEntry[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const filePath = path.join(mirrorRoot, name);
    if (existsSync(filePath)) {
      try {
        entries.push({ path: filePath, content: readFileSync(filePath, "utf8") });
      } catch {
        /* skip */
      }
    }
  }
  return entries;
}

function mirrorDirectoryFor(workspace: string): string {
  const hash = workspace
    .split("")
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) & 0xffffffff, 0)
    .toString(16)
    .slice(0, 8);
  return path.join(tmpdir(), `dx-mirror-${hash}`);
}

export async function fetchAndMirrorRemoteResources(
  workspace: string,
  root: PosixAbsPath,
  host: ExecutionHost,
): Promise<MirrorSnapshot> {
  const localAgentsFiles = readLocalAgentsFiles();
  const mirrorRoot = mirrorDirectoryFor(workspace);
  let remoteAgentsFiles: AgentsFileEntry[] = [];
  try {
    const probeResult = await host.request("probeAndMirror", { root, createIfMissing: false });
    if (probeResult.exists && probeResult.isDirectory) {
      const tarBytes = Buffer.isBuffer(probeResult.resourceTarGz)
        ? probeResult.resourceTarGz
        : Buffer.from(probeResult.resourceTarGz as unknown as ArrayBuffer);
      remoteAgentsFiles = await extractRemoteResources(tarBytes, mirrorRoot);
    }
  } catch {
    /* remote unavailable — local overlay only */
  }
  return { localAgentsFiles, remoteAgentsFiles, mirrorRoot, syncedAt: Date.now() };
}

export function makeAgentsFilesOverride(snapshot: MirrorSnapshot) {
  return (base: { agentsFiles: AgentsFileEntry[] }): { agentsFiles: AgentsFileEntry[] } => {
    const localOnly = base.agentsFiles.filter((entry) => !BLOCKED_LOCAL_FILES.has(path.basename(entry.path)));
    return { agentsFiles: [...localOnly, ...snapshot.remoteAgentsFiles] };
  };
}

export function makeSkillsOverride(snapshot: MirrorSnapshot, trusted: boolean) {
  return (base: { skills: unknown[]; diagnostics: unknown[] }) => {
    if (!trusted) {
      return {
        skills: base.skills.filter(
          (skill: unknown) =>
            !(
              (skill as { baseDir?: string }).baseDir?.startsWith(snapshot.mirrorRoot) ||
              (skill as { filePath?: string }).filePath?.startsWith(snapshot.mirrorRoot)
            ),
        ),
        diagnostics: base.diagnostics,
      };
    }
    return base;
  };
}

export function cleanMirror(mirrorRoot: string): void {
  try {
    rmSync(mirrorRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export { mkdtempSync, BLOCKED_LOCAL_FILES };
