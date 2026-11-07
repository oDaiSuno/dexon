import { app, BrowserWindow, Notification, nativeImage } from "electron";
import path from "node:path";
import type { HostManager } from "./host-manager";
import type { EnvironmentManager } from "./environments/environment-manager";
import type { BrowserService } from "./browser/browser-service";
import type { UpdateManager } from "./update-manager";
import type { PackagedStartupValidation } from "./packaged-startup-validation";
import { setTrayManagedProcessCount, setTrayRunningCount } from "./tray";
import { appendMainLog } from "./logger";
export function installHostNotifications(options: {
  hostManager: HostManager;
  environmentManager: EnvironmentManager;
  packagedStartupValidation: boolean;
  startupValidation: PackagedStartupValidation;
  getMainWindow: () => BrowserWindow | null;
  getUpdateManager: () => UpdateManager | null;
  getBrowserService: () => BrowserService | null;
  onAgentCount: (count: number) => void;
  onManagedCount: (count: number) => void;
  onUnreadSession: () => void;
}) {
  const { hostManager, environmentManager } = options;
  hostManager.setStatusListener((status, detail) => {
    environmentManager.notifyPrimaryStatus(status);
    appendMainLog(`host status=${status} ${detail ?? ""}`);
    if (options.packagedStartupValidation) {
      options.startupValidation.hostReady = status === "ready";
      if (status === "crashed") options.startupValidation.finish(detail ?? "Agent Host crashed");
      else options.startupValidation.finish();
    }
    if (status !== "ready") {
      options.onAgentCount(0);
      options.onManagedCount(0);
      setTrayRunningCount(0, options.getMainWindow);
      setTrayManagedProcessCount(0, options.getMainWindow);
      options.getUpdateManager()?.setRunningSessionCount(0);
      options.getBrowserService()?.onHostStopped();
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("host:status", { status, detail });
      if (status === "ready" && detail?.includes("restart")) {
        win.webContents.send("host:restarted", { reason: detail });
      }
      if (status === "crashed") {
        win.webContents.send("host:crashed", { detail });
      }
    }
  });

  hostManager.setMessageListener((msg) => {
    if (options.packagedStartupValidation && msg.type === "toolchain:ack") options.startupValidation.finish();
    if (msg.type === "running-sessions") {
      const ids = (msg.sessionIds as string[]) ?? [];
      options.onAgentCount(ids.length);
      setTrayRunningCount(ids.length, options.getMainWindow);
      options.getUpdateManager()?.setRunningSessionCount(ids.length);
    } else if (msg.type === "managed-process-count") {
      const count = Number(msg.count);
      const runningManagedProcessCount = Number.isSafeInteger(count) && count >= 0 ? count : 0;
      options.onManagedCount(runningManagedProcessCount);
      setTrayManagedProcessCount(runningManagedProcessCount, options.getMainWindow);
    } else if (msg.type === "agent-end") {
      const sessionId = String(msg.sessionId ?? "");
      const win = options.getMainWindow();
      const shouldNotify = !win || !win.isVisible() || !win.isFocused();
      if (shouldNotify && Notification.isSupported() && sessionId) {
        const n = new Notification({
          title: "Agent finished",
          body: "A session completed in the background",
        });
        n.on("click", () => {
          const w = options.getMainWindow();
          if (w) {
            w.show();
            w.focus();
            w.webContents.send("deep-link:session", sessionId);
          }
        });
        n.show();
        options.onUnreadSession();
      }
    } else if (msg.type === "host-restarted") {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("host:restarted", { reason: String(msg.reason ?? "restart") });
      }
    }
  });
}

export function applyDesktopBadgeCount(count: number, win: BrowserWindow | null): void {
  if (process.platform === "win32") {
    if (!win || win.isDestroyed()) return;
    if (count === 0) {
      win.setOverlayIcon(null, "No unread completed sessions");
      return;
    }
    const overlay = nativeImage
      .createFromPath(path.join(app.getAppPath(), "build", "icon.png"))
      .resize({ width: 16, height: 16 });
    win.setOverlayIcon(overlay, `${count} unread completed session${count === 1 ? "" : "s"}`);
    return;
  }
  app.setBadgeCount(count);
}
