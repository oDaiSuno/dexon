#!/usr/bin/env node
/**
 * Regenerates the Framer mirror blocks in src/renderer/styles/tokens.css from
 * src/renderer/styles/framer-tokens.json (exported from the Framer project).
 * Only the text between the FRAMER-MIRROR markers is rewritten.
 *
 *   node scripts/sync-framer-tokens.mjs          # rewrite tokens.css
 *   node scripts/sync-framer-tokens.mjs --check  # exit 1 if tokens.css is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { framerColorVariable, framerCssColor, readFramerTokens } from "./framer-tokens.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokensPath = path.join(root, "src/renderer/styles/tokens.css");

function mirror(theme) {
  const { colors } = readFramerTokens();
  return Object.entries(colors)
    .map(([framerPath, value]) => `  ${framerColorVariable(framerPath)}: ${framerCssColor(value[theme])};`)
    .join("\n");
}

export function renderTokens(css) {
  let next = css;
  for (const theme of ["light", "dark"]) {
    const start = `/* FRAMER-MIRROR:${theme}:start */`;
    const end = `/* FRAMER-MIRROR:${theme}:end */`;
    const from = next.indexOf(start);
    const to = next.indexOf(end);
    if (from < 0 || to < from) throw new Error(`tokens.css is missing the ${theme} FRAMER-MIRROR markers`);
    next = `${next.slice(0, from + start.length)}\n${mirror(theme)}\n  ${next.slice(to)}`;
  }
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = readFileSync(tokensPath, "utf8");
  const next = renderTokens(current);
  if (process.argv.includes("--check")) {
    if (next !== current) {
      console.error(
        "FAIL: tokens.css 的 Framer 镜像区与 framer-tokens.json 不一致，运行 node scripts/sync-framer-tokens.mjs",
      );
      process.exitCode = 1;
    } else console.log("Framer mirror OK");
  } else {
    writeFileSync(tokensPath, next);
    console.log("tokens.css Framer mirror rewritten");
  }
}
