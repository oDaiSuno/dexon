import { app, dialog, type BrowserWindow } from "electron";
import type { EnvironmentManager } from "./environments/environment-manager";
import type { BrowserService } from "./browser/browser-service";
import type { UpdateManager } from "./update-manager";
import { destroyTray } from "./tray";
import { beforeDeadline } from "./managed-process/shutdown-cleanup";
import { managedProcessDialogCopy } from "./managed-process/dialog-copy";
import { appendMainLog } from "./logger";
export function installQuitCleanup(options: {
  getRunningManagedProcessCount: () => number;
  packagedStartupValidation: boolean;
  getMainWindow: () => BrowserWindow | null;
  setQuitting: (value: boolean) => void;
  getUpdateManager: () => UpdateManager | null;
  getEnvironmentManager: () => EnvironmentManager | null;
  getBrowserService: () => BrowserService | null;
  cleanupManagedProcesses: (deadline: number, requireConfirmedEmpty: boolean) => Promise<void>;
}): void {
  let quitCleanupStarted = false;
  let quitCleanupComplete = false;
  app.on("before-quit", (event) => {
    if (quitCleanupComplete) return;
    event.preventDefault();
    if (quitCleanupStarted) return;
    quitCleanupStarted = true;
    void (async () => {
      if (options.getRunningManagedProcessCount() > 0 && !options.packagedStartupValidation) {
        const window = options.getMainWindow();
        const copy = managedProcessDialogCopy();
        const confirmation = {
          type: "warning" as const,
          title: copy.quitTitle,
          message: copy.quitMessage(options.getRunningManagedProcessCount()),
          detail: copy.quitDetail,
          buttons: [copy.stopAndQuitButton, copy.cancelButton],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        };
        const result = window
          ? await dialog.showMessageBox(window, confirmation)
          : await dialog.showMessageBox(confirmation);
        if (result.response !== 0) {
          quitCleanupStarted = false;
          options.setQuitting(false);
          return;
        }
      }
      options.setQuitting(true);
      options.getUpdateManager()?.stopAutomaticChecks();
      destroyTray();
      const deadline = Date.now() + 15000;
      try {
        try {
          const environmentCleanup = await beforeDeadline(
            options.getEnvironmentManager()?.shutdown() ?? Promise.resolve(),
            Math.min(deadline, Date.now() + 4000),
          );
          if (!environmentCleanup.completed) appendMainLog("environment cleanup reached the shutdown deadline");
        } catch (disposeError) {
          appendMainLog(
            `environment cleanup failed: ${disposeError instanceof Error ? disposeError.message : String(disposeError)}`,
          );
        }
        await options.cleanupManagedProcesses(deadline, false);
        const browserCleanup = await beforeDeadline(
          options.getBrowserService()?.dispose() ?? Promise.resolve(),
          deadline,
        );
        if (!browserCleanup.completed) appendMainLog("browser cleanup reached the shutdown deadline");
      } catch (error) {
        appendMainLog(`quit cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        quitCleanupComplete = true;
        app.quit();
      }
    })();
  });
}
