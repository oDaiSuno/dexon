/**
 * Image normalization pipeline for inline attachments.
 *
 * Mirrors pi's image pipeline (utils/image-process.js + image-resize-core.js):
 * oversized images are downscaled and re-encoded before they reach the request
 * payload, unsupported formats are converted when possible, and anything the
 * environment cannot decode (e.g. HEIC) is rejected up front.
 */

export interface NormalizedImage {
  /** base64 payload without the data-URL prefix. */
  data: string;
  mimeType: string;
  /** Original MIME type when the image was converted to a supported one. */
  convertedFrom?: string;
}

export interface ImageNormalizationOptions {
  /** Maximum long edge in pixels. */
  maxEdge: number;
  /** Maximum base64 payload size in bytes. */
  maxBytes: number;
  /** JPEG quality for re-encoded candidates. */
  jpegQuality: number;
}

/** Mirrors pi's image-resize defaults: headroom below Anthropic's 5MB inline limit. */
export const IMAGE_NORMALIZATION_DEFAULTS: ImageNormalizationOptions = {
  maxEdge: 2000,
  maxBytes: 4.5 * 1024 * 1024,
  jpegQuality: 80,
};

export class ImageNormalizationError extends Error {
  readonly code: "unsupported-format" | "too-large";

  constructor(code: "unsupported-format" | "too-large", message: string) {
    super(message);
    this.code = code;
    this.name = "ImageNormalizationError";
  }
}

/** MIME types providers accept as inline image blocks without conversion. */
export const INLINE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** MIME types the browser can decode; anything else is rejected up front. */
const DECODABLE_MIME_TYPES = new Set([...INLINE_IMAGE_MIME_TYPES, "image/bmp", "image/avif"]);

export interface ImageNormalizationDependencies {
  /** Decode image dimensions; implementations reject undecodable formats. */
  decodeDimensions: (bytes: Uint8Array<ArrayBuffer>) => Promise<{ width: number; height: number }>;
  /** Re-encode bytes to a JPEG of the given size and quality. */
  encodeJpeg: (
    bytes: Uint8Array<ArrayBuffer>,
    opts: { width: number; height: number; quality: number },
  ) => Promise<Uint8Array<ArrayBuffer>>;
  toBase64: (bytes: Uint8Array<ArrayBuffer>) => string;
}

export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function scaledEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / width, maxEdge / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export async function normalizeImage(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  dependencies: ImageNormalizationDependencies,
  options: Partial<ImageNormalizationOptions> = {},
): Promise<NormalizedImage> {
  const { maxEdge, maxBytes, jpegQuality } = { ...IMAGE_NORMALIZATION_DEFAULTS, ...options };
  const base = baseMimeType(mimeType);

  if (base === "image/gif") {
    // Re-encoding loses animation; keep GIFs byte-identical and gate on size only.
    const data = dependencies.toBase64(bytes);
    if (base64ByteLength(data) > maxBytes) {
      throw new ImageNormalizationError("too-large", "GIF exceeds the inline image size limit");
    }
    return { data, mimeType: "image/gif" };
  }

  if (!DECODABLE_MIME_TYPES.has(base)) {
    throw new ImageNormalizationError("unsupported-format", `Image format ${base || "unknown"} is not supported`);
  }

  const { width, height } = await dependencies.decodeDimensions(bytes);
  const target = scaledEdge(width, height, maxEdge);
  const oversizeEdge = target.width !== width || target.height !== height;
  const originalData = dependencies.toBase64(bytes);
  const needsConversion =
    oversizeEdge || base === "image/avif" || base === "image/bmp" || base64ByteLength(originalData) > maxBytes;
  if (!needsConversion) {
    return { data: originalData, mimeType: base };
  }

  const encoded = await dependencies.encodeJpeg(bytes, { ...target, quality: jpegQuality });
  const data = dependencies.toBase64(encoded);
  if (base64ByteLength(data) > maxBytes) {
    throw new ImageNormalizationError("too-large", "Image exceeds the inline image size limit after compression");
  }
  return {
    data,
    mimeType: "image/jpeg",
    ...(base === "image/jpeg" ? {} : { convertedFrom: base }),
  };
}
