#!/usr/bin/env node
import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";
const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
await runRendererElectronCheck({
  name: "user-bubble",
  renderer: "tests/e2e/user-bubble-renderer.mjs",
  main: "tests/e2e/user-bubble.harness.mjs",
  output: path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/user-bubble-electron")),
  requiredScenes: [
    "sentence-with-attachments-stays-on-one-line",
    "code-block-keeps-attachment-text-verbatim",
    "special-and-quoted-paths-show-file-names",
    "skill-and-attachment-chips-share-a-line",
    "bubble-chip-matches-composer-chip",
    "clicking-a-bubble-chip-reveals-the-file",
    "dark-theme-bubble",
  ],
});
