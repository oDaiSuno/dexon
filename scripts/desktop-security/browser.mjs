export function browserSecurityChecks(read) {
  const main = read("src/main/main.ts");
  const windowFactory = read("src/main/window.ts");
  const preload = read("src/preload/preload.ts");
  const rpcManager = [
    "src/agent-host/rpc-manager.ts",
    "src/agent-host/agent-session/wrapper.ts",
    "src/agent-host/agent-session/compat.ts",
  ]
    .map(read)
    .join("\n");
  const desktopContract = read("src/contract/desktop.ts");
  const desktopIpc = read("src/main/ipc.ts");
  const desktopIpcTrust = read("src/main/ipc-trust.ts");
  const browserContract = read("src/contract/browser.ts");
  const browserSettings = read("src/main/browser/browser-settings.ts");
  const browserPolicy = read("src/main/browser/browser-policy.ts");
  const browserService = read("src/main/browser/browser-service.ts");
  const browserAuthorization = read("src/main/browser/browser-authorization-coordinator.ts");
  const browserGrantStore = read("src/main/browser/browser-persistent-grant-store.ts");
  const browserTools = read("src/agent-host/browser-tools.ts");
  const browserTabs = read("src/main/browser/browser-tab-manager.ts");
  const browserDevToolsShortcut = read("src/main/browser/browser-devtools-shortcut.ts");
  const browserNetwork = read("src/main/browser/browser-network-interceptor.ts");
  const browserIdentity = read("src/main/browser/browser-identity-manager.ts");
  const browserRecorder = read("src/main/browser/browser-network-recorder.ts");
  const browserConsole = read("src/main/browser/browser-console-buffer.ts");
  const browserInspectionStore = read("src/main/browser/browser-inspection-store.ts");
  const browserRedaction = read("src/main/browser/browser-redaction.ts");
  const browserSnippets = read("src/main/browser/browser-snippet-store.ts");
  const browserVault = read("src/main/browser/browser-secret-vault.ts");
  const browserAgentRuntime = read("src/agent-host/browser-agent-runtime.ts");
  const toolchainBash = read("src/agent-host/toolchain-bash.ts");
  const packageJson = read("package.json");
  const browserInspectRpc = browserContract.slice(
    browserContract.indexOf('"browser.inspect": {'),
    browserContract.indexOf('"browser.screenshot": {'),
  );
  const browserDeniedTargetState = browserAgentRuntime.slice(
    browserAgentRuntime.indexOf("type DeniedTarget ="),
    browserAgentRuntime.indexOf("type BrowserWorkingMemory ="),
  );
  return [
    [
      browserTabs.includes("new WebContentsView") &&
        browserTabs.includes("nodeIntegration: false") &&
        browserTabs.includes("nodeIntegrationInWorker: false") &&
        browserTabs.includes("contextIsolation: true") &&
        browserTabs.includes("sandbox: true") &&
        browserTabs.includes("webviewTag: false") &&
        !/webPreferences\s*:\s*\{[^}]*preload\s*:/s.test(browserTabs),
      "remote Browser WebContentsView must remain sandboxed without Node, webviewTag, or a preload bridge",
    ],
    [
      browserNetwork.includes("setPermissionCheckHandler") &&
        browserNetwork.includes("setPermissionRequestHandler") &&
        browserService.includes("setDevicePermissionHandler(() => false)"),
      "Browser Sessions must install request/check permission handlers and deny device permissions by default",
    ],
    [
      /automation:\s*\{[\s\S]*?enabled:\s*false/.test(browserSettings) &&
        /advancedBrowserMode:\s*\{[\s\S]*?enabled:\s*false/.test(browserSettings) &&
        browserPolicy.includes("enabled: false") &&
        browserPolicy.includes("createDisabledAdvancedRuntimePolicy") &&
        !browserSettings.includes("humanizedInput"),
      "Agent Browser automation and the single Advanced Browser Mode grant must default to disabled",
    ],
    [
      browserService.includes("isBrowserHostMethod(method)") &&
        !browserContract.slice(browserContract.indexOf("export interface BrowserHostRpc")).includes("updateSettings") &&
        !browserContract.slice(browserContract.indexOf("export interface BrowserHostRpc")).includes("setUnsafePolicy"),
      "Host Browser RPC must be allowlisted and must not expose settings or Unsafe policy writes",
    ],
    [
      browserContract.includes('"browser.requestAuthorization"') &&
        browserTools.includes('"browser.requestAuthorization"') &&
        browserService.indexOf('method === "browser.requestAuthorization"') <
          browserService.indexOf("this.policy.assertRequest(context, permission)") &&
        !desktopContract.includes("browserGrantSession:") &&
        !preload.includes("desktop:browser:grant-session"),
      "Agent Browser tools must preflight in Main before side effects and Renderer must not mint arbitrary runtime grants",
    ],
    [
      browserGrantStore.includes("mode: 0o600") &&
        browserGrantStore.includes("fs.renameSync(temp, this.filePath)") &&
        browserAuthorization.includes("private readonly pendingById") &&
        browserAuthorization.includes("AUTHORIZATION_TIMEOUT") &&
        browserAuthorization.includes("isRendererAvailable") &&
        !browserGrantStore.includes("capabilityLeaseId"),
      "persistent Browser policies must be private and atomic while pending requests and leases remain in memory",
    ],
    [
      desktopIpc.includes("const requireTrustedBrowser") &&
        desktopIpc.includes("assertTrustedSender(event)") &&
        desktopIpcTrust.includes("event.sender === window.webContents") &&
        desktopIpcTrust.includes("event.senderFrame === window.webContents.mainFrame") &&
        browserService.includes("authorizeBrowserSettingsUpdate(before, patch") &&
        browserService.includes('this.confirmations.consume(proof, "advanced-browser-mode", payload)') &&
        !browserService.includes('"unsafe-lab"'),
      "Browser settings IPC must validate the main-window sender/frame and consume one-time confirmation proofs",
    ],
    [
      browserVault.includes("safeStorage") === false &&
        browserVault.includes("codec.encrypt(value)") &&
        browserService.includes("getRedactedDiagnostics") &&
        !/interface BrowserDiagnostics[\s\S]*?(cookie|authorization|password|secret|pageText|javascript)/i.test(
          browserContract.slice(
            browserContract.indexOf("export interface BrowserDiagnostics"),
            browserContract.indexOf("export interface BrowserRendererState"),
          ),
        ),
      "Browser diagnostics must expose summaries only while secret values remain encrypted behind opaque references",
    ],
    [
      !browserTools.includes('"browser_set_cookies"') &&
        browserService.includes("Cookie mutation is unavailable because sensitive ToolResult persistence isolation") &&
        browserService.includes(
          "Full cookie values are unavailable because sensitive ToolResult persistence isolation",
        ),
      "Agent Browser tools must not accept cookie values until Gate A proves tool-call persistence isolation",
    ],
    [
      !main.includes("remote-debugging-port") &&
        !browserTabs.includes("remote-debugging-port") &&
        !main.includes("ignore-certificate-errors") &&
        !browserTabs.includes("ignore-certificate-errors") &&
        !windowFactory.includes("webSecurity: false") &&
        browserTabs.includes("isBrowserDevToolsShortcut(input)") &&
        browserDevToolsShortcut.includes('input.key.toLowerCase() === "f12"'),
      "production Browser code must not expose remote debugging, global certificate bypass, or weaken the main Renderer",
    ],
    [
      browserIdentity.includes("Emulation.setUserAgentOverride") &&
        !/Object\.defineProperty\s*\(\s*navigator|navigator\.__defineGetter__|Page\.addScriptToEvaluateOnNewDocument/.test(
          browserIdentity,
        ) &&
        browserNetwork.includes("applyIdentityHeaders"),
      "Browser identity must use Chromium/CDP and coherent network headers without JavaScript navigator patches",
    ],
    [
      browserTools.includes('browser_inspect: "read"') &&
        browserInspectRpc.includes("sinceInspectionId?: string") &&
        browserInspectRpc.includes("screenshot?:") &&
        !/(?:source|selector|console|networkBody|cookie|header|action)\s*\??:/i.test(browserInspectRpc) &&
        browserInspectionStore.includes("contentHash: string") &&
        browserInspectionStore.includes("viewportHash: string") &&
        !/\b(?:text|base64|screenshot|nodes)\s*:/.test(browserInspectionStore),
      "browser_inspect must remain a read-only bounded observation without action, advanced data, or persistent page/image content",
    ],
    [
      browserTabs.includes('from "./browser-redaction.ts"') &&
        browserConsole.includes('from "./browser-redaction.ts"') &&
        browserRecorder.includes('from "./browser-redaction.ts"') &&
        browserRedaction.includes("SENSITIVE_QUERY_KEY") &&
        browserRedaction.includes("SECRET_TEXT") &&
        browserTabs.includes("MAX_INSPECTION_SCREENSHOT_BYTES") &&
        browserTabs.includes("DEFAULT_INSPECTION_MAX_TEXT_CHARS = 8_000") &&
        browserTabs.includes("DEFAULT_INSPECTION_MAX_NODES = 100") &&
        browserTabs.includes("DEFAULT_INSPECTION_NODE_CHARS = 16_000") &&
        browserTabs.includes("input.screenshot?.enabled === true"),
      "inspection, Console, network, frame URLs, and visual results must share redaction and bounded result budgets",
    ],
    [
      browserDeniedTargetState.includes("keyHash: string") &&
        browserDeniedTargetState.includes("originHash: string") &&
        !browserDeniedTargetState.includes("origin: string") &&
        browserAgentRuntime.includes("hashRouteValue(target.origin)") &&
        browserAgentRuntime.includes("BROWSER_RETRY_BLOCKED") &&
        browserAgentRuntime.includes("BROWSER_CALL_BUDGET_EXCEEDED") &&
        browserAgentRuntime.includes("const REPLAN_CALLS = 30") &&
        browserAgentRuntime.includes("const MAX_CALLS = 60") &&
        rpcManager.includes("browserAgentRuntime.guardBash") &&
        toolchainBash.includes("await beforeExec?.(command)"),
      "Browser attempt/workflow state must remain hashed, budgeted, and enforced before Bash execution",
    ],
    [
      browserTools.includes("promptGuidelines: [...BROWSER_CANONICAL_GUIDELINES]") &&
        browserAgentRuntime.includes("Observe once with browser_inspect") &&
        browserAgentRuntime.includes("browser_network_summary before network_list/body") &&
        browserService.includes('workflowGuardScope: "obvious-workflow-bypass-only"') &&
        !/"(?:playwright|puppeteer)"\s*:/.test(packageJson),
      "Browser tools must share canonical efficiency guidance and label the workflow guard as narrower than an OS sandbox without bundling a second browser",
    ],
    [
      browserRecorder.includes("const REPLAY_TTL_MS = 10 * 60 * 1_000") &&
        browserRecorder.includes("private readonly sealed = new Map") &&
        browserRecorder.includes("this.sealed.clear()") &&
        !browserTools.includes('"browser_page_code_delete"') &&
        !browserTools.includes('"browser_page_code_set_enabled"') &&
        browserSnippets.includes("assertSnippetSafe"),
      "sealed replay data must be short-lived Main memory and Agent tools must not mutate the snippet library",
    ],
  ];
}
