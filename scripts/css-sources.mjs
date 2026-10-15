import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 从 src/renderer/styles/ 迁来（原测试辅助 css-sources.mjs）：css-structure 与设计令牌
// 测试流放后，读取者只剩 check 脚本（check-design / check-architecture），
// 测试套件禁止再引用它（scripts/test-hygiene.mjs 的 css-source-helper 规则）。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLES_DIR = path.join(root, "src/renderer/styles");
const RENDERER_DIR = path.join(root, "src/renderer");
const MAIN_TSX = path.join(root, "src/renderer/main.tsx");

/** All style partial filenames under src/renderer/styles/, sorted. */
export function stylePartialNames() {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith(".css"))
    .sort();
}

/** Read one style partial by filename, e.g. "tokens.css". */
export function readStylePartial(name) {
  return readFileSync(path.join(STYLES_DIR, name), "utf8");
}

/** Every renderer-owned CSS source in bundle order, as declared by main.tsx imports. */
export function rendererCssImportOrder() {
  const main = readFileSync(MAIN_TSX, "utf8");
  return [...main.matchAll(/^import\s+"\.\/(.+\.css)";$/gm)].map((match) => match[1]);
}

/** Every renderer-owned CSS source concatenated in bundle order. */
export function readRendererCssSources() {
  return rendererCssImportOrder()
    .map((file) => readFileSync(path.join(RENDERER_DIR, file), "utf8"))
    .join("\n");
}
