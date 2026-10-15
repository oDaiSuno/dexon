#!/usr/bin/env node
import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";
const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
await runRendererElectronCheck({
  name: "native-chat",
  renderer: "tests/e2e/chat-layout-renderer.mjs",
  main: "tests/e2e/chat-layout.harness.mjs",
  output: path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/chat-layout-electron")),
  requiredScenes: [
    "chat-composer",
    "font-small",
    "font-standard",
    "font-large",
    "font-extra-large",
    "width-fixed",
    "width-wide",
    "welcome",
    "narrow-chat",
  ],
});
