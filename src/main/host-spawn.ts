import { resolveSafeProcessCwd } from "../agent-host/subprocess-cwd";
import { app, utilityProcess, type UtilityProcess } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveDevRendererPort } from "../shared/dev-renderer-origin";
import { trySpawnHost, type HostSpawnResult } from "./host-restart-core";
import { appendMainLogs } from "./logger";
import { HostOutputLineBuffer } from "./logger-core";

function asUtilityProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  env.PI_AGENT_HOST = "1";
  env.PI_DESKTOP_USER_DATA = app.getPath("userData");
  env.PI_DESKTOP_VERSION = app.getVersion();
  return env;
}

export function spawnHost(hostEntry: string): HostSpawnResult<UtilityProcess> {
  return trySpawnHost(() =>
    utilityProcess.fork(hostEntry, [], {
      serviceName: "pi-agent-host",
      stdio: "pipe",
      env: asUtilityProcessEnv(),
      cwd: resolveSafeProcessCwd(os.homedir()),
    }),
  );
}

export function forwardHostOutput(child: UtilityProcess): void {
  const stdoutBuffer = new HostOutputLineBuffer((lines) => appendMainLogs(lines.map((line) => `[host:out] ${line}`)));
  const stderrBuffer = new HostOutputLineBuffer((lines) => appendMainLogs(lines.map((line) => `[host:err] ${line}`)));
  child.stdout?.on("data", (buf: Buffer) => stdoutBuffer.push(buf.toString()));
  child.stdout?.on("end", () => stdoutBuffer.flush());
  child.stderr?.on("data", (buf: Buffer) => stderrBuffer.push(buf.toString()));
  child.stderr?.on("end", () => stderrBuffer.flush());
}

export function resolveHostEntry(mainDirectory = __dirname): string {
  return path.join(mainDirectory, "agent-host.mjs");
}

export function resolvePreloadPath(mainDirectory = __dirname): string {
  return path.join(mainDirectory, "..", "preload", "preload.js");
}

export function resolveRendererEntry(isDev: boolean, mainDirectory = __dirname): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  const builtIndex = path.join(mainDirectory, "..", "renderer", "index.html");
  if (fs.existsSync(builtIndex)) {
    return "app://bundle/index.html";
  }
  if (isDev) {
    return `http://localhost:${resolveDevRendererPort(process.env.DEXON_DEV_PORT)}`;
  }
  return "app://bundle/index.html";
}

export function getUserDataPath(...parts: string[]): string {
  return path.join(app.getPath("userData"), ...parts);
}
