import path from "node:path";
import { runRendererElectronCheck } from "../../scripts/renderer-electron-check.mjs";
const here = path.dirname(new URL(import.meta.url).pathname);
await runRendererElectronCheck({ name: "issue46-poc", renderer: path.relative(path.resolve(here, "../.."), path.join(here, "renderer.mjs")), main: path.relative(path.resolve(here, "../.."), path.join(here, "harness.mjs")), output: path.join(here, "out"), requiredScenes: ["baseline-standard"] });
