import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// One owner for a native run's environment and its failure-path cleanup.
export function createElectronTestEnvironment(parentEnv = process.env) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-smoke-"));
  const home = path.join(directory, "home");
  const userData = path.join(directory, "electron");
  const temporary = path.join(directory, "tmp");
  const agent = path.join(directory, "agent");
  const sessions = path.join(directory, "sessions");
  for (const entry of [home, userData, temporary, agent, sessions]) mkdirSync(entry, { recursive: true });
  const env = {
    ...parentEnv,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    // Runtime caching is not part of acceptance behavior. Disabling it prevents
    // inherited cache paths and late cache flushes outliving a native run.
    NODE_DISABLE_COMPILE_CACHE: "1",
    PI_CODING_AGENT_DIR: agent,
    PI_CODING_AGENT_SESSION_DIR: sessions,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    PI_DESKTOP_SMOKE_USER_DATA: userData,
    PI_DESKTOP_SMOKE_HOME: home,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  return {
    directory,
    env,
    dispose() {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}
