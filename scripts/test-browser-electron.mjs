#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { runElectronCheck } from "./electron-test-run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-browser-harness-build-"));
const outfile = path.join(temp, "browser-electron-harness.cjs");
try {
  buildSync({
    absWorkingDir: root,
    entryPoints: ["src/smoke/browser-electron-harness.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile,
    logLevel: "info",
  });
  await runElectronCheck({
    name: "browser-electron",
    root,
    main: outfile,
    evidence: path.join(root, ".artifacts/browser-electron/evidence.json"),
    timeoutMs: 60_000,
  });
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
