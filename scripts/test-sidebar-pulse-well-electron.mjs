import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";

const index = process.argv.indexOf("--out");
const output = path.resolve(index >= 0 ? process.argv[index + 1] : ".artifacts/sidebar-pulse-well-electron");
await runRendererElectronCheck({
  name: "sidebar-pulse-well",
  renderer: "tests/e2e/sidebar-pulse-well-renderer.mjs",
  main: "tests/e2e/sidebar-pulse-well-harness.mjs",
  output,
  requiredScenes: [
    "summary-and-hover",
    "first-reveal",
    "repeat-after-refold",
    "repeat-after-scroll",
    "short-prefix",
    "rail",
    "many-roots-top",
    "many-roots-bottom",
    "many-roots-settings",
    "many-roots-fewer",
    "many-roots-compact",
    "normal-row-geometry",
  ],
});
