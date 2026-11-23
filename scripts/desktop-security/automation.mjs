export function automationSecurityChecks(read) {
  const main = read("src/main/main.ts");
  const requests = read("src/main/host-services.ts");
  const authority = read("src/main/automation-authority.ts");
  const consent = read("src/main/automation-consent.ts");
  const vault = read("src/main/credential-vault.ts");
  const ipc = read("src/main/ipc.ts");
  const bridge = read("src/preload/preload.ts");
  const desktop = read("src/contract/desktop.ts");
  const handlers = read("src/agent-host/handlers.ts");
  const automation = read("src/agent-host/handlers/automation.ts");
  const gatekeeper = read("src/contract/gatekeeper-methods.ts");
  const renderer = read("src/main/environments/renderer-port-bridge.ts");
  const rpc = read("src/contract/rpc.ts");
  const host = read("src/main/host-manager.ts");
  const stopAt = handlers.indexOf("await automationRuntime.stop()");
  const enableConfirmAt = authority.indexOf('confirmAutomation({ kind: "enable"');
  const enableCallAt = authority.indexOf('target.call("automation.enableTask"');
  const resolveConfirmAt = authority.indexOf('confirmAutomation({ kind: "resolve"');
  const resolveCallAt = authority.indexOf('target.call("automation.resolveAttention"');
  const refusalAt = renderer.indexOf("gatekeeperRefusal({ id: message.id, method: message.method })");
  const requestSetAt = renderer.indexOf("requests.set(id, message.id)");
  return [
    [
      main.includes("automation: createAutomationAuthority({") &&
        !requests.includes("automationConsent") &&
        !automation.includes("automationConsent") &&
        consent.includes('type: "warning"') &&
        consent.includes('buttons: ["取消", "确认"]') &&
        consent.includes("defaultId: 0") &&
        consent.includes("cancelId: 0") &&
        consent.includes("noLink: true") &&
        consent.includes("singleLine(target.serverEnvironmentId)"),
      "Main must own cancellation-first native automation consent without a Host-to-Main consent callback",
    ],
    [
      authority.includes("task.requiredGrant.planHash !== planHash") &&
        authority.includes("assertCurrent(target)") &&
        enableConfirmAt >= 0 &&
        enableCallAt >= 0 &&
        enableConfirmAt < enableCallAt &&
        resolveConfirmAt >= 0 &&
        resolveCallAt >= 0 &&
        resolveConfirmAt < resolveCallAt &&
        !automation.includes("body.unattendedWriteApproved") &&
        !automation.includes("body.trustedLocalExecApproved"),
      "AutomationAuthority must bind the displayed revision and connection and confirm before restricted RPC",
    ],
    [
      requests.includes('method.startsWith("automationSecrets.")') &&
        vault.includes('method !== "automationSecrets.get"') &&
        vault.includes("Automation secret access is read-only") &&
        vault.includes("safeStorage.encryptString") &&
        authority.includes("command.environmentId === PRIMARY_ENVIRONMENT_ID") &&
        authority.includes('target.call("automation.setSecret"'),
      "primary secrets must remain encrypted and read-only to the Host while remote writes stay on the bound remote",
    ],
    [
      ipc.includes('trustedHandle("desktop:automation:command"') &&
        ipc.includes("options.automation(parseAutomationCommand(command))") &&
        bridge.includes('ipcRenderer.invoke("desktop:automation:command", command)') &&
        desktop.includes("automationCommand:") &&
        !/getAutomationSecret|readAutomationSecret|setAutomationSecret|deleteAutomationSecret|listAutomationSecretNames/.test(
          desktop,
        ) &&
        !/desktop:(?:set-automation-secret|delete-automation-secret|list-automation-secret-names)/.test(ipc + bridge),
      "renderer automation commands must use one trusted parsed IPC contract without a plaintext secret-read API",
    ],
    [
      gatekeeper.includes("Record<GatekeeperMethod, true>") &&
        ["enableTask", "resolveAttention", "setSecret", "deleteSecret", "listSecretNames"].every((method) =>
          gatekeeper.includes(`"automation.${method}": true`),
        ) &&
        refusalAt >= 0 &&
        requestSetAt >= 0 &&
        refusalAt < requestSetAt &&
        rpc.includes("gatekeeperRefusal({ id: msg.id, method: msg.method })") &&
        host.includes('audience: "renderer"') &&
        host.includes('audience: "gatekeeper"'),
      "all GATEKEEPER_METHODS must be refused in place on renderer ports and use an explicit main-only audience",
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
