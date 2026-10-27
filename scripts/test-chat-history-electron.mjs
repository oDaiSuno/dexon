#!/usr/bin/env node
import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
await runRendererElectronCheck({
  name: "native-chat-history",
  renderer: "tests/e2e/chat-history-renderer.mjs",
  main: "tests/e2e/chat-history.harness.mjs",
  output: path.resolve(
    outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/chat-history-electron"),
  ),
  timeoutMs: 600_000,
  requiredScenes: [
    "outline-complete",
    "wheel-reading-keeps-position",
    "pageup-reading-keeps-position",
    "scrollbar-drag-reading-keeps-position",
    "jump-to-unloaded-question",
    "navigator-follows-current",
    "existing-behaviour",
  ],
});
