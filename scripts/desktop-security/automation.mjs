export function automationSecurityChecks(read) {
  const main = read("src/main/main.ts");
  const requests = read("src/main/host-services.ts");
  const consent = read("src/main/automation-consent.ts");
  const vault = read("src/main/credential-vault.ts");
  const ipc = read("src/main/ipc.ts");
  const bridge = read("src/preload/preload.ts");
  const desktop = read("src/contract/desktop.ts");
  const handlers = read("src/agent-host/handlers.ts");
  const automation = read("src/agent-host/handlers/automation.ts");
  const stopAt = handlers.indexOf("await automationRuntime.stop()");
  return [
    [
      main.includes("installHostServices({") &&
        requests.includes('method.startsWith("automationConsent.")') &&
        requests.includes("dialog.showMessageBox") &&
        consent.includes("defaultId: 0") &&
        consent.includes("cancelId: 0") &&
        consent.includes("request.requiredGrant?.planHash !== request.planHash"),
      "Main must own cancellation-first native automation consent bound to the displayed definition",
    ],
    [
      automation.includes('callMain<AutomationConsentResult>("automationConsent.confirm"') &&
        automation.includes("consent.taskId !== request.taskId") &&
        automation.includes("consent.revision !== request.revision") &&
        automation.includes("consent.planHash !== request.planHash") &&
        !automation.includes("body.unattendedWriteApproved") &&
        !automation.includes("body.trustedLocalExecApproved"),
      "automation enablement must use a matching native decision rather than renderer approval booleans",
    ],
    [
      requests.includes('method.startsWith("automationSecrets.")') &&
        vault.includes('method !== "automationSecrets.get"') &&
        vault.includes("Automation secret access is read-only") &&
        vault.includes("safeStorage.encryptString"),
      "automation Host secret access must be read-only and backed by encrypted Main storage",
    ],
    [
      ["set-automation-secret", "delete-automation-secret", "list-automation-secret-names"].every(
        (name) =>
          ipc.includes(`trustedHandle("desktop:${name}"`) && bridge.includes(`ipcRenderer.invoke("desktop:${name}"`),
      ) && !/getAutomationSecret|readAutomationSecret/.test(desktop),
      "renderer automation secret access must use trusted write/delete/name-list IPC and never return values",
    ],
    [
      stopAt >= 0 &&
        ["modelsCleanup", "processCleanup", "channelsCleanup", "filesCleanup", "sessionsCleanup"].every(
          (owner) => handlers.indexOf(`await ${owner}()`) > stopAt,
        ) &&
        handlers.includes("channels: channelManager") &&
        handlers.includes("registerChannelHandlers(server, channelManager)"),
      "automation must share the channel owner and drain before every other Host cleanup owner",
    ],
  ];
}
