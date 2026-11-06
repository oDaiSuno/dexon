import { dialog, type BrowserWindow } from "electron";
import path from "node:path";
import type { HostManager } from "./host-manager";
import type { ToolchainManager } from "./toolchains/manager";
import type { BrowserService } from "./browser/browser-service";
import type { ManagedProcessReaper } from "./managed-process/reaper";
import type { ManagedProcessCapability } from "../contract/processes";
import type { WindowsManagedProcessHelperResolution } from "../shared/windows-managed-process-helper";
import { isExecutionIntent } from "../shared/toolchains/types";
import { normalizeSessionOrchestrationSettings } from "../shared/session-orchestration";
import { createCredentialRequestHandler, type CredentialVault } from "./credential-vault";
import { canRestartHostAfterCleanup } from "./managed-process/restart-gate";
import { managedProcessDialogCopy } from "./managed-process/dialog-copy";
import { loadUiState } from "./window-state";
import { appendMainLog } from "./logger";
export function installHostServices({
  hostManager,
  toolchainManager,
  managedProcessReaper,
  browserService,
  credentialVault,
  getWindowsHelper,
  getMainWindow,
  getManagedProcessCapability,
}: {
  hostManager: HostManager;
  toolchainManager: ToolchainManager;
  managedProcessReaper: ManagedProcessReaper;
  browserService: BrowserService;
  credentialVault: CredentialVault;
  getWindowsHelper: () => WindowsManagedProcessHelperResolution | null;
  getMainWindow: () => BrowserWindow | null;
  getManagedProcessCapability: () => ManagedProcessCapability;
}) {
  hostManager.setBeforeRestartHandler(async () => {
    const status = await managedProcessReaper.reapAll();
    appendMainLog(
      `managed process pre-restart reap ready=${status.ready} records=${status.records}${status.errorCode ? ` error=${status.errorCode}` : ""}`,
    );
    if (!canRestartHostAfterCleanup(status)) {
      throw new Error(`Managed process cleanup blocked Host restart (${status.errorCode ?? "unknown"})`);
    }
  });
  hostManager.setToolchainSnapshot(toolchainManager.getSnapshot());
  hostManager.setBrowserCapabilitySnapshot(browserService.getCapabilitySnapshot());
  hostManager.setSessionOrchestrationSettings(loadUiState().sessionOrchestration);
  const credentialRequestHandler = createCredentialRequestHandler(credentialVault);
  hostManager.setRequestHandler(async (method, params) => {
    if (method.startsWith("channelSecrets.")) return credentialRequestHandler(method, params);
    if (method === "toolchain.getSnapshot") return toolchainManager.getSnapshot();
    if (method === "toolchain.resolve") {
      const body = (params ?? {}) as { cwd?: unknown; intent?: unknown; trusted?: unknown };
      if (
        typeof body.cwd !== "string" ||
        !path.isAbsolute(body.cwd) ||
        body.cwd.length > 4_096 ||
        /[\0\r\n]/.test(body.cwd) ||
        !isExecutionIntent(body.intent) ||
        typeof body.trusted !== "boolean"
      ) {
        throw new Error("Invalid Host toolchain resolution request");
      }
      return toolchainManager.resolveForProject(body.cwd, { intent: body.intent, trusted: body.trusted });
    }
    if (method === "sessionOrchestration.getSettings") {
      return normalizeSessionOrchestrationSettings(loadUiState().sessionOrchestration);
    }
    if (method === "managedProcesses.getSettings") {
      const status = managedProcessReaper?.status();
      const capability = getManagedProcessCapability();
      const windowsManagedProcessHelper = getWindowsHelper();
      return {
        enabled: capability.ready && loadUiState().managedProcessesEnabled === true,
        reaperReady: status?.ready === true,
        capability,
        ...(windowsManagedProcessHelper?.ok ? { windowsHelper: windowsManagedProcessHelper.descriptor } : {}),
      };
    }
    if (method === "managedProcesses.register") {
      const body = (params ?? {}) as { record?: unknown };
      const record = body.record;
      const recordPlatform =
        record && typeof record === "object" && !Array.isArray(record)
          ? (record as { platform?: unknown }).platform
          : undefined;
      if (recordPlatform === "win32") {
        const currentOwner = hostManager?.getManagedProcessOwnerState();
        const recordOwner = (record as { hostInstanceId?: unknown }).hostInstanceId;
        if (!currentOwner?.ready || recordOwner !== currentOwner.hostInstanceId) {
          throw new Error("Windows managed process register owner generation mismatch");
        }
      }
      return managedProcessReaper.register(record);
    }
    if (method === "managedProcesses.unregister") {
      return managedProcessReaper.unregister(params);
    }
    if (method === "managedProcesses.confirmLanBind") {
      const body = (params ?? {}) as { ownerSessionId?: unknown; commandHash?: unknown };
      if (
        typeof body.ownerSessionId !== "string" ||
        body.ownerSessionId.length > 128 ||
        typeof body.commandHash !== "string" ||
        !/^[a-f0-9]{16}$/.test(body.commandHash)
      ) {
        throw new Error("Invalid managed process network confirmation request");
      }
      const window = getMainWindow();
      const copy = managedProcessDialogCopy();
      const options = {
        type: "warning" as const,
        title: copy.lanTitle,
        message: copy.lanMessage,
        detail: copy.lanDetail,
        buttons: [copy.allowOnceButton, copy.cancelButton],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      return { confirmed: result.response === 0 };
    }
    if (method === "managedProcesses.selectExportTarget") {
      const body = (params ?? {}) as { suggestedName?: unknown };
      const suggestedName =
        typeof body.suggestedName === "string" && /^[a-z0-9._-]{1,128}$/i.test(body.suggestedName)
          ? body.suggestedName
          : "managed-process.log";
      const copy = managedProcessDialogCopy();
      const options = {
        title: copy.exportTitle,
        defaultPath: suggestedName,
        filters: [{ name: copy.exportFilter, extensions: ["log", "txt"] }],
        properties: ["showOverwriteConfirmation" as const, "createDirectory" as const],
      };
      const window = getMainWindow();
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath
        ? {}
        : { path: result.filePath, fileName: path.basename(result.filePath) };
    }
    if (method.startsWith("browser.")) {
      return browserService.handleHostRequest(method, params);
    }
    throw new Error(`Unsupported Host request: ${method}`);
  });
}
