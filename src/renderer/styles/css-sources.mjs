import { readFileSync, readdirSync } from "node:fs";

const STYLES_DIR = new URL("./", import.meta.url);
const RENDERER_DIR = new URL("../", import.meta.url);
const MAIN_TSX = new URL("../main.tsx", import.meta.url);

/** All style partial filenames under src/renderer/styles/, sorted. */
export function stylePartialNames() {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith(".css"))
    .sort();
}

/** Read one style partial by filename, e.g. "tokens.css". */
export function readStylePartial(name) {
  return readFileSync(new URL(name, STYLES_DIR), "utf8");
}

/** Every renderer-owned CSS source in bundle order, as declared by main.tsx imports. */
export function rendererCssImportOrder() {
  const main = readFileSync(MAIN_TSX, "utf8");
  return [...main.matchAll(/^import\s+"\.\/(.+\.css)";$/gm)].map((match) => match[1]);
}

/** Every renderer-owned CSS source concatenated in bundle order. */
export function readRendererCssSources() {
  return rendererCssImportOrder()
    .map((file) => readFileSync(new URL(file, RENDERER_DIR), "utf8"))
    .join("\n");
}
