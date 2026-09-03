import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Staging for clipboard image attachments.
 *
 * Images pasted as bitmap data do not exist on disk, so they cannot be
 * referenced as `@path` tokens until they land somewhere. Files are written to
 * the OS temp directory under the same `pi-clipboard-<uuid>.<ext>` naming the
 * pi CLI uses for pasted images, with owner-only permissions. They are
 * disposable: the OS clears the directory on reboot, and dead tokens degrade
 * to a "missing file" visual state.
 */

/** MIME extensions accepted for staged clipboard images (mirrors pi CLI). */
export const STAGEABLE_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** Refuse absurd payloads before touching disk. */
export const MAX_STAGED_IMAGE_BYTES = 25 * 1024 * 1024;

export interface StageClipboardImageRequest {
  /** Raw image bytes, base64 encoded without the data-URL prefix. */
  base64: string;
  /** File extension without the dot, e.g. "png". */
  ext: string;
}

export interface StagedClipboardImage {
  path: string;
}

export type StageClipboardImageResult =
  | { ok: true; staged: StagedClipboardImage }
  | { ok: false; code: "unsupported-extension" | "empty-payload" | "too-large" | "write-failed"; message: string };

function normalizeExtension(ext: string): string {
  return ext.replace(/^\./, "").trim().toLowerCase();
}

export async function stageClipboardImage(request: unknown): Promise<StageClipboardImageResult> {
  const payload = request as StageClipboardImageRequest | null;
  if (!payload || typeof payload.base64 !== "string" || typeof payload.ext !== "string") {
    return { ok: false, code: "empty-payload", message: "Invalid staging payload" };
  }
  const ext = normalizeExtension(payload.ext);
  if (!STAGEABLE_IMAGE_EXTENSIONS.has(ext)) {
    return { ok: false, code: "unsupported-extension", message: `Unsupported image extension: ${ext || "none"}` };
  }
  if (payload.base64.length === 0) {
    return { ok: false, code: "empty-payload", message: "Nothing to stage" };
  }
  const bytes = Buffer.from(payload.base64, "base64");
  if (bytes.length === 0) {
    return { ok: false, code: "empty-payload", message: "Nothing to stage" };
  }
  if (bytes.length > MAX_STAGED_IMAGE_BYTES) {
    return { ok: false, code: "too-large", message: "Clipboard image exceeds the staging size limit" };
  }
  try {
    const dir = os.tmpdir();
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, `pi-clipboard-${randomUUID()}.${ext}`);
    await writeFile(target, bytes, { mode: 0o600 });
    return { ok: true, staged: { path: target } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: "write-failed", message };
  }
}
