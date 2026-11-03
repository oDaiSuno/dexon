import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  readonly remoteAgentsMdPaths: readonly string[];
  readonly remoteSkillCount: number;
  readonly localSkillCount: number;
  readonly ancestorBoundary: "git-root" | "remote-home";
  readonly boundaryPath: string;
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

function countSkillDirs(skillsRoot: string): number {
  if (!existsSync(skillsRoot)) return 0;
  try {
    return readdirSync(skillsRoot).filter((entry) => existsSync(path.join(skillsRoot, entry, "SKILL.md"))).length;
  } catch {
    return 0;
  }
}

async function extractRemoteResources(
  tarBytes: Buffer,
  mirrorRoot: string,
  remotePaths: readonly string[],
): Promise<AgentsFileEntry[]> {
  mkdirSync(mirrorRoot, { recursive: true, mode: 0o700 });
  if (!tarBytes.length) return [];
  await new Promise<void>((resolve, reject) => {
    const extraction = tar.x({ C: mirrorRoot, strip: 0 }) as unknown as NodeJS.WritableStream;
    extraction.on("finish", () => resolve());
    extraction.on("error", reject);
    Readable.from(tarBytes).pipe(extraction);
  }).catch(() => undefined);
  const entries: AgentsFileEntry[] = [];
  const agentsDir = path.join(mirrorRoot, "agents");
  if (existsSync(agentsDir)) {
    const files = readdirSync(agentsDir).sort();
    for (let index = 0; index < files.length; index += 1) {
      const filePath = path.join(agentsDir, files[index]);
      const content = readTextIfPresent(filePath);
      if (content !== null) {
        entries.push({ path: remotePaths[index] ?? filePath, content });
      }
    }
  }
  if (!entries.length) {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const filePath = path.join(mirrorRoot, name);
      const content = readTextIfPresent(filePath);
      if (content !== null) entries.push({ path: filePath, content });
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

export { mirrorDirectoryFor };

export async function fetchAndMirrorRemoteResources(
  workspace: string,
  root: PosixAbsPath,
  host: ExecutionHost,
): Promise<MirrorSnapshot> {
  const localAgentsFiles = readLocalAgentsFiles();
  const localSkillCount = countSkillDirs(path.join(getAgentDir(), "skills"));
  const mirrorRoot = mirrorDirectoryFor(workspace);
  const probeResult = await host.request("probeAndMirror", { root, createIfMissing: false }).catch(() => null);
  const remoteAgentsMdPaths = probeResult?.agentsMdPaths ?? [];
  const remoteAgentsFiles =
    probeResult?.exists && probeResult.isDirectory
      ? await extractRemoteResources(Buffer.from(probeResult.resourceTarGz), mirrorRoot, remoteAgentsMdPaths)
      : [];
  const remoteSkillCount = countSkillDirs(path.join(mirrorRoot, ".pi", "skills"));
  return {
    localAgentsFiles,
    remoteAgentsFiles,
    remoteAgentsMdPaths,
    remoteSkillCount,
    localSkillCount,
    ancestorBoundary: probeResult?.ancestorBoundary ?? "remote-home",
    boundaryPath: probeResult?.boundaryPath ?? "~",
    mirrorRoot,
    syncedAt: Date.now(),
  };
}

export function makeAgentsFilesOverride(snapshot: MirrorSnapshot) {
  return (base: { agentsFiles: AgentsFileEntry[] }): { agentsFiles: AgentsFileEntry[] } => {
    const localOnly = base.agentsFiles.filter((entry) => !BLOCKED_LOCAL_FILES.has(path.basename(entry.path)));
    return { agentsFiles: [...localOnly, ...snapshot.remoteAgentsFiles] };
  };
}

export function makeSkillsOverride(snapshot: MirrorSnapshot, trusted: boolean) {
  return <S extends { baseDir?: string; filePath?: string }, D>(base: {
    skills: S[];
    diagnostics: D[];
  }): { skills: S[]; diagnostics: D[] } => {
    if (!trusted) {
      return {
        skills: base.skills.filter(
          (skill) =>
            !(skill.baseDir?.startsWith(snapshot.mirrorRoot) || skill.filePath?.startsWith(snapshot.mirrorRoot)),
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
