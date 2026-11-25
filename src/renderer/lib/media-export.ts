import type { EnvironmentId } from "@contract/environment";

export interface SvgDimensions {
  width: number;
  height: number;
}

export interface LocalMediaFile {
  environmentId: EnvironmentId;
  filePath: string;
  sourceSessionId?: string | null;
}

const DEFAULT_SVG_DIMENSIONS: SvgDimensions = { width: 800, height: 600 };

const MERMAID_KEYWORDS = new Set([
  "flowchart",
  "graph",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "statediagram-v2",
  "erdiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantchart",
  "requirementdiagram",
  "gitgraph",
  "c4context",
  "c4container",
  "c4component",
  "c4dynamic",
  "c4deployment",
  "mindmap",
  "timeline",
  "zenuml",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "packet-beta",
  "kanban",
  "architecture-beta",
  "radar-beta",
]);

export function extractMermaidLabel(code: string): string {
  const lines = code.split(/\r?\n/);
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (i === 0 && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === "---") {
        inFrontmatter = false;
        continue;
      }
      const titleMatch = /^title:\s*(.+)$/.exec(trimmed);
      if (titleMatch) {
        const cleaned = titleMatch[1].trim().replace(/^["']|["']$/g, "");
        if (cleaned) return `mermaid · ${cleaned}`;
      }
      continue;
    }
    if (!trimmed || trimmed.startsWith("%%")) continue;
    const accTitleMatch = /^accTitle:\s*(.+)$/.exec(trimmed);
    if (accTitleMatch) {
      const cleaned = accTitleMatch[1].trim();
      if (cleaned) return `mermaid · ${cleaned}`;
    }
    const token = trimmed.split(/\s+/)[0];
    if (token && MERMAID_KEYWORDS.has(token.toLowerCase())) {
      return `mermaid · ${token}`;
    }
    break;
  }
  return "mermaid";
}

function parseSvgNumericAttr(tag: string, name: "width" | "height"): number | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const match = pattern.exec(tag);
  if (!match) return null;
  const raw = match[1].trim();
  if (raw.endsWith("%")) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function measureSvgDimensions(svg: string): SvgDimensions {
  const openTagMatch = /<svg\b[^>]*>/i.exec(svg);
  if (!openTagMatch) return DEFAULT_SVG_DIMENSIONS;
  const openTag = openTagMatch[0];
  const viewBoxMatch = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(openTag);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1]
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part));
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.ceil(parts[2]), height: Math.ceil(parts[3]) };
    }
  }
  const width = parseSvgNumericAttr(openTag, "width");
  const height = parseSvgNumericAttr(openTag, "height");
  if (width && height) return { width: Math.ceil(width), height: Math.ceil(height) };
  return DEFAULT_SVG_DIMENSIONS;
}

export function scopeSvgIds(svg: string, suffix: string): string {
  const openTagMatch = /<svg\b[^>]*>/i.exec(svg);
  if (!openTagMatch) return svg;
  const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(openTagMatch[0]);
  if (!idMatch) return svg;
  const rootId = idMatch[1];
  const scopedId = `${rootId}-${suffix}`;
  return svg.split(rootId).join(scopedId);
}

export function prepareSvgForExport(svg: string, dimensions?: SvgDimensions): string {
  const dims = dimensions ?? measureSvgDimensions(svg);
  return svg.replace(/<svg\b([^>]*)>/i, (_full, attrs: string) => {
    let next = attrs;
    if (!/\bxmlns\s*=/i.test(next)) next += ' xmlns="http://www.w3.org/2000/svg"';
    if (!/\bxmlns:xlink\s*=/i.test(next)) next += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    next = next.replace(/\s+\bwidth\s*=\s*["'][^"']*["']/gi, "");
    next = next.replace(/\s+\bheight\s*=\s*["'][^"']*["']/gi, "");
    next = next.replace(/\bstyle\s*=\s*["']([^"']*)["']/i, (_m, styleValue: string) => {
      const cleaned = styleValue
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part && !/^max-width\s*:/i.test(part) && !/^max-height\s*:/i.test(part))
        .join("; ");
      return cleaned ? `style="${cleaned}"` : "";
    });
    return `<svg${next} width="${dims.width}" height="${dims.height}">`;
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

export function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!match) return null;
  return {
    mime: match[1] || "application/octet-stream",
    base64: match[2].replace(/\s+/g, ""),
  };
}

export function sanitizeExportFileName(raw: string, ext: string): string {
  const withoutControl = Array.from(raw, (ch) => (ch.charCodeAt(0) < 0x20 ? "-" : ch)).join("");
  const cleaned = withoutControl
    .replace(/^mermaid\s*·\s*/i, "mermaid-")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  const base = cleaned || "diagram";
  const suffix = `.${ext.replace(/^\./, "")}`;
  return base.toLowerCase().endsWith(suffix.toLowerCase()) ? base : `${base}${suffix}`;
}

export async function svgToPngBlob(
  svg: string,
  options: { scale?: number; backgroundColor?: string; padding?: number } = {},
): Promise<Blob> {
  const dims = measureSvgDimensions(svg);
  const padding = options.padding ?? 24;
  const targetWidth = dims.width + padding * 2;
  const targetHeight = dims.height + padding * 2;
  const requestedScale = options.scale ?? 2;
  const maxCanvasSide = 8192;
  const scale = Math.max(1, Math.min(requestedScale, maxCanvasSide / Math.max(targetWidth, targetHeight, 1)));
  const prepared = prepareSvgForExport(svg, dims);
  const svgBase64 = bytesToBase64(new TextEncoder().encode(prepared));
  const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode SVG for PNG export"));
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(targetWidth * scale));
  canvas.height = Math.max(1, Math.round(targetHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable");

  if (options.backgroundColor) {
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  ctx.drawImage(image, padding, padding, dims.width, dims.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode PNG blob"));
    }, "image/png");
  });
}

export async function imageElementToPngBlob(img: HTMLImageElement, fallbackSrc?: string): Promise<Blob> {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width <= 0 || height <= 0) throw new Error("Image has no decoded dimensions");
  try {
    return await drawImageToPngBlob(img, width, height);
  } catch (error) {
    const src = fallbackSrc ?? img.currentSrc ?? img.src;
    if (!src || !/^https?:/i.test(src)) throw error;
    const corsImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.crossOrigin = "anonymous";
      next.referrerPolicy = "no-referrer";
      next.onload = () => resolve(next);
      next.onerror = () => reject(error);
      next.src = src;
    });
    return await drawImageToPngBlob(corsImage, corsImage.naturalWidth || width, corsImage.naturalHeight || height);
  }
}

async function drawImageToPngBlob(img: HTMLImageElement, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode image as PNG"));
    }, "image/png");
  });
}

export async function copyPngBlobToClipboard(blob: Blob): Promise<void> {
  if (window.piBridge?.copyImage) {
    const base64 = await blobToBase64(blob);
    await window.piBridge.copyImage({ base64 });
    return;
  }
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return;
  }
  throw new Error("Image clipboard is unavailable");
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function savePngBlob(blob: Blob, defaultPath: string): Promise<boolean> {
  if (window.piBridge?.saveBinaryFile) {
    const base64 = await blobToBase64(blob);
    const saved = await window.piBridge.saveBinaryFile({
      base64,
      defaultPath,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (saved) {
      await window.piBridge.showItemInFolder(saved);
      return true;
    }
    return false;
  }
  triggerBrowserDownload(blob, defaultPath);
  return true;
}

export async function saveSvgText(svg: string, defaultPath: string): Promise<boolean> {
  if (window.piBridge?.saveFile) {
    const saved = await window.piBridge.saveFile({
      content: svg,
      defaultPath,
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (saved) {
      await window.piBridge.showItemInFolder(saved);
      return true;
    }
    return false;
  }
  triggerBrowserDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), defaultPath);
  return true;
}

async function saveRawBlob(blob: Blob, defaultPath: string): Promise<boolean> {
  if (window.piBridge?.saveBinaryFile) {
    const base64 = await blobToBase64(blob);
    const saved = await window.piBridge.saveBinaryFile({ base64, defaultPath });
    if (saved) {
      await window.piBridge.showItemInFolder(saved);
      return true;
    }
    return false;
  }
  triggerBrowserDownload(blob, defaultPath);
  return true;
}

function isSameOriginOrBlob(url: string): boolean {
  if (url.startsWith("blob:")) return true;
  if (typeof window === "undefined") return false;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function downloadMediaImage({
  src,
  fileName,
  localFile,
  imageElement,
}: {
  src: string;
  fileName: string;
  localFile?: LocalMediaFile;
  imageElement?: HTMLImageElement | null;
}): Promise<boolean> {
  if (localFile) {
    const { downloadFileViaRpc } = await import("@/lib/file-blob");
    await downloadFileViaRpc(localFile.environmentId, localFile.filePath, fileName, localFile.sourceSessionId);
    return true;
  }
  const parsed = parseDataUrl(src);
  if (parsed) {
    const { base64ToBlob } = await import("@/lib/file-blob");
    return await saveRawBlob(base64ToBlob(parsed.base64, parsed.mime), fileName);
  }
  if (isSameOriginOrBlob(src)) {
    try {
      const response = await fetch(src);
      if (response.ok) {
        return await saveRawBlob(await response.blob(), fileName);
      }
    } catch {
      void 0;
    }
  }
  if (imageElement && imageElement.complete && imageElement.naturalWidth > 0) {
    try {
      const pngBlob = await imageElementToPngBlob(imageElement, src);
      return await savePngBlob(pngBlob, sanitizeExportFileName(fileName, "png"));
    } catch {
      void 0;
    }
  }
  const a = document.createElement("a");
  a.href = src;
  a.download = fileName;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
