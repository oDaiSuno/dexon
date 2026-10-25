import { configureSmokeEnvironment } from "./environment";
import { app, BrowserWindow, crashReporter, safeStorage } from "electron";
import fs from "node:fs";
import path from "path";
import { HostManager, resolveHostEntry } from "../main/host-manager";
import { installDesktopIpc } from "../main/ipc";
import { appendMainLog } from "../main/logger";
import { handleAppProtocol, registerAppProtocol, rendererRootPath } from "../main/protocol";
import { createMainWindow } from "../main/window";
import { runSmokeHostChecks } from "./host-checks";
import { createCredentialRequestHandler, CredentialVault } from "../main/credential-vault";
import { createProductionUpdateAdapter } from "../main/update-adapter";
import { createUpdateManager, type UpdateManager } from "../main/update-manager";
import { ToolchainManager } from "../main/toolchains/manager";
import { resolveRuntimeCatalogPath } from "../main/toolchains/catalog";
import { resolveBundledCorePaths } from "../main/toolchains/bundled-core";
import { isExecutionIntent } from "../shared/toolchains/types";
import { SMOKE_RESULT_FILE } from "./result";

const smokeUserData = configureSmokeEnvironment();
appendMainLog(
  `smoke: process identity pid=${process.pid} ppid=${process.ppid} argv=${JSON.stringify(process.argv.slice(1))} userDataEnv=${smokeUserData} runAsNode=${process.env.ELECTRON_RUN_AS_NODE ?? "unset"}`,
);

registerAppProtocol();
crashReporter.start({
  productName: "Dexon Smoke",
  uploadToServer: false,
  compress: false,
});

const runtimeMainDirectory = path.join(process.cwd(), "out", "main");
let hostManager: HostManager | null = null;
let smokeWindow: BrowserWindow | null = null;
let updateManager: UpdateManager | null = null;
let checksStarted = false;

// Production startup and single-instance behavior are verified by the separate
// production-startup probe, which loads out/main/main.js rather than copying boot.

// A hidden test window is intentionally destroyed before the runner exits.
// Its closure is not a success signal; finish owns this process's lifetime.
app.on("window-all-closed", () => {});

function finish(exitCode: number, error?: unknown): void {
  if (exitCode === 0) {
    try {
      fs.writeFileSync(
        path.join(smokeUserData!, SMOKE_RESULT_FILE),
        JSON.stringify({ completed: true, pid: process.pid }),
      );
    } catch (cause) {
      exitCode = 1;
      error = cause;
    }
  }
  if (error) {
    appendMainLog(`smoke: checks failed — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  void hostManager?.stop();
  hostManager = null;
  updateManager?.dispose();
  updateManager = null;
  if (smokeWindow && !smokeWindow.isDestroyed()) smokeWindow.destroy();
  smokeWindow = null;
  app.exit(exitCode);
}

void app.whenReady().then(async () => {
  handleAppProtocol(rendererRootPath(runtimeMainDirectory));
  const updateAdapter = await createProductionUpdateAdapter();
  updateManager = createUpdateManager({
    adapter: updateAdapter,
    currentVersion: app.getVersion(),
    isPackaged: false,
  });
  const bundledCorePaths = resolveBundledCorePaths({
    isPackaged: false,
    resourcesRoot: process.resourcesPath,
  });
  const toolchainManager = new ToolchainManager({
    homeDir: app.getPath("home"),
    tempRoot: app.getPath("temp"),
    userDataRoot: app.getPath("userData"),
    resourcesRoot: process.resourcesPath,
    catalogPath: resolveRuntimeCatalogPath({
      isPackaged: false,
      resourcesRoot: process.resourcesPath,
    }),
    coreCatalogPath: bundledCorePaths.catalogPath,
    bundledCoreRoot: bundledCorePaths.coreRoot,
  });
  await toolchainManager.initialize();

  hostManager = new HostManager(resolveHostEntry(runtimeMainDirectory));
  const smokeVaultPath = path.join(app.getPath("userData"), "smoke-channel-secrets.json");
  const credentialVault = new CredentialVault(smokeVaultPath);
  hostManager.setToolchainSnapshot(toolchainManager.getSnapshot());
  const credentialRequestHandler = createCredentialRequestHandler(credentialVault);
  hostManager.setRequestHandler(async (method, params) => {
    if (method.startsWith("channelSecrets.")) return credentialRequestHandler(method, params);
    if (method === "toolchain.getSnapshot") return toolchainManager.getSnapshot();
    if (method === "toolchain.resolve") {
      const body = (params ?? {}) as { cwd?: unknown; intent?: unknown; trusted?: unknown };
      if (
        typeof body.cwd !== "string" ||
        !path.isAbsolute(body.cwd) ||
        !isExecutionIntent(body.intent) ||
        typeof body.trusted !== "boolean"
      ) {
        throw new Error("Invalid smoke toolchain request");
      }
      return toolchainManager.resolveForProject(body.cwd, { intent: body.intent, trusted: body.trusted });
    }
    throw new Error(`Unsupported smoke Host request: ${method}`);
  });
  if (safeStorage.isEncryptionAvailable()) {
    const key = "channel:feishu:smoke-test";
    credentialVault.set(key, {
      token: "smoke-app-secret",
      providerAccountId: "ou_smoke_bot",
      baseUrl: "https://open.feishu.cn",
    });
    const rawVault = fs.readFileSync(smokeVaultPath, "utf8");
    const savedCredential = new CredentialVault(smokeVaultPath).get(key);
    if (
      rawVault.includes("smoke-app-secret") ||
      savedCredential?.token !== "smoke-app-secret" ||
      savedCredential.providerAccountId !== "ou_smoke_bot"
    ) {
      finish(1, new Error("Credential vault reload failed"));
      return;
    }
    credentialVault.delete(key);
    try {
      fs.unlinkSync(smokeVaultPath);
    } catch {
      /* ignore cleanup failure */
    }
  }
  installDesktopIpc({
    getHostManager: () => hostManager,
    getMainWindow: () => smokeWindow,
    getUnreadBadge: () => 0,
    applyBadgeCount: () => {},
    getToolchainState: () => toolchainManager.getPublicState(),
    rescanToolchains: async (cwd) => (await toolchainManager.rescan({ cwd })).publicState,
    performToolchainAction: (request) => toolchainManager.performAction(request),
    chooseCustomTool: (capability, executable) => toolchainManager.registerCustomTool(capability, executable),
    getManagedToolsRoot: () => toolchainManager.getManagedRoot(),
    setChannelCredential: (payload) =>
      credentialVault.set(`channel:${payload.channel}:${payload.accountId}`, payload.credential),
    getBrowserService: () => null,
    getManagedProcessCapability: () => ({
      platform: process.platform,
      arch: process.arch,
      supported: false,
      ready: false,
      backend: "none",
      errorCode: process.platform === "win32" ? "ARCH_UNSUPPORTED" : "PLATFORM_UNSUPPORTED",
    }),
    updateManager,
  });

  hostManager.setStatusListener((status, detail) => {
    appendMainLog(`smoke: host status=${status} ${detail ?? ""}`);
    const manager = hostManager;
    if (status === "ready" && manager && !checksStarted) {
      checksStarted = true;
      void runSmokeHostChecks(manager, (onConsoleError) => {
        smokeWindow = createMainWindow({
          isDev: false,
          show: false,
          runtimeMainDirectory,
          onConsoleError,
          onClosed: () => {
            smokeWindow = null;
          },
        });
        return smokeWindow;
      }).then(
        () => finish(0),
        (error) => finish(1, error),
      );
    } else if (status === "crashed") {
      finish(1, new Error(`Agent Host crashed: ${detail ?? "unknown error"}`));
    }
  });
  hostManager.start();
});

app.on("before-quit", () => void hostManager?.stop());
