import fs from "node:fs";
import path from "node:path";

export function preparePackagedStartupRun(isolatedRoot, environmentPatch = {}) {
  const userData = path.join(isolatedRoot, "user-data");
  const agentDir = path.join(isolatedRoot, "agent");
  fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(userData, "ui-state.json");
  const previous = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
  fs.writeFileSync(statePath, JSON.stringify({ ...previous, managedProcessesEnabled: true }), { mode: 0o600 });
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: {} }), { mode: 0o600 });
  const env = {
    ...process.env,
    HOME: isolatedRoot,
    USERPROFILE: isolatedRoot,
    APPDATA: path.join(isolatedRoot, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(isolatedRoot, "AppData", "Local"),
    TMPDIR: isolatedRoot,
    TMP: isolatedRoot,
    TEMP: isolatedRoot,
    XDG_CONFIG_HOME: path.join(isolatedRoot, ".config"),
    XDG_CACHE_HOME: path.join(isolatedRoot, ".cache"),
    XDG_DATA_HOME: path.join(isolatedRoot, ".local", "share"),
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    ...environmentPatch,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: path.join(agentDir, "sessions"),
    PI_OFFLINE: "1",
  };
  delete env.PI_DESKTOP_USER_DATA;
  return { userData, env };
}
