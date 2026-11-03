import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import {
  DOCX_PREVIEW_MAX_BYTES,
  FILE_DOWNLOAD_MAX_BYTES,
  IMAGE_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  documentPreviewKind,
  getAudioMime,
  getDocumentMime,
  getImageMime,
} from "../../shared/file-types";
import { parseWorkspaceInput, keyOf, joinWorkspaceKeyPath } from "../../shared/workspace-ref";
import { assertPathAllowed } from "../file-access";
import { getOrCreateHost } from "../workspace/registry";
import { createFileWatchService, stopAllFileWatches } from "../file-watch";
import { FileSuggestionRequestError, fileSuggestionService } from "../file-suggestions";

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".turbo",
  ".cache",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "vendor",
  ".DS_Store",
]);

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  jsonl: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
  mdx: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  txt: "text",
};

function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

export function registerFileHandlers(server: RpcServer): () => Promise<void> {
  const fileWatch = createFileWatchService(server);

  server.handle({
    "files.list": async (params) => {
      const { path: dirPath } = params as { path: string };
      const sshParsed = parseWorkspaceInput(dirPath);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const result = await host.request("listDir", {
          path: ref.root,
          withinRoot: null,
          ignore: [...IGNORED_NAMES],
        });
        const entries = result.entries.map((entry) => ({
          name: entry.name,
          path: joinWorkspaceKeyPath(keyOf(ref), entry.name),
          isDir: entry.type === "directory",
          type: entry.type,
          size: entry.size,
          mtime: entry.mtimeMs,
        }));
        entries.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return { entries: entries as never };
      }
      await assertPathAllowed(dirPath);
      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
        throw new RpcError({ code: "NOT_FOUND", message: "Directory not found" });
      }
      const names = readdirSync(dirPath);
      const entries: Array<{
        name: string;
        isDir: boolean;
        size?: number;
        mtime?: number;
        path: string;
        type: "file" | "directory";
      }> = [];
      for (const name of names) {
        if (IGNORED_NAMES.has(name)) continue;
        const full = path.join(dirPath, name);
        try {
          const st = statSync(full);
          const isDir = st.isDirectory();
          entries.push({
            name,
            path: full,
            isDir,
            type: isDir ? "directory" : "file",
            size: st.size,
            mtime: st.mtimeMs,
          });
        } catch {
          /* skip unreadable */
        }
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { entries: entries as never };
    },

    "files.read": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      const sshParsed = parseWorkspaceInput(filePath);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const result = await host.request("read", {
          candidates: [ref.root],
          maxBytes: TEXT_PREVIEW_MAX_BYTES,
        });
        const bytes = Buffer.from(result.bytes);
        const mime = getImageMime(ref.root) || getAudioMime(ref.root) || getDocumentMime(ref.root);
        if (mime) {
          return {
            content: bytes.toString("base64"),
            encoding: "base64" as const,
            mime,
            language: getLanguage(ref.root),
            size: bytes.length,
            truncated: false,
          };
        }
        return {
          content: bytes.toString("utf8"),
          encoding: "utf8" as const,
          language: getLanguage(ref.root),
          size: bytes.length,
          truncated: result.truncated ?? false,
        };
      }
      await assertPathAllowed(filePath, sourceSessionId);
      const st = statSync(filePath);
      if (!st.isFile()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Not a file" });
      }

      const imageMime = getImageMime(filePath);
      const audioMime = getAudioMime(filePath);
      const documentMime = getDocumentMime(filePath);
      const binaryMime = imageMime || audioMime || documentMime;

      if (binaryMime) {
        const limit = imageMime ? IMAGE_PREVIEW_MAX_BYTES : documentMime ? DOCX_PREVIEW_MAX_BYTES : 50 * 1024 * 1024;
        if (st.size > limit) {
          return {
            content: "",
            encoding: "too_large" as const,
            mime: binaryMime,
            language: getLanguage(filePath),
            size: st.size,
            truncated: true,
          };
        }
        return {
          content: readFileSync(filePath).toString("base64"),
          encoding: "base64" as const,
          mime: binaryMime,
          language: getLanguage(filePath),
          size: st.size,
          truncated: false,
        };
      }

      const fd = await import("fs").then((fs) => fs.openSync(filePath, "r"));
      try {
        const max = Math.min(st.size, TEXT_PREVIEW_MAX_BYTES);
        const buf = Buffer.alloc(max);
        const n = (await import("fs")).readSync(fd, buf, 0, max, 0);
        return {
          content: buf.slice(0, n).toString("utf8"),
          encoding: "utf8" as const,
          language: getLanguage(filePath),
          size: st.size,
          truncated: st.size > TEXT_PREVIEW_MAX_BYTES,
        };
      } finally {
        (await import("fs")).closeSync(fd);
      }
    },

    "files.download": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      const sshParsed = parseWorkspaceInput(filePath);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const result = await host.request("read", {
          candidates: [ref.root],
          maxBytes: FILE_DOWNLOAD_MAX_BYTES,
        });
        const bytes = Buffer.from(result.bytes);
        if (bytes.length > FILE_DOWNLOAD_MAX_BYTES) {
          throw new RpcError({
            code: "RESULT_TOO_LARGE",
            message: `File exceeds the ${FILE_DOWNLOAD_MAX_BYTES / 1024 / 1024} MiB download limit`,
            detail: { size: bytes.length, maxBytes: FILE_DOWNLOAD_MAX_BYTES },
          });
        }
        return {
          base64: bytes.toString("base64"),
          size: bytes.length,
          mime:
            getImageMime(ref.root) || getAudioMime(ref.root) || getDocumentMime(ref.root) || "application/octet-stream",
        };
      }
      await assertPathAllowed(filePath, sourceSessionId);
      const st = statSync(filePath);
      if (!st.isFile()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Not a file" });
      }
      if (st.size > FILE_DOWNLOAD_MAX_BYTES) {
        throw new RpcError({
          code: "RESULT_TOO_LARGE",
          message: `File exceeds the ${FILE_DOWNLOAD_MAX_BYTES / 1024 / 1024} MiB download limit`,
          detail: { size: st.size, maxBytes: FILE_DOWNLOAD_MAX_BYTES },
        });
      }
      return {
        base64: readFileSync(filePath).toString("base64"),
        size: st.size,
        mime:
          getImageMime(filePath) || getAudioMime(filePath) || getDocumentMime(filePath) || "application/octet-stream",
      };
    },

    "files.meta": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      const sshParsed = parseWorkspaceInput(filePath);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const meta = await host.request("fileMeta", { path: ref.root, withinRoot: null });
        const imageMime = getImageMime(ref.root);
        const audioMime = getAudioMime(ref.root);
        const documentMime = getDocumentMime(ref.root);
        return {
          size: meta.size,
          mtime: meta.mtimeMs as number,
          language: getLanguage(ref.root),
          kind: documentPreviewKind(ref.root) ?? (imageMime ? "image" : "file"),
          mime: imageMime ?? audioMime ?? documentMime ?? "text/plain",
        };
      }
      await assertPathAllowed(filePath, sourceSessionId);
      const st = statSync(filePath);
      const imageMime = getImageMime(filePath);
      const audioMime = getAudioMime(filePath);
      const documentMime = getDocumentMime(filePath);
      return {
        size: st.size,
        mtime: st.mtimeMs,
        language: getLanguage(filePath),
        kind: documentPreviewKind(filePath) ?? (imageMime ? "image" : "file"),
        mime: imageMime ?? audioMime ?? documentMime ?? "text/plain",
      };
    },

    "files.preview": async (params) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      await assertPathAllowed(filePath, sourceSessionId);
      const st = statSync(filePath);
      const imgMime = getImageMime(filePath);
      if (imgMime) {
        if (st.size > IMAGE_PREVIEW_MAX_BYTES) {
          return { kind: "too_large", mime: imgMime, size: st.size };
        }
        return {
          kind: "image",
          mime: imgMime,
          base64: readFileSync(filePath).toString("base64"),
        };
      }
      const docKind = documentPreviewKind(filePath);
      if (docKind === "docx") {
        if (st.size > DOCX_PREVIEW_MAX_BYTES) {
          return { kind: "too_large", mime: getDocumentMime(filePath) ?? undefined, size: st.size };
        }
        return {
          kind: "docx",
          mime: getDocumentMime(filePath) ?? undefined,
          base64: readFileSync(filePath).toString("base64"),
        };
      }
      if (st.size > TEXT_PREVIEW_MAX_BYTES) {
        return {
          kind: "text",
          content: readFileSync(filePath, "utf8").slice(0, TEXT_PREVIEW_MAX_BYTES),
          language: getLanguage(filePath),
          truncated: true,
        };
      }
      return {
        kind: "text",
        content: readFileSync(filePath, "utf8"),
        language: getLanguage(filePath),
      };
    },

    "files.index": async (params) => {
      const { root, query } = params as { root: string; query?: string };
      const sshParsed = parseWorkspaceInput(root);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const result = await host.request("fileIndex", {
          root: ref.root,
          query: query ?? "",
          limit: 20,
        });
        return {
          files: result.paths.map((p) => p.path),
          truncated: false,
          matches: result.paths.map((p) => ({ path: p.path, isDir: false, score: 0 })),
        };
      }
      await assertPathAllowed(root);
      try {
        return await fileSuggestionService.suggest(root, query);
      } catch (error) {
        if (error instanceof FileSuggestionRequestError) {
          throw new RpcError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    },

    "files.watchStart": async (params, context) => {
      const { path: filePath, sourceSessionId } = params as {
        path: string;
        sourceSessionId?: string;
      };
      const leaseKey = `files.watch:${filePath}`;
      context?.releaseLease(leaseKey);
      const release = await fileWatch.start(filePath, sourceSessionId);
      context?.setLease(leaseKey, release);
      return { ok: true as const };
    },

    "files.watchStop": async (params, context) => {
      const { path: filePath } = params as { path: string };
      if (context) context.releaseLease(`files.watch:${filePath}`);
      else fileWatch.stop(filePath);
      return { ok: true as const };
    },
  });

  return async () => {
    stopAllFileWatches();
  };
}
