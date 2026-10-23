#!/usr/bin/env node
/**
 * Phase 4 preview capture runner: bundles the dev-only preview assembly
 * (real components + sample data + api-client mock), builds the Electron
 * capture harness and runs it to produce the eight confirmation screens plus
 * evidence. Usage:
 *
 *   node scripts/capture-ui-previews.mjs [--out <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary, terminateProcessTree } from "./process-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArgIndex = process.argv.indexOf("--out");
const outDir = path.resolve(
  outArgIndex >= 0 && process.argv[outArgIndex + 1]
    ? process.argv[outArgIndex + 1]
    : path.join(root, "gudaspec/plans/refactor-sidebar-personal-workspace/phase-4/previews"),
);
const output = path.join(root, ".artifacts/ui-nav-preview");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// The api-client replacement keeps every RPC import inside the bundle pointing
// at the sample-data mock; nothing in the preview window can reach a host.
// The api-client replacement keeps every RPC import inside the bundle pointing
// at the sample-data mock; nothing in the preview window can reach a host.
// globals.css is compiled through the real Tailwind postcss pipeline so the
// preview inherits the exact production preflight reset and font declarations.
await build({
  absWorkingDir: root,
  entryPoints: ["src/smoke/ui-preview-renderer.mjs"],
  bundle: true,
  platform: "browser",
  format: "iife",
  tsconfig: "tsconfig.renderer.json",
  outfile: path.join(output, "renderer.js"),
  loader: { ".png": "dataurl", ".svg": "dataurl", ".woff2": "file" },
  // The preview bundle runs outside Vite: pin the env flags the component
  // graph reads (session performance profiling stays off in previews).
  define: {
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
  },
  plugins: [
    {
      name: "ui-preview-globals-tailwind",
      setup(buildApi) {
        const globalsPath = path.join(root, "src/renderer/globals.css");
        buildApi.onResolve({ filter: /globals\.css$/ }, () => ({ path: globalsPath, namespace: "globals-tailwind" }));
        buildApi.onLoad({ filter: /.*/, namespace: "globals-tailwind" }, async () => {
          const source = fs.readFileSync(globalsPath, "utf8");
          const compiled = await postcss([tailwindcss()]).process(source, {
            from: globalsPath,
            map: false,
          });
          return { contents: compiled.css, resolveDir: path.dirname(globalsPath), loader: "css" };
        });
      },
    },
    {
      name: "ui-preview-api-client-mock",
      setup(buildApi) {
        buildApi.onResolve({ filter: /(^|\/)api-client$/ }, () => ({
          path: path.join(root, "src/smoke/ui-preview-api-mock.mjs"),
        }));
      },
    },
  ],
});
await build({
  absWorkingDir: root,
  entryPoints: ["src/smoke/ui-preview-harness.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: path.join(output, "main.mjs"),
});

fs.writeFileSync(
  path.join(output, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:"><link rel="stylesheet" href="renderer.css"><style>
 html,body{margin:0;height:100%}#preview-root{height:100dvh}
 </style></head><body><div id="preview-root"></div><script src="renderer.js"></script></body></html>`,
);

const fonts = path.join(root, "src/renderer/fonts");
fs.copyFileSync(path.join(fonts, "InterLatin.woff2"), path.join(output, "InterLatin.woff2"));
fs.copyFileSync(path.join(fonts, "InterLatinExt.woff2"), path.join(output, "InterLatinExt.woff2"));
fs.copyFileSync(path.join(fonts, "GeistMono.woff2"), path.join(output, "GeistMono.woff2"));

const child = spawn(resolveElectronBinary(root), [path.join(output, "main.mjs")], {
  cwd: root,
  stdio: "inherit",
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    UI_PREVIEW_OUT: outDir,
  },
});

process.exitCode = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    terminateProcessTree(child);
    resolve(1);
  }, 200_000);
  child.once("error", (error) => {
    clearTimeout(timer);
    console.error(error);
    resolve(1);
  });
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolve(code ?? 1);
  });
});

if (process.exitCode === 0) {
  console.log(`previews written to ${outDir}`);
}
