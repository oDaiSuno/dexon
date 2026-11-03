import { existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PosixAbsPath } from "../../shared/workspace-ref.ts";

const CREDENTIAL_FILES = new Set(["auth.json", "models.json", "settings.json"]);
const CREDENTIAL_EXTENSIONS = [".key", ".pem"];

const DENIED_CREDENTIAL = "Access denied: local credential files are protected in remote workspaces";
const DENIED_READ_ONLY = "Local overlay is read-only";
const DENIED_OUTSIDE = "Path is outside the allowed workspace roots";

export type PathSpaceRoute =
  | { readonly space: "remote"; readonly remotePath: PosixAbsPath }
  | { readonly space: "local-overlay"; readonly localPath: string; readonly kind: "file" | "directory" }
  | { readonly space: "denied"; readonly message: string };

interface OverlayGrant {
  readonly localPath: string;
  readonly kind: "file" | "directory";
}

function isCredentialFile(fileName: string): boolean {
  if (CREDENTIAL_FILES.has(fileName)) return true;
  return CREDENTIAL_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

function expandTilde(rawPath: string, home: string): string {
  if (rawPath === "~") return home;
  if (rawPath.startsWith("~/")) return path.join(home, rawPath.slice(2));
  if (rawPath.startsWith("~\\")) return path.join(home, rawPath.slice(2));
  return rawPath;
}

function stripLeadingAt(rawPath: string): string {
  return rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
}

interface PathSpaceConfig {
  readonly remoteRoot: PosixAbsPath;
  readonly remoteHome: PosixAbsPath;
}

export class PathSpace {
  private readonly remoteRoot: PosixAbsPath;
  private readonly remoteHome: PosixAbsPath;
  private readonly localHome: string;
  private readonly localAgentDir: string;
  private readonly localUserAgentsSkillsDir: string;
  private readonly localPiPackageRoot: string;
  private readonly bashOutputFiles = new Set<string>();

  constructor(config: PathSpaceConfig) {
    this.remoteRoot = config.remoteRoot;
    this.remoteHome = config.remoteHome;
    this.localHome = homedir();
    this.localAgentDir = getAgentDir();
    this.localUserAgentsSkillsDir = path.join(this.localHome, ".agents", "skills");
    this.localPiPackageRoot = this.resolvePiPackageRoot();
  }

  private resolvePiPackageRoot(): string {
    try {
      const mainPath = require.resolve("@earendil-works/pi-coding-agent/package.json");
      return path.dirname(mainPath);
    } catch {
      return "";
    }
  }

  registerBashOutputFile(localPath: string): void {
    this.bashOutputFiles.add(localPath);
  }

  private getOverlayGrants(): OverlayGrant[] {
    const grants: OverlayGrant[] = [];
    grants.push({ localPath: path.join(this.localAgentDir, "AGENTS.md"), kind: "file" });
    grants.push({ localPath: path.join(this.localAgentDir, "CLAUDE.md"), kind: "file" });
    grants.push({ localPath: path.join(this.localAgentDir, "skills"), kind: "directory" });
    grants.push({ localPath: path.join(this.localAgentDir, "prompts"), kind: "directory" });
    grants.push({ localPath: this.localUserAgentsSkillsDir, kind: "directory" });
    if (this.localPiPackageRoot) {
      grants.push({ localPath: path.join(this.localPiPackageRoot, "README.md"), kind: "file" });
      grants.push({ localPath: path.join(this.localPiPackageRoot, "docs"), kind: "directory" });
      grants.push({ localPath: path.join(this.localPiPackageRoot, "examples"), kind: "directory" });
    }
    return grants;
  }

  private isUnderAgentDir(resolvedPath: string): boolean {
    const agentDir = path.resolve(this.localAgentDir);
    const target = path.resolve(resolvedPath);
    return target === agentDir || target.startsWith(agentDir + path.sep);
  }

  private matchesOverlayGrant(resolvedPath: string): OverlayGrant | null {
    const target = path.resolve(resolvedPath);
    for (const grant of this.getOverlayGrants()) {
      const grantAbs = path.resolve(grant.localPath);
      if (grant.kind === "file" && target === grantAbs) return grant;
      if (grant.kind === "directory" && (target === grantAbs || target.startsWith(grantAbs + path.sep))) return grant;
    }
    return null;
  }

  private isBashOutputFile(resolvedPath: string): boolean {
    const target = path.resolve(resolvedPath);
    if (this.bashOutputFiles.has(target)) return true;
    const piBashPattern = path.join(tmpdir(), "pi-bash-");
    return target.startsWith(piBashPattern) && target.endsWith(".log");
  }

  route(rawPath: string, effectiveCwd: string, intent: "read" | "write" | "edit" | "ls" | "search"): PathSpaceRoute {
    let cleaned = stripLeadingAt(rawPath);
    cleaned = cleaned.trim();
    if (!cleaned) {
      return { space: "denied", message: "A path is required" };
    }

    const expandedLocal = expandTilde(cleaned, this.localHome);
    const resolvedLocal = path.resolve(expandedLocal);

    if (this.isUnderAgentDir(resolvedLocal)) {
      const fileName = path.basename(resolvedLocal);
      if (isCredentialFile(fileName)) {
        return { space: "denied", message: DENIED_CREDENTIAL };
      }
      const grant = this.matchesOverlayGrant(resolvedLocal);
      if (grant) {
        if (intent !== "read" && intent !== "ls") {
          return { space: "denied", message: DENIED_READ_ONLY };
        }
        return { space: "local-overlay", localPath: resolvedLocal, kind: grant.kind };
      }
      return { space: "denied", message: DENIED_CREDENTIAL };
    }

    const userAgentsSkills = path.resolve(this.localUserAgentsSkillsDir);
    if (resolvedLocal === userAgentsSkills || resolvedLocal.startsWith(userAgentsSkills + path.sep)) {
      if (intent !== "read" && intent !== "ls") {
        return { space: "denied", message: DENIED_READ_ONLY };
      }
      return { space: "local-overlay", localPath: resolvedLocal, kind: "directory" };
    }

    if (this.localPiPackageRoot) {
      const piRoot = path.resolve(this.localPiPackageRoot);
      if (resolvedLocal === piRoot || resolvedLocal.startsWith(piRoot + path.sep)) {
        const readmePath = path.join(piRoot, "README.md");
        const docsPath = path.join(piRoot, "docs");
        const examplesPath = path.join(piRoot, "examples");
        if (
          resolvedLocal === readmePath ||
          resolvedLocal.startsWith(docsPath + path.sep) ||
          resolvedLocal === docsPath ||
          resolvedLocal.startsWith(examplesPath + path.sep) ||
          resolvedLocal === examplesPath
        ) {
          if (intent !== "read" && intent !== "ls") {
            return { space: "denied", message: DENIED_READ_ONLY };
          }
          return {
            space: "local-overlay",
            localPath: resolvedLocal,
            kind: existsSync(resolvedLocal) && statSync(resolvedLocal).isDirectory() ? "directory" : "file",
          };
        }
      }
    }

    if (this.isBashOutputFile(resolvedLocal)) {
      if (intent !== "read" && intent !== "ls") {
        return { space: "denied", message: DENIED_READ_ONLY };
      }
      return { space: "local-overlay", localPath: resolvedLocal, kind: "file" };
    }

    if (path.isAbsolute(cleaned) && !cleaned.startsWith("/")) {
      return { space: "denied", message: DENIED_OUTSIDE };
    }

    const baseRemote = this.remoteRoot;
    let remotePath: string;
    if (cleaned.startsWith("~")) {
      const expandedRemote = cleaned === "~" ? this.remoteHome : path.posix.join(this.remoteHome, cleaned.slice(2));
      remotePath = path.posix.resolve(expandedRemote);
    } else if (cleaned.startsWith("/")) {
      remotePath = path.posix.resolve(cleaned);
    } else {
      let base = baseRemote;
      if (effectiveCwd && effectiveCwd.startsWith("/")) {
        base = effectiveCwd as PosixAbsPath;
      }
      remotePath = path.posix.resolve(base, cleaned);
    }

    return { space: "remote", remotePath: remotePath as PosixAbsPath };
  }

  advertisedLocalRoots(): readonly string[] {
    return this.getOverlayGrants().map((g) => g.localPath);
  }
}

export function createPathSpace(remoteRoot: PosixAbsPath, remoteHome: PosixAbsPath): PathSpace {
  return new PathSpace({ remoteRoot, remoteHome });
}

export { DENIED_CREDENTIAL, DENIED_READ_ONLY };
