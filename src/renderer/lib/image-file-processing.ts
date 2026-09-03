import { normalizeImage, type ImageNormalizationDependencies } from "./image-normalization.ts";

export interface ProcessedImageFile {
  data: string; // base64, no prefix — the exact bytes sent to the model
  mimeType: string; // normalized MIME type
  previewUrl: string; // object URL for display, derived from the sent bytes
}

export interface ImageFileFailure {
  file: File;
  error: unknown;
}

interface ImageFileProcessingDependencies {
  readBytes: (file: File) => Promise<Uint8Array<ArrayBuffer>>;
  createObjectUrl: (image: Pick<ProcessedImageFile, "data" | "mimeType">) => string;
  normalize: ImageNormalizationDependencies;
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decodeDimensions(bytes: Uint8Array<ArrayBuffer>): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function encodeJpeg(
  bytes: Uint8Array<ArrayBuffer>,
  options: { width: number; height: number; quality: number },
): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    // JPEG has no alpha channel; fill first so transparency does not turn into artifacts.
    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, options.width, options.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((encoded) => resolve(encoded), "image/jpeg", options.quality / 100),
    );
    if (!blob) throw new Error("Canvas JPEG encoding failed");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

const browserDependencies: ImageFileProcessingDependencies = {
  readBytes: async (file) => new Uint8Array(await file.arrayBuffer()),
  createObjectUrl: (image) => URL.createObjectURL(new Blob([base64ToBytes(image.data)], { type: image.mimeType })),
  normalize: { decodeDimensions, encodeJpeg, toBase64 },
};

/**
 * Read, normalize, and stage a batch of image files for attachment.
 * Each file is normalized independently (resize, format conversion, size gate);
 * failures are isolated per file so one broken image never blocks the batch.
 */
export async function processImageFileBatch(
  files: File[],
  dependencies: ImageFileProcessingDependencies = browserDependencies,
): Promise<{ images: ProcessedImageFile[]; failures: ImageFileFailure[] }> {
  const settled = await Promise.allSettled(
    files.map(async (file) => {
      const bytes = await dependencies.readBytes(file);
      const normalized = await normalizeImage(bytes, file.type, dependencies.normalize);
      return {
        data: normalized.data,
        mimeType: normalized.mimeType,
        previewUrl: dependencies.createObjectUrl({ data: normalized.data, mimeType: normalized.mimeType }),
      } satisfies ProcessedImageFile;
    }),
  );

  const images: ProcessedImageFile[] = [];
  const failures: ImageFileFailure[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") images.push(result.value);
    else failures.push({ file: files[index], error: result.reason });
  });
  return { images, failures };
}
