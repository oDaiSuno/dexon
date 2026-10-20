import fs from "node:fs";
import path from "node:path";

export function npmInvocation(
  platform = process.platform,
  npmExecPath = process.env.npm_execpath,
  nodeExecutable = process.execPath,
) {
  if (typeof npmExecPath === "string" && path.isAbsolute(npmExecPath) && fs.existsSync(npmExecPath)) {
    return { command: nodeExecutable, args: [npmExecPath], shell: false };
  }
  return { command: platform === "win32" ? "npm.cmd" : "npm", args: [], shell: platform === "win32" };
}
