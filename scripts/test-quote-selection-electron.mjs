#!/usr/bin/env node
import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
await runRendererElectronCheck({
  name: "quote-selection",
  renderer: "tests/e2e/quote-selection-renderer.mjs",
  main: "tests/e2e/quote-selection.harness.mjs",
  output: path.resolve(
    outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/quote-selection-electron"),
  ),
  requiredScenes: [
    "drag-selection-inserts-quote-chip-and-sends-structured-prompt",
    "selection-boundaries-ignore-composer-and-dismiss-on-escape",
    "clicking-composer-and-bubble-quote-chips-jumps-and-highlights",
    "cross-page-quote-jump-loads-older-assistant-message",
    "branch-switch-detached-quote-shows-preserved-full-text",
  ],
});
