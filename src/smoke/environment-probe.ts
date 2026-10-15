import { app } from "electron";
import { homedir, tmpdir } from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { configureSmokeEnvironment } from "./environment";

const userData = configureSmokeEnvironment();
const configuredBeforeReady = !app.isReady();
void app.whenReady().then(() => {
  fs.writeFileSync(
    path.join(userData, "environment-result.json"),
    JSON.stringify({
      completed: true,
      pid: process.pid,
      configuredBeforeReady,
      paths: {
        home: homedir(),
        electronHome: app.getPath("home"),
        agent: getAgentDir(),
        sessions: process.env.PI_CODING_AGENT_SESSION_DIR,
        userData: app.getPath("userData"),
        sessionData: app.getPath("sessionData"),
        logs: app.getPath("logs"),
        temporary: tmpdir(),
        electronTemporary: app.getPath("temp"),
      },
    }),
  );
  app.exit(0);
});
