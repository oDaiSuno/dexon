import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLES_DIR = path.join(root, "src/renderer/styles");
const STYLE_ENTRY = path.join(STYLES_DIR, "index.ts");

export function stylePartialNames() {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith(".css"))
    .sort();
}

export function readStylePartial(name) {
  return readFileSync(path.join(STYLES_DIR, name), "utf8");
}

/** Renderer CSS files in cascade order, relative to src/renderer, as declared by styles/index.ts. */
export function rendererCssImportOrder() {
  const entry = readFileSync(STYLE_ENTRY, "utf8");
  return [...entry.matchAll(/^import\s+"\.(\.?)\/(.+\.css)";$/gm)].map(([, parent, file]) =>
    parent ? file : `styles/${file}`,
  );
}

export function readRendererCssSources() {
  return rendererCssImportOrder()
    .map((file) => readFileSync(path.join(root, "src/renderer", file), "utf8"))
    .join("\n");
}
