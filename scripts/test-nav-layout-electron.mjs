#!/usr/bin/env node
import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
const output = path.resolve(
  outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/nav-layout-electron"),
);
await runRendererElectronCheck({
  name: "native-navigation",
  renderer: "tests/e2e/nav-layout-renderer.mjs",
  main: "tests/e2e/nav-layout.harness.mjs",
  output,
  requiredScenes: [
    "01-expanded-short-light",
    "02-expanded-long-light",
    "keyboard-focus",
    "native-search-and-rename",
    "05-collapsed-light",
    "06-narrow-expanded-dark",
    "07-narrow-collapsed-dark",
  ],
});
