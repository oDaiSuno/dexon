import { configureSmokeEnvironment } from "./environment";
import { app, type BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  observeProductionHandover,
  pingProductionHost,
  waitForProductionHandover,
  waitForProductionRenderer,
} from "./production-renderer-probe";

// Only the platform environment is prepared here. The lock, lifecycle,
// window, preload, IPC and Host are installed by out/main/main.js itself.
const smokeUserData = configureSmokeEnvironment();

const productionMain = path.join(process.cwd(), "out", "main", "main.js");
const probeMain = path.resolve(process.argv[1]);
const loadMain = createRequire(path.join(process.cwd(), "package.json"));
function loadProductionMain(): void {
  // A smoke run must not replace the user's OS default protocol association.
  // This one OS registration capability is excluded; single-instance locking,
  // quit, window creation and all application modules remain untouched.
  const registerProtocol = app.setAsDefaultProtocolClient;
  app.setAsDefaultProtocolClient = () => false;
  try {
    loadMain(productionMain);
  } finally {
    app.setAsDefaultProtocolClient = registerProtocol;
  }
}

if (process.argv.includes("--production-startup-secondary")) {
  // No test-owned quit handler or exit shortcut: production must reject this
  // instance, forward the deep link and exit through its own lifecycle.
  loadProductionMain();
} else {
  const watchdog = setTimeout(() => {
    console.error("Production startup smoke did not complete and shut down within 45s");
    app.exit(1);
  }, 45_000);
  const loadedWindow = new Promise<BrowserWindow>((resolve, reject) => {
    app.once("browser-window-created", (_event, window) => {
      window.webContents.once("did-finish-load", () => resolve(window));
      window.webContents.on("did-fail-load", (_event, _code, description, _url, isMainFrame) => {
        if (isMainFrame) reject(new Error(`Production renderer failed to load: ${description}`));
      });
    });
  });

  const check = async (): Promise<void> => {
    const window = await loadedWindow;
    await waitForProductionRenderer(window);
    await pingProductionHost(window);
    const sessionId = randomUUID();
    await observeProductionHandover(window, sessionId);
    window.hide();

    const child = spawn(
      process.execPath,
      [probeMain, "--production-startup-secondary", `dexon://session/${sessionId}`],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );
    let secondaryTimedOut = false;
    const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      const timer = setTimeout(() => {
        secondaryTimedOut = true;
        child.kill("SIGKILL");
      }, 10_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    if (secondaryTimedOut) throw new Error("The second production instance did not exit within 10s");
    if (exit.code !== 0 || exit.signal) {
      throw new Error(`The second production instance exited with code=${exit.code} signal=${exit.signal}`);
    }
    await waitForProductionHandover(window);
    if (window.isDestroyed() || !window.isVisible())
      throw new Error("The production window was not restored by handover");
    await pingProductionHost(window);

    // Completion is written only after production's real quit cleanup permits
    // will-quit, not merely after a successful ping or an arbitrary zero exit.
    app.once("will-quit", (event) => {
      try {
        fs.writeFileSync(
          path.join(smokeUserData, "production-startup-result.json"),
          JSON.stringify({
            completed: true,
            pid: process.pid,
            entry: productionMain,
            secondInstance: exit,
            handover: true,
            firstInstanceStillServes: true,
            shutdown: "will-quit",
          }),
        );
        clearTimeout(watchdog);
      } catch (error) {
        event.preventDefault();
        console.error("Could not write production startup completion evidence", error);
        app.exit(1);
      }
    });
    console.log("smoke: production entry handed over, exited its second instance, and kept serving");
    app.quit();
  };

  void check().catch((error: unknown) => {
    console.error("Production startup smoke failed", error);
    // A failure leaves no completed result; the launcher rejects even a zero
    // exit while the application still gets its normal resource cleanup.
    app.quit();
  });
  loadProductionMain();
}
