import { mkdirSync, readFileSync, rmSync } from "node:fs";
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

function readTextIfPresent(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readLocalAgentsFiles(): AgentsFileEntry[] {
  const agentDir = getAgentDir();
  const results: AgentsFileEntry[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const filePath = path.join(agentDir, name);
    const content = readTextIfPresent(filePath);
    if (content !== null) results.push({ path: filePath, content });
  }
  return results;
}

async function extractRemoteResources(tarBytes: Buffer, mirrorRoot: string): Promise<AgentsFileEntry[]> {
  if (!tarBytes.length) return [];
  mkdirSync(mirrorRoot, { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    const extraction = tar.x({ C: mirrorRoot, strip: 0 }) as unknown as NodeJS.WritableStream;
    extraction.on("finish", () => resolve());
    extraction.on("error", reject);
    Readable.from(tarBytes).pipe(extraction);
  }).catch(() => undefined);
  const entries: AgentsFileEntry[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const filePath = path.join(mirrorRoot, name);
    const content = readTextIfPresent(filePath);
    if (content !== null) entries.push({ path: filePath, content });
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
  const probeResult = await host.request("probeAndMirror", { root, createIfMissing: false }).catch(() => null);
  const remoteAgentsFiles =
    probeResult?.exists && probeResult.isDirectory
      ? await extractRemoteResources(Buffer.from(probeResult.resourceTarGz), mirrorRoot)
      : [];
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
  rmSync(mirrorRoot, { recursive: true, force: true });
}

export { BLOCKED_LOCAL_FILES };
