import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertSmokeCompletion } from "../src/smoke/result.ts";
import { createElectronTestEnvironment } from "./electron-test-environment.mjs";
import { resolveElectronBinary, terminateProcessTree } from "./process-utils.mjs";

// All native checks share the same process boundary: isolated runtime paths,
// a deadline, PID-bound completion, saved evidence and unconditional cleanup.
export async function runElectronCheck({
  name,
  root,
  main,
  env = {},
  resultName = "completion.json",
  evidence,
  log,
  requiredScenes,
  timeoutMs = 90_000,
}) {
  const sandbox = createElectronTestEnvironment();
  const userData = sandbox.env.PI_DESKTOP_SMOKE_USER_DATA;
  const resultPath = path.join(userData, resultName);
  let timer;
  try {
    const child = spawn(resolveElectronBinary(root), [main], {
      cwd: root,
      stdio: "inherit",
      detached: process.platform !== "win32",
      env: { ...sandbox.env, ...env, DEXON_ELECTRON_RESULT: resultPath },
    });
    let timedOut = false;
    const exit = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child, { signal: "SIGKILL" });
      }, timeoutMs);
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, pid: child.pid }));
    });
    clearTimeout(timer);
    // Keep failed reports as well; the file's existence is not a pass signal.
    if (fs.existsSync(resultPath) && evidence) {
      fs.mkdirSync(path.dirname(evidence), { recursive: true });
      fs.copyFileSync(resultPath, evidence);
    }
    if (timedOut) throw new Error(`${name} exceeded its deadline`);
    const completion = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
    assertSmokeCompletion(exit, completion, requiredScenes);
    return { completion, exit };
  } finally {
    clearTimeout(timer);
    try {
      const mainLog = path.join(userData, "logs", "main.log");
      if (log && fs.existsSync(mainLog)) {
        fs.mkdirSync(path.dirname(log), { recursive: true });
        fs.copyFileSync(mainLog, log);
      }
    } finally {
      sandbox.dispose();
    }
  }
}
