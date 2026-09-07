import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { rendererCssImportOrder } from "./css-sources.mjs";

const stylesDir = new URL("./", import.meta.url);
const entryUrl = new URL("../globals.css", import.meta.url);

const expectedImportOrder = [
  "globals.css",
  "styles/tokens.css",
  "styles/base.css",
  "styles/interactive.css",
  "styles/markdown.css",
  "styles/motion.css",
  "styles/nav.css",
  "styles/panels.css",
  "chat.css",
  "styles/tool-cards.css",
];

test("main.tsx imports the renderer styles in cascade order", () => {
  const imports = rendererCssImportOrder();
  assert.deepEqual(imports, expectedImportOrder, "CSS import order defines the cascade and must match the plan");
});

test("globals.css keeps tailwind, vendored fonts, and the theme mapping", () => {
  const entry = readFileSync(entryUrl, "utf8");
  assert.match(entry, /^@import "tailwindcss";/, "tailwind must load before every app style");
  assert.match(entry, /@font-face/, "font-face declarations stay in the entry for relative font paths");
  assert.match(entry, /url\("\.\/fonts\/GeistSans\.woff2"\)/);
  assert.match(entry, /url\("\.\/fonts\/GeistMono\.woff2"\)/);
  assert.match(entry, /@theme\s*\{/, "tailwind theme mapping stays in the entry");
  assert.doesNotMatch(entry, /@import\s+"\.\//, "app style partials are imported from main.tsx, not via CSS @import");
});

test("every style partial is imported from main.tsx (no orphan files)", () => {
  const imported = new Set(rendererCssImportOrder());
  const onDisk = readdirSync(stylesDir).filter((name) => name.endsWith(".css"));
  assert.ok(onDisk.length > 0, "style partials directory must not be empty");
  for (const name of onDisk) {
    assert.ok(imported.has(`styles/${name}`), `styles/${name} must be imported from main.tsx`);
  }
});

test("renderer keeps only the entry, chat.css, and wired style partials", () => {
  const all = [];
  const walk = (url) => {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const full = new URL(entry.name + (entry.isDirectory() ? "/" : ""), url);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) all.push(decodeURIComponent(full.href));
    }
  };
  walk(new URL("../", import.meta.url));
  const expected = new Set([
    decodeURIComponent(entryUrl.href),
    decodeURIComponent(new URL("../chat.css", import.meta.url).href),
    ...expectedImportOrder
      .filter((name) => name.startsWith("styles/"))
      .map((name) => decodeURIComponent(new URL(name, new URL("../", import.meta.url)).href)),
  ]);
  assert.deepEqual([...all].sort(), [...expected].sort());
});

test("the entry and every style partial stay within the 500-line budget", () => {
  // chat.css is an untouched legacy file (666 lines) owned by later phases.
  for (const file of [
    "globals.css",
    ...readdirSync(stylesDir)
      .filter((name) => name.endsWith(".css"))
      .map((name) => `styles/${name}`),
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const lines = source.split("\n").length;
    assert.ok(lines <= 500, `${file} has ${lines} lines (budget 500)`);
  }
});
