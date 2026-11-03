import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  truncateHead,
  type BashToolOptions,
} from "@earendil-works/pi-coding-agent";
import { RemoteOperationError } from "./host/errors.ts";
import type { ExecutionHost } from "./host/execution-host.ts";
import type { PosixAbsPath, WorkspaceKey } from "../../shared/workspace-ref.ts";
import { defineDexonTool, type DexonToolMetadata } from "../agent-session/tool-definition.ts";
import { isRemoteWorkspaceTrusted } from "./trust-store.ts";
import { createPathSpace, type PathSpace } from "./path-space.ts";
import { remoteCommandEnvironment } from "./remote-environment.ts";

const DEFAULT_READ_MAX_BYTES = 10 * 1024 * 1024;
const SEARCH_OUTPUT_LIMIT = 2 * 1024 * 1024;
const READ_ONLY_ERROR_MESSAGE =
  "Remote workspace is in safe read-only mode. Trust this repository to modify files or run commands.";

function toAbsPath(input: string): PosixAbsPath {
  if (typeof input !== "string" || !input.startsWith("/")) {
    throw new RemoteOperationError("BAD_REQUEST", "An absolute path is required");
  }
  return input as PosixAbsPath;
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(value as ArrayBuffer);
}

function defaultPathSpace(cwd: string, host: ExecutionHost): PathSpace {
  const remoteRoot = toAbsPath(cwd);
  const remoteHome = host.facts()?.remoteHome ?? ("/root" as PosixAbsPath);
  return createPathSpace(remoteRoot, remoteHome);
}

function assertWorkspaceTrusted(workspaceKey?: WorkspaceKey): void {
  if (workspaceKey && !isRemoteWorkspaceTrusted(workspaceKey)) {
    throw new RemoteOperationError("EACCES", READ_ONLY_ERROR_MESSAGE);
  }
}

export function createRemoteReadToolDefinition(
  cwd: string,
  host: ExecutionHost,
  pathSpace = defaultPathSpace(cwd, host),
): ReturnType<typeof createReadToolDefinition> & DexonToolMetadata {
  return defineDexonTool({
    ...createReadToolDefinition(cwd, {
      operations: {
        async readFile(absolutePath: string) {
          const routed = pathSpace.route(absolutePath, cwd, "read");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space === "local-overlay") {
            return readFileSync(routed.localPath);
          }
          const result = await host.request("read", {
            candidates: [routed.remotePath],
            maxBytes: DEFAULT_READ_MAX_BYTES,
          });
          return toBuffer(result.bytes);
        },
        async access(absolutePath: string) {
          const routed = pathSpace.route(absolutePath, cwd, "read");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space === "local-overlay") {
            if (!existsSync(routed.localPath)) {
              throw new RemoteOperationError("ENOENT", `File not found: ${absolutePath}`);
            }
            return;
          }
          await host.request("fileMeta", { path: routed.remotePath, withinRoot: null });
        },
      },
    }),
    dexonOwner: "coding",
    promptSnippet: "Read remote file contents over SSH.",
  });
}

export function createRemoteWriteToolDefinition(
  cwd: string,
  host: ExecutionHost,
  options: { pathSpace?: PathSpace; workspaceKey?: WorkspaceKey } = {},
): ReturnType<typeof createWriteToolDefinition> & DexonToolMetadata {
  const root = cwd as PosixAbsPath;
  const pathSpace = options.pathSpace ?? defaultPathSpace(cwd, host);
  return defineDexonTool({
    ...createWriteToolDefinition(cwd, {
      operations: {
        async writeFile(absolutePath: string, content: string) {
          assertWorkspaceTrusted(options.workspaceKey);
          const routed = pathSpace.route(absolutePath, cwd, "write");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space !== "remote") {
            throw new RemoteOperationError("EACCES", "Local overlay is read-only");
          }
          await host.request("writeAtomic", {
            path: routed.remotePath,
            withinRoot: root,
            bytes: Buffer.from(content, "utf8"),
            mkdirp: true,
          });
        },
        async mkdir(dir: string) {
          assertWorkspaceTrusted(options.workspaceKey);
          const routed = pathSpace.route(dir, cwd, "write");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space !== "remote") {
            throw new RemoteOperationError("EACCES", "Local overlay is read-only");
          }
          await host.request("makeDir", { path: routed.remotePath, withinRoot: root });
        },
      },
    }),
    dexonOwner: "coding",
    promptSnippet: "Create or overwrite remote files over SSH.",
  });
}

export function createRemoteEditToolDefinition(
  cwd: string,
  host: ExecutionHost,
  options: { pathSpace?: PathSpace; workspaceKey?: WorkspaceKey } = {},
): ReturnType<typeof createEditToolDefinition> & DexonToolMetadata {
  const root = cwd as PosixAbsPath;
  const pathSpace = options.pathSpace ?? defaultPathSpace(cwd, host);
  return defineDexonTool({
    ...createEditToolDefinition(cwd, {
      operations: {
        async readFile(absolutePath: string) {
          assertWorkspaceTrusted(options.workspaceKey);
          const routed = pathSpace.route(absolutePath, cwd, "edit");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space !== "remote") {
            throw new RemoteOperationError("EACCES", "Local overlay is read-only");
          }
          const result = await host.request("read", {
            candidates: [routed.remotePath],
            maxBytes: DEFAULT_READ_MAX_BYTES,
          });
          return toBuffer(result.bytes);
        },
        async writeFile(absolutePath: string, content: string) {
          assertWorkspaceTrusted(options.workspaceKey);
          const routed = pathSpace.route(absolutePath, cwd, "edit");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space !== "remote") {
            throw new RemoteOperationError("EACCES", "Local overlay is read-only");
          }
          await host.request("writeAtomic", {
            path: routed.remotePath,
            withinRoot: root,
            bytes: Buffer.from(content, "utf8"),
            mkdirp: true,
          });
        },
        async access(absolutePath: string) {
          assertWorkspaceTrusted(options.workspaceKey);
          const routed = pathSpace.route(absolutePath, cwd, "edit");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space !== "remote") {
            throw new RemoteOperationError("EACCES", "Local overlay is read-only");
          }
          await host.request("fileMeta", { path: routed.remotePath, withinRoot: null });
        },
      },
    }),
    dexonOwner: "coding",
    promptSnippet: "Make precise remote file edits over SSH.",
  });
}

export function createRemoteLsToolDefinition(
  cwd: string,
  host: ExecutionHost,
  pathSpace = defaultPathSpace(cwd, host),
): ReturnType<typeof createLsToolDefinition> & DexonToolMetadata {
  return defineDexonTool({
    ...createLsToolDefinition(cwd, {
      operations: {
        exists(absolutePath: string) {
          const routed = pathSpace.route(absolutePath, cwd, "ls");
          if (routed.space === "denied") return false;
          if (routed.space === "local-overlay") return existsSync(routed.localPath);
          return host
            .request("fileMeta", { path: routed.remotePath, withinRoot: null })
            .then(() => true)
            .catch(() => false);
        },
        async stat(absolutePath: string) {
          const routed = pathSpace.route(absolutePath, cwd, "ls");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space === "local-overlay") {
            const st = statSync(routed.localPath);
            return { isDirectory: () => st.isDirectory() };
          }
          const result = await host.request("fileMeta", { path: routed.remotePath, withinRoot: null });
          return { isDirectory: () => result.isDirectory };
        },
        async readdir(absolutePath: string) {
          const routed = pathSpace.route(absolutePath, cwd, "ls");
          if (routed.space === "denied") {
            throw new RemoteOperationError("EACCES", routed.message);
          }
          if (routed.space === "local-overlay") {
            return readdirSync(routed.localPath);
          }
          const result = await host.request("listDir", {
            path: routed.remotePath,
            withinRoot: null,
            ignore: ["node_modules", ".git"],
          });
          return result.entries.map((entry) => entry.name);
        },
      },
    }),
    dexonOwner: "coding",
    promptSnippet: "List remote directory contents over SSH.",
  });
}

export function createRemoteBashToolDefinition(
  cwd: string,
  host: ExecutionHost,
  options: { workspaceKey?: WorkspaceKey } = {},
): ReturnType<typeof createBashToolDefinition> & DexonToolMetadata {
  const operations: BashToolOptions["operations"] = {
    async exec(command: string, execCwd: string, execOptions) {
      assertWorkspaceTrusted(options.workspaceKey);
      const result = await host.streamExec({
        argv: ["/bin/sh", "-c", command],
        cwd: (execCwd || cwd) as PosixAbsPath,
        env: remoteCommandEnvironment(execOptions.env),
        ...(execOptions.timeout ? { timeoutMs: execOptions.timeout } : {}),
        onData: (_stream, chunk) => execOptions.onData?.(chunk),
      });
      return { exitCode: result.exitCode ?? null };
    },
  };
  return defineDexonTool({
    ...createBashToolDefinition(cwd, { operations }),
    dexonOwner: "coding",
    promptSnippet: "Run shell commands on the remote server over SSH.",
  });
}

export function createRemoteSearchToolDefinitions(
  cwd: string,
  host: ExecutionHost,
): [
  ReturnType<typeof createGrepToolDefinition> & DexonToolMetadata,
  ReturnType<typeof createFindToolDefinition> & DexonToolMetadata,
] {
  const grep = createGrepToolDefinition(cwd);
  grep.execute = async (_toolCallId, input, signal) => {
    const searchPath = input.path || cwd;
    const args = ["--json", "--line-number", "--color=never", "--hidden", "--max-columns", "2000"];
    if (input.ignoreCase) args.push("--ignore-case");
    if (input.literal) args.push("--fixed-strings");
    if (input.glob) args.push("--glob", input.glob);
    if (input.context && input.context > 0) args.push("--context", String(Math.floor(input.context)));
    args.push("--", input.pattern, searchPath);
    const result = await host.request(
      "search",
      { kind: "grep", cwd: cwd as PosixAbsPath, rgArgv: args, maxBytes: SEARCH_OUTPUT_LIMIT },
      signal,
    );
    const stdout = toBuffer(result.stdout).toString("utf8");
    const truncation = truncateHead(stdout);
    return {
      content: [{ type: "text", text: truncation.content || "No matches found" }],
      details: result.truncated ? { truncation } : undefined,
    };
  };

  const find = createFindToolDefinition(cwd, {
    operations: {
      async exists(absolutePath: string) {
        try {
          await host.request("fileMeta", { path: toAbsPath(absolutePath), withinRoot: null });
          return true;
        } catch {
          return false;
        }
      },
      async glob(pattern: string, searchPath: string, options) {
        const result = await host.request("fileIndex", {
          root: toAbsPath(searchPath),
          query: pattern,
          limit: options.limit ?? 300,
        });
        return result.paths.map((entry) => entry.path);
      },
    },
  });

  return [
    defineDexonTool({
      ...grep,
      dexonOwner: "coding",
      promptSnippet: "Search remote file contents with ripgrep over SSH.",
    }),
    defineDexonTool({
      ...find,
      dexonOwner: "coding",
      promptSnippet: "Find remote files by glob over SSH.",
    }),
  ];
}

export function createAllRemoteCodingTools(
  cwd: string,
  host: ExecutionHost,
  options: { workspaceKey?: WorkspaceKey } = {},
) {
  const pathSpace = defaultPathSpace(cwd, host);
  const [grep, find] = createRemoteSearchToolDefinitions(cwd, host);
  return [
    createRemoteReadToolDefinition(cwd, host, pathSpace),
    createRemoteWriteToolDefinition(cwd, host, { pathSpace, workspaceKey: options.workspaceKey }),
    createRemoteEditToolDefinition(cwd, host, { pathSpace, workspaceKey: options.workspaceKey }),
    createRemoteLsToolDefinition(cwd, host, pathSpace),
    createRemoteBashToolDefinition(cwd, host, { workspaceKey: options.workspaceKey }),
    grep,
    find,
  ] as const;
}
