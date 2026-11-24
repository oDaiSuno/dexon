import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { allowFileRoot } from "./file-access";

type StageInput = { name?: string; mime?: string; data: Buffer; sha256?: string; signal?: AbortSignal };
type StagedAttachment = { path: string; name: string; mime: string; size: number; deduplicated: boolean };
type StoreOptions = {
  now?: () => number;
  ttlMs?: number;
  maxTotalBytes?: number;
  cleanupIntervalMs?: number;
  timers?: {
    setInterval(callback: () => unknown, intervalMs: number): ReturnType<typeof setInterval>;
    clearInterval(handle: ReturnType<typeof setInterval>): void;
  };
};

function safeName(value = "attachment.bin"): string {
  const base = path.posix
    .basename(value.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .replace(/[. ]+$/, "");
  const suffix = path.extname(base);
  const extension = /^\.[a-z0-9]{1,10}$/i.test(suffix) ? suffix : "";
  const stem = extension ? base.slice(0, -extension.length) : base;
  let result = "";
  for (const character of stem) {
    if (Buffer.byteLength(result + character + extension) > 180) break;
    result += character;
  }
  return result ? result + extension : "attachment.bin";
}

const IMAGE_NAME =
  /\.(png|apng|jpe?g|jfif|pjpeg|pjp|gif|webp|svgz?|avif|hei[cf]|bmp|dib|tiff?|ico|cur|icns|jxl|jp2|psd|raw|xbm|xpm)$/i;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function imageMime(data: Buffer): string | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return undefined;
}

export class RemoteAttachmentError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: 400 | 413 | 500,
    message: string,
  ) {
    super(message);
    this.name = "RemoteAttachmentError";
  }
}

export class RemoteAttachmentStore {
  private readonly root: string;
  private readonly byDigest = new Map<string, string>();
  private pending: Promise<unknown> = Promise.resolve();
  private rootIdentity: { dev: number; ino: number } | undefined;
  private initialized = false;
  private disposed = false;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(work).catch((error: unknown) => {
      if (error instanceof RemoteAttachmentError) throw error;
      throw new RemoteAttachmentError("ATTACHMENT_IO_ERROR", 500, "Attachment storage operation failed");
    });
    this.pending = next.catch(() => undefined);
    return next;
  }

  constructor(
    root: string,
    private readonly options: StoreOptions = {},
  ) {
    this.root = path.resolve(root);
  }

  async initialize(): Promise<void> {
    if (this.disposed) throw new RemoteAttachmentError("STORE_DISPOSED", 500, "Attachment store is disposed");
    return this.exclusive(() => this.initializeLocked());
  }

  private async initializeLocked(): Promise<void> {
    await this.ensureRoot(!this.initialized);
    if (this.initialized) return;
    await this.cleanupLocked();
    allowFileRoot(this.root);
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".incoming-")) continue;
      const filePath = path.join(this.root, entry.name);
      const data = await this.readCandidate(filePath);
      if (data) this.byDigest.set(createHash("sha256").update(data).digest("hex"), filePath);
    }
    this.initialized = true;
    if (!this.disposed) {
      const timers: NonNullable<StoreOptions["timers"]> = this.options.timers ?? globalThis;
      this.cleanupTimer = timers.setInterval(
        () => this.cleanup().catch(() => undefined),
        this.options.cleanupIntervalMs ?? 60 * 60 * 1_000,
      );
      this.cleanupTimer.unref?.();
    }
  }

  async stage(input: StageInput): Promise<StagedAttachment> {
    if (this.disposed) throw new RemoteAttachmentError("STORE_DISPOSED", 500, "Attachment store is disposed");
    if (input.data.length > 25 * 1024 * 1024)
      throw new RemoteAttachmentError("ATTACHMENT_TOO_LARGE", 413, "File exceeds 25 MiB");
    const snapshot = { ...input, data: Buffer.from(input.data) };
    return this.exclusive(() => this.stageLocked(snapshot));
  }

  private async stageLocked(input: StageInput): Promise<StagedAttachment> {
    if (!this.initialized)
      throw new RemoteAttachmentError("STORE_NOT_INITIALIZED", 500, "Attachment store is not initialized");
    await this.ensureRoot();
    if (input.signal?.aborted)
      throw new RemoteAttachmentError("ATTACHMENT_ABORTED", 400, "Attachment staging was aborted");
    if (input.data.length === 0) throw new RemoteAttachmentError("EMPTY_ATTACHMENT", 400, "Attachment is empty");
    if (input.data.length > 25 * 1024 * 1024)
      throw new RemoteAttachmentError("ATTACHMENT_TOO_LARGE", 413, "File exceeds 25 MiB");
    const digest = createHash("sha256").update(input.data).digest("hex");
    if (
      input.sha256 !== undefined &&
      (!/^[a-f0-9]{64}$/i.test(input.sha256) || input.sha256.toLowerCase() !== digest)
    ) {
      throw new RemoteAttachmentError("INVALID_SHA256", 400, "SHA256 does not match attachment bytes");
    }
    let name = safeName(input.name);
    const candidate = input.mime?.split(";", 1)[0]?.trim().toLowerCase();
    let mime =
      candidate && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(candidate)
        ? candidate
        : "application/octet-stream";
    const detected = imageMime(input.data);
    if (!detected && (candidate?.startsWith("image/") || IMAGE_NAME.test(name))) {
      throw new RemoteAttachmentError("INVALID_IMAGE", 400, "Image format is invalid or unsupported");
    }
    if (detected) {
      if (input.data.length > 20 * 1024 * 1024)
        throw new RemoteAttachmentError("ATTACHMENT_TOO_LARGE", 413, "Image exceeds 20 MiB");
      mime = detected;
      const extension = IMAGE_EXTENSIONS[detected];
      name = `${safeName(name.slice(0, name.length - path.extname(name).length))}${extension}`;
    }
    const existing = this.byDigest.get(digest);
    if (existing) {
      if (await this.readCandidate(existing, digest)) {
        await this.cleanupLocked(existing);
        return { path: existing, name, mime, size: input.data.length, deduplicated: true };
      }
      this.byDigest.delete(digest);
    }
    const filePath = path.join(this.root, `${randomUUID()}-${name}`);
    if (input.data.length > (this.options.maxTotalBytes ?? 500 * 1024 * 1024)) {
      throw new RemoteAttachmentError("ATTACHMENT_TOO_LARGE", 413, "Attachment exceeds storage capacity");
    }
    const temporary = path.join(this.root, `.incoming-${randomUUID()}`);
    let created = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      created = true;
      try {
        await handle.writeFile(input.data, { signal: input.signal });
        const now = new Date((this.options.now ?? Date.now)());
        await handle.utimes(now, now);
      } finally {
        await handle.close();
      }
      input.signal?.throwIfAborted();
      await rename(temporary, filePath);
    } catch (error) {
      if (input.signal?.aborted)
        throw new RemoteAttachmentError("ATTACHMENT_ABORTED", 400, "Attachment staging was aborted");
      throw error;
    } finally {
      if (created)
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
    this.byDigest.set(digest, filePath);
    await this.cleanupLocked(filePath);
    return { path: filePath, name, mime, size: input.data.length, deduplicated: false };
  }

  async cleanup(): Promise<void> {
    if (this.disposed) return;
    return this.exclusive(() => this.cleanupLocked());
  }

  private async cleanupLocked(protectedPath?: string): Promise<void> {
    await this.ensureRoot();
    const now = (this.options.now ?? Date.now)();
    const files: Array<{ path: string; size: number; mtime: number }> = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filePath = path.join(this.root, entry.name);
      const info = await lstat(filePath).catch(() => undefined);
      if (!info?.isFile()) continue;
      if (
        filePath !== protectedPath &&
        (entry.name.startsWith(".incoming-") || now - info.mtimeMs > (this.options.ttlMs ?? 7 * 24 * 60 * 60 * 1_000))
      ) {
        await this.remove(filePath);
      } else {
        files.push({ path: filePath, size: info.size, mtime: info.mtimeMs });
      }
    }
    let total = files.reduce((sum, file) => sum + file.size, 0);
    files.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
    for (const file of files) {
      if (total <= (this.options.maxTotalBytes ?? 500 * 1024 * 1024)) break;
      if (file.path === protectedPath) continue;
      await this.remove(file.path);
      total -= file.size;
    }
  }

  private async ensureRoot(create = false): Promise<void> {
    let info = await lstat(this.root).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!info && create) {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      info = await lstat(this.root);
    }
    if (
      !info?.isDirectory() ||
      info.isSymbolicLink() ||
      (this.rootIdentity && (info.dev !== this.rootIdentity.dev || info.ino !== this.rootIdentity.ino))
    ) {
      throw new RemoteAttachmentError("UNSAFE_ROOT", 500, "Attachment root is not a safe directory");
    }
    await chmod(this.root, 0o700);
    this.rootIdentity = { dev: info.dev, ino: info.ino };
  }

  private async remove(filePath: string): Promise<void> {
    await unlink(filePath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    for (const [digest, existing] of this.byDigest) if (existing === filePath) this.byDigest.delete(digest);
  }

  private async readCandidate(filePath: string, digest?: string): Promise<Buffer | undefined> {
    const info = await lstat(filePath).catch(() => undefined);
    if (!info?.isFile() || info.nlink !== 1 || info.size === 0 || info.size > 25 * 1024 * 1024) return undefined;
    const handle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    ).catch(() => undefined);
    if (!handle) return undefined;
    let data: Buffer;
    const now = digest ? new Date((this.options.now ?? Date.now)()) : undefined;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== info.ino || opened.dev !== info.dev)
        return undefined;
      data = await handle.readFile();
      const detected = imageMime(data);
      const extension = path.extname(filePath).toLowerCase();
      if (
        detected
          ? extension !== IMAGE_EXTENSIONS[detected] && !(detected === "image/jpeg" && extension === ".jpeg")
          : IMAGE_NAME.test(filePath)
      )
        return undefined;
      if (digest && createHash("sha256").update(data).digest("hex") !== digest) return undefined;
      const current = await lstat(filePath).catch(() => undefined);
      if (!current?.isFile() || current.nlink !== 1 || current.dev !== opened.dev || current.ino !== opened.ino)
        return undefined;
      if (process.platform !== "win32") {
        await handle.chmod(0o600);
        if (now) await handle.utimes(now, now);
      }
    } finally {
      await handle.close();
    }
    if (process.platform === "win32" && now) await utimes(filePath, now, now);
    return data;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.cleanupTimer) (this.options.timers ?? globalThis).clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    await this.pending;
  }
}
