import { createDesktopToolchains } from "./desktop-toolchains";
import { installHostNotifications, applyDesktopBadgeCount } from "./host-notifications";
import { installHostServices } from "./host-services";
import { installQuitCleanup } from "./quit-cleanup";
import { PackagedStartupValidation } from "./packaged-startup-validation";
import { stopAllManagedProcessesFromTray } from "./managed-process/dialog-copy";
import { app, BrowserWindow, crashReporter, nativeTheme, Notification, powerMonitor } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { HostManager, getUserDataPath, resolveHostEntry } from "./host-manager";
import { EnvironmentManager } from "./environments/environment-manager";
import { appendMainLog } from "./logger";
import { installAppMenu } from "./menu";
import { handleAppProtocol, registerAppProtocol, rendererRootPath } from "./protocol";
import { acquireSingleInstanceLock } from "./single-instance";
import { loadUiState } from "./window-state";
import { createTray, destroyTray } from "./tray";
import { createMainWindow } from "./window";
import { installDesktopIpc } from "./ipc";
import { CredentialVault } from "./credential-vault";
import { createProductionUpdateAdapter, isProductionUpdatePlatformEnabled } from "./update-adapter";
import { createUpdateManager, redactUpdateError, type UpdateManager } from "./update-manager";
import type { ToolchainManager } from "./toolchains/manager";
import { BrowserService } from "./browser/browser-service";
import { findDesktopDeepLink, parseDesktopDeepLink } from "./deep-link";
import { restartHostAfterExit } from "./host-install-recovery";
import { ManagedProcessReaper, secureWindowsReaperDirectory } from "./managed-process/reaper";
import { cleanupManagedProcessContainment } from "./managed-process/shutdown-cleanup";
import {
  resolveWindowsManagedProcessHelper,
  type WindowsManagedProcessHelperResolution,
  verifyWindowsManagedProcessHelperReplaceable,
} from "../shared/windows-managed-process-helper";
import type { ManagedProcessCapability } from "../contract/processes";
import { projectManagedProcessCapability } from "./managed-process/capability";
import { runPackagedCleanupFaultValidation } from "./packaged-cleanup-fault-validation";
registerAppProtocol();
crashReporter.start({
  productName: "Dexon",
  uploadToServer: false,
  compress: false,
});

const isDev = !app.isPackaged;
const packagedStartupValidation = app.isPackaged && process.argv.includes("--validate-packaged-startup");
const packagedCleanupFaultValidation = app.isPackaged && process.argv.includes("--validate-packaged-cleanup-fault");
const expectedPiVersion = process.env.PI_DESKTOP_EXPECTED_PI_VERSION;
const TOOLCHAIN_FOCUS_RESCAN_TTL_MS = 60_000;
const MANAGED_PROCESS_SHUTDOWN_DEADLINE_MS = 15_000;

let mainWindow: BrowserWindow | null = null;
let hostManager: HostManager | null = null;
let environmentManager: EnvironmentManager | null = null;
let updateManager: UpdateManager | null = null;
let toolchainManager: ToolchainManager | null = null;
let browserService: BrowserService | null = null;
let managedProcessReaper: ManagedProcessReaper | null = null;
let windowsManagedProcessHelper: WindowsManagedProcessHelperResolution | null = null;
let isQuitting = false;
let unreadBadge = 0;
let pendingDeepLink: string | null = null;
let lastNotifiedUpdateVersion: string | null = null;
let lastToolchainFocusScanAt = 0;
let runningAgentSessionCount = 0;
let runningManagedProcessCount = 0;
const startupValidation = new PackagedStartupValidation({
  enabled: packagedStartupValidation,
  expectedPiVersion,
  getHostManager: () => hostManager,
  getUpdateManager: () => updateManager,
  managedProcessSupported: () => getManagedProcessCapability().supported,
  setQuitting: (value) => {
    isQuitting = value;
  },
});

function getManagedProcessCapability(): ManagedProcessCapability {
  const status = managedProcessReaper?.status();
  const owner = hostManager?.getManagedProcessOwnerState();
  return projectManagedProcessCapability({
    platform: process.platform,
    arch: process.arch,
    reaperReady: status?.ready === true,
    helper: windowsManagedProcessHelper,
    ownerReady: owner?.ready === true && Boolean(owner.hostInstanceId),
    windowsRelease: os.release(),
    windowsVersion: os.version(),
  });
}

async function cleanupManagedProcesses(deadline: number, requireConfirmedEmpty: boolean): Promise<void> {
  await cleanupManagedProcessContainment({
    deadline,
    requireConfirmedEmpty,
    stopHost: () => hostManager?.stop() ?? Promise.resolve(),
    ...(managedProcessReaper
      ? {
          reapAll: () => managedProcessReaper!.reapAll(),
          getStatus: () => managedProcessReaper!.status(),
        }
      : {}),
    log: appendMainLog,
  });
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function stopAllFromTray(): void {
  void stopAllManagedProcessesFromTray({ count: runningManagedProcessCount, hostManager, window: getMainWindow() });
}

function applyBadgeCount(count: number): void {
  unreadBadge = Math.max(0, Number(count) || 0);
  applyDesktopBadgeCount(unreadBadge, getMainWindow());
}

function handleDeepLink(url: string): void {
  const parsed = parseDesktopDeepLink(url);
  appendMainLog(`deep link received valid=${Boolean(parsed?.sessionId)}`);
  if (!parsed?.sessionId) return;
  const win = getMainWindow();
  if (win) {
    win.webContents.send("deep-link:session", parsed.sessionId);
    win.show();
    win.focus();
  } else {
    pendingDeepLink = parsed.sessionId;
  }
}

function startMainProcess(): void {
  const devUserDataDirectory = isDev ? process.env.DEXON_DEV_USER_DATA_DIR : undefined;
  if (devUserDataDirectory) app.setPath("userData", path.resolve(devUserDataDirectory));
  if (
    !acquireSingleInstanceLock(getMainWindow, (argv) => {
      const url = findDesktopDeepLink(argv);
      if (url) handleDeepLink(url);
    })
  ) {
    app.quit();
    return;
  }

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on("login", (event, webContents, _details, authInfo, callback) => {
    const credentials = browserService?.getProxyCredentialsForWebContents(webContents.id, authInfo.isProxy);
    if (!credentials) return;
    event.preventDefault();
    callback(credentials.username, credentials.password);
  });

  function createWindow(): BrowserWindow {
    const win = createMainWindow({
      isDev,
      consumePendingDeepLink: () => {
        const sessionId = pendingDeepLink;
        pendingDeepLink = null;
        return sessionId;
      },
      shouldHideOnClose: () => !isQuitting && loadUiState().backgroundMode !== false,
      onClosed: (closedWindow) => {
        if (mainWindow === closedWindow) {
          mainWindow = null;
          browserService?.handleWindowClosed();
        }
      },
      onRendererUnavailable: () => browserService?.handleRendererUnavailable(),
    });
    mainWindow = win;
    win.on("hide", () => browserService?.handleWindowVisibility(false));
    win.on("minimize", () => browserService?.handleWindowVisibility(false));
    win.on("show", () => browserService?.handleWindowVisibility(true));
    win.on("restore", () => browserService?.handleWindowVisibility(true));
    win.on("focus", () => {
      const manager = toolchainManager;
      const now = Date.now();
      if (!manager || now - lastToolchainFocusScanAt < TOOLCHAIN_FOCUS_RESCAN_TTL_MS) return;
      lastToolchainFocusScanAt = now;
      void manager.rescan().catch((error) => {
        appendMainLog(`toolchain focus rescan failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    if (packagedStartupValidation) {
      win.webContents.once("did-finish-load", () => {
        startupValidation.rendererReady = true;
        startupValidation.finish();
      });
      win.webContents.once("did-fail-load", (_event, code, description) => {
        startupValidation.finish(`Renderer failed to load (${code}): ${description}`);
      });
    }
    if (unreadBadge > 0) applyBadgeCount(unreadBadge);
    void browserService?.restoreTabs();
    return win;
  }

  function openUpdateSettings(checkForUpdates: boolean): void {
    const win = getMainWindow() ?? createWindow();
    win.show();
    win.focus();
    const send = () => {
      if (!win.isDestroyed()) {
        win.webContents.send(checkForUpdates ? "menu:check-for-updates" : "menu:show-update");
      }
    };
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once("did-finish-load", send);
    } else {
      send();
    }
  }

  void app.whenReady().then(async () => {
    appendMainLog(`app ready packaged=${app.isPackaged}`);
    if (packagedCleanupFaultValidation) {
      let exitCode = 0;
      try {
        const report = await runPackagedCleanupFaultValidation({
          productionDeadlineMs: MANAGED_PROCESS_SHUTDOWN_DEADLINE_MS,
        });
        fs.mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
        fs.writeFileSync(
          path.join(app.getPath("userData"), "packaged-cleanup-fault-check.json"),
          `${JSON.stringify(report, null, 2)}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        if (!report.ok) exitCode = 1;
      } catch (error) {
        exitCode = 1;
        appendMainLog(`packaged cleanup fault validation failed: ${error instanceof Error ? error.name : "unknown"}`);
      }
      isQuitting = true;
      app.exit(exitCode);
      return;
    }
    if (process.platform === "win32" && process.arch === "x64") {
      windowsManagedProcessHelper = resolveWindowsManagedProcessHelper({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        projectRoot: path.resolve(__dirname, "../.."),
      });
      appendMainLog(
        windowsManagedProcessHelper.ok
          ? `windows managed process helper verified build=${windowsManagedProcessHelper.descriptor.buildId} provenance=${windowsManagedProcessHelper.descriptor.provenance}`
          : `windows managed process helper unavailable error=${windowsManagedProcessHelper.errorCode}${"reason" in windowsManagedProcessHelper ? ` reason=${windowsManagedProcessHelper.reason}` : ""}`,
      );
    }
    const reaperDirectory = path.join(app.getPath("userData"), "managed-process-reaper");
    const windowsJournalSecured =
      process.platform !== "win32" ||
      Boolean(
        windowsManagedProcessHelper?.ok &&
        (await secureWindowsReaperDirectory(reaperDirectory, windowsManagedProcessHelper.descriptor, appendMainLog)),
      );
    managedProcessReaper = new ManagedProcessReaper(path.join(reaperDirectory, "journal-v2.json"), {
      log: appendMainLog,
      ...(windowsManagedProcessHelper?.ok && windowsJournalSecured
        ? { windowsHelper: windowsManagedProcessHelper.descriptor }
        : {}),
    });
    const reaperStatus = await managedProcessReaper.initialize();
    appendMainLog(
      `managed process reaper ready=${reaperStatus.ready} records=${reaperStatus.records} revision=${reaperStatus.revision}${reaperStatus.errorCode ? ` error=${reaperStatus.errorCode}` : ""}`,
    );
    if (packagedStartupValidation) {
      startupValidation.start();
    }

    const credentialVault = new CredentialVault(getUserDataPath("channels.secrets.json"));
    browserService = new BrowserService({
      userDataDir: app.getPath("userData"),
      getWindow: getMainWindow,
      emit: (event) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send("browser:event", event);
      },
      onCapabilitySnapshot: (snapshot) => hostManager?.setBrowserCapabilitySnapshot(snapshot),
    });
    const ui = loadUiState();
    const updaterTestMode = !app.isPackaged && process.env.PI_DESKTOP_TEST_UPDATER === "1";
    const updaterSupported =
      isProductionUpdatePlatformEnabled(process.platform) ||
      (updaterTestMode && (process.platform === "darwin" || process.platform === "win32"));
    const updaterRequested = app.isPackaged || updaterTestMode;
    let updateAdapter = null;
    if (updaterSupported && updaterRequested) {
      try {
        updateAdapter = await createProductionUpdateAdapter({
          useDevelopmentConfig: updaterTestMode,
        });
      } catch (error) {
        appendMainLog(`updater unavailable: ${redactUpdateError(error)}`);
      }
    }
    updateManager = createUpdateManager({
      adapter: updateAdapter,
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      automaticChecksEnabled: ui.automaticUpdateChecks !== false,
      prepareToInstall: async () => {
        isQuitting = true;
        destroyTray();
        const deadline = Date.now() + MANAGED_PROCESS_SHUTDOWN_DEADLINE_MS;
        await cleanupManagedProcesses(deadline, true);
        if (process.platform === "win32") {
          const refreshed = resolveWindowsManagedProcessHelper({
            isPackaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            projectRoot: path.resolve(__dirname, "../.."),
          });
          if (!refreshed.ok) throw new Error("Windows managed process helper is unavailable for update");
          if (!verifyWindowsManagedProcessHelperReplaceable(refreshed.descriptor)) {
            throw new Error("Windows managed process helper is locked for update");
          }
          windowsManagedProcessHelper = refreshed;
        }
      },
      recoverFromInstallFailure: async () => {
        isQuitting = false;
        createTray(getMainWindow, stopAllFromTray);
        const manager = hostManager;
        if (manager) await restartHostAfterExit(manager, () => !isQuitting);
      },
      log: (level, message) => appendMainLog(`updater[${level}] ${message}`),
    });
    toolchainManager = createDesktopToolchains(() => runningAgentSessionCount > 0);
    toolchainManager.subscribe((snapshot) => {
      if (packagedStartupValidation) startupValidation.toolchainSnapshot = snapshot;
      appendMainLog(
        `toolchain scan revision=${snapshot.revision} candidates=${snapshot.candidates.length} ready=${snapshot.publicState.coreReady}`,
      );
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("toolchains:state", snapshot.publicState);
      }
      hostManager?.setToolchainSnapshot(snapshot);
      startupValidation.finish();
    });
    updateManager.subscribe((state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("update:state", state);
      }
      if (state.phase === "available") {
        const notificationKey = state.availableVersion ?? "unknown";
        if (lastNotifiedUpdateVersion !== notificationKey) {
          lastNotifiedUpdateVersion = notificationKey;
          const win = getMainWindow();
          const shouldNotify = !win || !win.isVisible() || !win.isFocused();
          if (shouldNotify && Notification.isSupported()) {
            const notification = new Notification({
              title: "Dexon update available",
              body: state.availableVersion
                ? `Version ${state.availableVersion} is ready to download.`
                : "A new version is ready to download.",
            });
            notification.on("click", () => {
              openUpdateSettings(false);
            });
            notification.show();
          }
        }
      }
    });
    handleAppProtocol(rendererRootPath());

    hostManager = new HostManager(resolveHostEntry());
    environmentManager = new EnvironmentManager({
      hostManager,
      userDataDir: app.getPath("userData"),
      payloadDirectory: path.join(
        app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "out"),
        "remote-payload",
      ),
      onChanged: (environments) => {
        for (const win of BrowserWindow.getAllWindows())
          if (!win.isDestroyed()) win.webContents.send("environments:changed", environments);
      },
    });
    powerMonitor.on("resume", () => environmentManager?.notifyWakeup("resume"));
    app.on("browser-window-focus", () => environmentManager?.notifyWakeup("application-active"));
    installDesktopIpc({
      environmentManager,
      getHostManager: () => hostManager,
      getMainWindow,
      getUnreadBadge: () => unreadBadge,
      applyBadgeCount,
      getToolchainState: (cwd) =>
        cwd ? toolchainManager!.getPublicStateForProject(cwd) : toolchainManager!.getPublicState(),
      rescanToolchains: async (cwd) => {
        await toolchainManager!.rescan({ cwd });
        return cwd ? toolchainManager!.getPublicStateForProject(cwd) : toolchainManager!.getPublicState();
      },
      performToolchainAction: (request) => toolchainManager!.performAction(request),
      chooseCustomTool: (capability, executable) => toolchainManager!.registerCustomTool(capability, executable),
      getManagedToolsRoot: () => toolchainManager?.getManagedRoot(),
      automationSecrets: credentialVault,
      setChannelCredential: (payload) =>
        credentialVault.set(`channel:${payload.channel}:${payload.accountId}`, payload.credential),
      getBrowserService: () => browserService,
      getManagedProcessCapability,
      updateManager,
    });
    installAppMenu(getMainWindow, () => openUpdateSettings(true), isDev);

    createTray(getMainWindow, stopAllFromTray);
    if (ui.theme === "light" || ui.theme === "dark" || ui.theme === "system") {
      nativeTheme.themeSource = ui.theme;
    }

    installHostServices({
      hostManager,
      toolchainManager,
      managedProcessReaper,
      browserService,
      credentialVault,
      getWindowsHelper: () => windowsManagedProcessHelper,
      getMainWindow,
      getManagedProcessCapability,
    });
    installHostNotifications({
      hostManager,
      environmentManager,
      packagedStartupValidation,
      startupValidation,
      getMainWindow,
      getUpdateManager: () => updateManager,
      getBrowserService: () => browserService,
      onAgentCount: (count) => {
        runningAgentSessionCount = count;
      },
      onManagedCount: (count) => {
        runningManagedProcessCount = count;
      },
      onUnreadSession: () => applyBadgeCount(unreadBadge + 1),
    });

    hostManager.start();

    createWindow();
    void toolchainManager.initialize();
    updateManager.startAutomaticChecks();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        getMainWindow()?.show();
      }
    });
  });

  installQuitCleanup({
    getRunningManagedProcessCount: () => runningManagedProcessCount,
    packagedStartupValidation,
    getMainWindow,
    setQuitting: (value) => {
      isQuitting = value;
    },
    getUpdateManager: () => updateManager,
    getEnvironmentManager: () => environmentManager,
    getBrowserService: () => browserService,
    cleanupManagedProcesses,
  });

  app.on("certificate-error", (event, webContents, url, _error, _certificate, callback) => {
    try {
      const hostname = new URL(url).hostname;
      if (browserService?.handleCertificateError(webContents.id, hostname)) {
        event.preventDefault();
        callback(true);
      }
    } catch {}
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("dexon", process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient("dexon");
  }
}

startMainProcess();
