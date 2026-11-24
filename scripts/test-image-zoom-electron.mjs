import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
await runRendererElectronCheck({
  name: "image-zoom",
  renderer: "tests/e2e/image-zoom-renderer.mjs",
  main: "tests/e2e/image-zoom.harness.mjs",
  output: path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/image-zoom-electron")),
  timeoutMs: 120_000,
  requiredScenes: [
    "wheel-and-control-wheel-anchor-without-window-zoom",
    "drag-capture-threshold-and-release",
    "double-click-actual-and-small-image",
    "buttons-stops-limits-and-native-shortcuts",
    "narrow-and-wide-header",
    "collapsed-dock-preserves-framing",
    "tabs-remember-and-environments-isolate",
    "hot-reload-keeps-nodes-and-framing",
    "corrupt-image-recovers-and-latest-load-wins",
    "viewbox-svg-zoom",
    "shared-key-last-input-wins-not-resize-or-unmount",
    "strict-mode-and-detached-listeners",
  ],
});
