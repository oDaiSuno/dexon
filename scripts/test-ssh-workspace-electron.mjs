import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";

const index = process.argv.indexOf("--out");
const output = path.resolve(index >= 0 ? process.argv[index + 1] : ".artifacts/nav-layout-electron/ssh-workspace");
await runRendererElectronCheck({
  name: "ssh-workspace",
  renderer: "tests/e2e/ssh-workspace-renderer.mjs",
  main: "tests/e2e/ssh-workspace-harness.mjs",
  output,
  requiredScenes: [
    "01-onboarding-connect-and-browse",
    "02-sidebar-and-pulse-well",
    "03-trust-banner-and-rule-lens",
    "04-ports-viewer-and-disconnect-isolation",
  ],
  timeoutMs: 120_000,
});
