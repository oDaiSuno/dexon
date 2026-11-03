import type { FileMeta } from "../../../contract/types.ts";
import type { ManagedEndpointView } from "../../../contract/processes.ts";
import type { RemoteDirEntry } from "../../../contract/workspace.ts";
import type { HostId, PosixAbsPath, SshTarget } from "../../../shared/workspace-ref.ts";
import type { CleanupEvidence, RemoteReaperTicket } from "../../managed-process/containment-types.ts";

export type RemoteTool = "rg" | "fd" | "git" | "tar" | "python3" | "setsid" | "realpath";

export interface ProbeFacts {
  readonly platform: "linux" | "darwin";
  readonly arch: string;
  readonly remoteHome: PosixAbsPath;
  readonly bootId: string;
  readonly shellPath: PosixAbsPath;
  readonly pythonVersion: string;
  readonly tools: Readonly<Record<RemoteTool, PosixAbsPath | null>>;
}

export interface RemoteListEntry {
  readonly name: string;
  readonly type: "file" | "directory";
  readonly size: number;
  readonly mtimeMs: number;
  readonly isSymlink: boolean;
}

export interface GitWorkspaceSnapshot {
  readonly isGitRepo: boolean;
  readonly projectRoot: string;
  readonly currentBranch: string | null;
  readonly statusPorcelainV1Z: Buffer;
  readonly aheadBehind: { readonly ahead: number; readonly behind: number } | null;
  readonly branches: readonly {
    readonly name: string;
    readonly current: boolean;
    readonly committedAt: string;
  }[];
  readonly worktrees: readonly {
    readonly path: string;
    readonly head: string;
    readonly branch: string | null;
    readonly isMain: boolean;
    readonly detached: boolean;
    readonly exists: boolean;
  }[];
}

export type MimeSniff = "text" | "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "binary";

export interface RemoteOperationMap {
  browseDir: {
    input: { readonly path: PosixAbsPath | null };
    output: {
      readonly currentPath: PosixAbsPath;
      readonly remoteHome: PosixAbsPath;
      readonly entries: readonly RemoteDirEntry[];
    };
  };
  probeAndMirror: {
    input: { readonly root: PosixAbsPath; readonly createIfMissing: boolean };
    output: {
      readonly exists: boolean;
      readonly isDirectory: boolean;
      readonly canonicalRoot: PosixAbsPath;
      readonly gitRoot: PosixAbsPath | null;
      readonly boundaryPath: PosixAbsPath;
      readonly ancestorBoundary: "git-root" | "remote-home";
      readonly facts: ProbeFacts;
      readonly agentsMdPaths: readonly PosixAbsPath[];
      readonly skillRoots: readonly PosixAbsPath[];
      readonly resourceTarGz: Buffer;
    };
  };
  read: {
    input: { readonly candidates: readonly PosixAbsPath[]; readonly maxBytes: number };
    output: {
      readonly matchedPath: PosixAbsPath;
      readonly size: number;
      readonly mtimeMs: number;
      readonly writable: boolean;
      readonly mimeSniff: MimeSniff;
      readonly bytes: Buffer;
      readonly truncated: boolean;
    };
  };
  writeAtomic: {
    input: {
      readonly path: PosixAbsPath;
      readonly withinRoot: PosixAbsPath;
      readonly bytes: Buffer;
      readonly mkdirp: boolean;
    };
    output: { readonly canonicalPath: PosixAbsPath; readonly size: number; readonly mtimeMs: number };
  };
  listDir: {
    input: {
      readonly path: PosixAbsPath;
      readonly withinRoot: PosixAbsPath | null;
      readonly ignore: readonly string[];
    };
    output: { readonly canonicalPath: PosixAbsPath; readonly entries: readonly RemoteListEntry[] };
  };
  fileMeta: {
    input: { readonly path: PosixAbsPath; readonly withinRoot: PosixAbsPath | null };
    output: FileMeta & { readonly canonicalPath: PosixAbsPath; readonly isDirectory: boolean };
  };
  fileIndex: {
    input: { readonly root: PosixAbsPath; readonly query: string; readonly limit: number };
    output: {
      readonly paths: readonly { readonly path: string; readonly isDir: boolean }[];
      readonly truncated: boolean;
      readonly truncatedReason?: "depth" | "count";
      readonly degradedReason?: "search-unavailable" | "search-timeout" | "search-failed";
    };
  };
  search: {
    input:
      | {
          readonly kind: "grep";
          readonly cwd: PosixAbsPath;
          readonly rgArgv: readonly string[];
          readonly maxBytes: number;
        }
      | {
          readonly kind: "find";
          readonly cwd: PosixAbsPath;
          readonly searchPath: PosixAbsPath;
          readonly pattern: string;
          readonly limit: number;
        };
    output: { readonly stdout: Buffer; readonly truncated: boolean; readonly exitCode: number };
  };
  gitSnapshot: {
    input: { readonly cwd: PosixAbsPath };
    output: GitWorkspaceSnapshot;
  };
  gitExec: {
    input: { readonly cwd: PosixAbsPath; readonly gitArgv: readonly string[]; readonly timeoutMs: number };
    output: { readonly exitCode: number; readonly stdout: Buffer; readonly stderr: Buffer };
  };
  watchStart: {
    input: { readonly path: PosixAbsPath; readonly withinRoot: PosixAbsPath | null; readonly intervalMs: number };
    output: { readonly watchId: string };
  };
  watchStop: {
    input: { readonly watchId: string };
    output: { readonly ok: true };
  };
  reconcileRuns: {
    input: { readonly tickets: readonly RemoteReaperTicket[] };
    output: { readonly evidence: readonly CleanupEvidence[] };
  };
}

export type RemoteOpName = keyof RemoteOperationMap;

export interface RemoteLoopbackCandidate {
  readonly id: string;
  readonly sourceUrl: string;
  readonly scheme: "http" | "https";
  readonly remoteLoopback: "127.0.0.1" | "::1";
  readonly remotePort: number;
  readonly pathAndQuery: string;
}

export interface RemoteExecRequest {
  readonly argv: readonly string[];
  readonly cwd: PosixAbsPath;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: Buffer;
  readonly timeoutMs?: number;
  readonly onData: (stream: "stdout" | "stderr", chunk: Buffer) => void;
}

export interface RemoteExecOutcome {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly transportDropped: boolean;
}

export interface RemoteWatchEvent {
  readonly watchId: string;
  readonly path: PosixAbsPath;
  readonly event: "change" | "removed";
  readonly mtimeMs?: number;
  readonly size?: number;
}

export type HostConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export interface HostConnectionEvent {
  readonly state: HostConnectionState;
  readonly epoch: number;
  readonly rttMs?: number;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly error?: string;
}

export interface ExecutionHost {
  readonly id: HostId;
  readonly kind: "ssh";
  readonly target: SshTarget;
  connect(signal?: AbortSignal): Promise<ProbeFacts>;
  facts(): ProbeFacts | null;
  connectionState(): HostConnectionEvent;
  onConnection(listener: (event: HostConnectionEvent) => void): () => void;
  request<K extends RemoteOpName>(
    op: K,
    input: RemoteOperationMap[K]["input"],
    signal?: AbortSignal,
  ): Promise<RemoteOperationMap[K]["output"]>;
  streamExec(request: RemoteExecRequest, signal?: AbortSignal): Promise<RemoteExecOutcome>;
  watchPath(
    input: RemoteOperationMap["watchStart"]["input"],
    listener: (event: RemoteWatchEvent) => void,
  ): Promise<() => Promise<void>>;
  controlPath(): string | null;
  reconnect(): Promise<ProbeFacts>;
  dispose(): Promise<void>;
}

export type { ManagedEndpointView };

export type BridgedEndpointView =
  | {
      readonly state: "available";
      readonly id: string;
      readonly sourceUrl: string;
      readonly openUrl: string;
      readonly localPort: number;
      readonly remotePort: number;
      readonly portShifted: boolean;
    }
  | {
      readonly state: "unavailable";
      readonly id: string;
      readonly sourceUrl: string;
      readonly reason: string;
    };

export interface SshProcessInfo {
  readonly pid: number;
  readonly pgid: number;
  readonly bootId: string;
  readonly startFingerprint: string;
}
