import type {
  ManagedComponentId,
  PublicCapabilityState,
  PublicManagedComponentState,
  PublicToolchainOperation,
  PublicToolchainState,
  ToolCapabilityId,
  ToolHealth,
  ToolPreference,
  ToolProvider,
  ToolchainActionRequest,
  ToolchainCacheId,
} from "@shared/toolchains/types";
import { TOOL_PREFERENCES } from "@shared/toolchains/types";

export type Translate = (key: string, fallback: string) => string;

export type ToolAction = (request: ToolchainActionRequest) => void | Promise<void>;

export type ToolCategoryId = "javascript" | "python" | "cli";

export type ToolTone = "success" | "warning" | "danger";

export const TOOL_CATEGORIES: ReadonlyArray<{ id: ToolCategoryId; capabilities: readonly ToolCapabilityId[] }> = [
  { id: "javascript", capabilities: ["js.node", "js.npm", "js.npx", "js.bun"] },
  { id: "python", capabilities: ["python.interpreter", "python.uv", "python.uvx"] },
  {
    id: "cli",
    capabilities: ["shell.bash", "shell.powershell", "vcs.git", "search.rg", "search.fd", "data.jq", "network.curl"],
  },
];

export const TOOL_COUNT = TOOL_CATEGORIES.reduce((sum, category) => sum + category.capabilities.length, 0);

const CAPABILITY_COMPONENTS: Partial<Record<ToolCapabilityId, ManagedComponentId>> = {
  "js.node": "node-lts",
  "js.npm": "node-lts",
  "js.npx": "node-lts",
  "js.bun": "bun",
  "python.interpreter": "cpython",
  "python.uv": "uv",
  "python.uvx": "uv",
  "vcs.git": "portable-git",
  "search.rg": "ripgrep",
  "search.fd": "fd",
  "data.jq": "jq",
};

export const CAPABILITY_CACHES: Partial<Record<ToolCapabilityId, ToolchainCacheId>> = {
  "js.npm": "npm",
  "js.bun": "bun",
  "python.uv": "uv",
};

const CAPABILITY_LEADERS: Partial<Record<ToolCapabilityId, ToolCapabilityId>> = {
  "js.npm": "js.node",
  "js.npx": "js.node",
  "python.uvx": "python.uv",
};

export const CAPABILITY_LABELS: Record<ToolCapabilityId, string> = {
  "shell.bash": "Bash",
  "shell.powershell": "PowerShell",
  "vcs.git": "Git",
  "js.node": "Node.js",
  "js.npm": "npm",
  "js.npx": "npx",
  "js.bun": "Bun",
  "python.interpreter": "Python",
  "python.uv": "uv",
  "python.uvx": "uvx",
  "search.rg": "ripgrep",
  "search.fd": "fd",
  "data.jq": "jq",
  "network.curl": "curl",
};

export const CAPABILITY_GLYPHS: Record<ToolCapabilityId, string> = {
  "shell.bash": "sh",
  "shell.powershell": "ps",
  "vcs.git": "git",
  "js.node": "js",
  "js.npm": "npm",
  "js.npx": "npx",
  "js.bun": "bun",
  "python.interpreter": "py",
  "python.uv": "uv",
  "python.uvx": "uvx",
  "search.rg": "rg",
  "search.fd": "fd",
  "data.jq": "jq",
  "network.curl": "curl",
};

export const COMPONENT_LABELS: Record<ManagedComponentId, string> = {
  "portable-git": "PortableGit",
  "node-lts": "Node.js LTS + npm",
  cpython: "CPython",
  uv: "uv + uvx",
  ripgrep: "ripgrep",
  fd: "fd",
  jq: "jq",
  bun: "Bun",
};

export const CACHE_ORDER: readonly ToolchainCacheId[] = ["npm", "uv", "bun", "downloads"];

export function cacheLabel(cacheId: ToolchainCacheId, t: Translate): string {
  if (cacheId === "downloads") return t("toolCacheDownloads", "Downloads");
  return cacheId === "bun" ? "Bun" : cacheId;
}

export function componentFor(
  state: PublicToolchainState | null,
  capability: ToolCapabilityId,
): PublicManagedComponentState | undefined {
  const componentId = CAPABILITY_COMPONENTS[capability];
  return componentId ? state?.components[componentId] : undefined;
}

export function operationFor(
  state: PublicToolchainState | null,
  capability: ToolCapabilityId,
): PublicToolchainOperation | undefined {
  const componentId = CAPABILITY_COMPONENTS[capability];
  if (!componentId) return undefined;
  return [...(state?.operations ?? [])].reverse().find((operation) => operation.componentId === componentId);
}

export function isActiveOperation(operation: PublicToolchainOperation | undefined): boolean {
  return Boolean(operation && !["idle", "ready", "error", "cancelled"].includes(operation.phase));
}

export function isCancellable(operation: PublicToolchainOperation | undefined): boolean {
  return Boolean(
    operation && ["queued", "downloading", "verifying", "extracting", "probing"].includes(operation.phase),
  );
}

export function isOperationVisible(operation: PublicToolchainOperation | undefined): boolean {
  return Boolean(operation && (isActiveOperation(operation) || operation.phase === "error"));
}

export function isNotNeeded(capability: ToolCapabilityId, state: PublicToolchainState | null): boolean {
  return (
    capability === "shell.powershell" &&
    Boolean(state && state.platform !== "win32") &&
    state?.capabilities[capability]?.health !== "healthy"
  );
}

export function isReady(capability: ToolCapabilityId, state: PublicToolchainState | null): boolean {
  return state?.capabilities[capability]?.health === "healthy" || isNotNeeded(capability, state);
}

export function issueCapabilities(state: PublicToolchainState | null): ToolCapabilityId[] {
  if (!state) return [];
  return TOOL_CATEGORIES.flatMap((category) => category.capabilities).filter(
    (capability) => !isReady(capability, state),
  );
}

export function followedLeader(
  capability: ToolCapabilityId,
  state: PublicToolchainState | null,
): ToolCapabilityId | undefined {
  const leader = CAPABILITY_LEADERS[capability];
  if (!leader) return undefined;
  const own = state?.capabilities[capability];
  const lead = state?.capabilities[leader];
  return lead?.health === "healthy" && own?.provider === lead.provider ? leader : undefined;
}

export function healthTone(health: ToolHealth): ToolTone {
  if (health === "healthy") return "success";
  if (health === "modified" || health === "incomplete" || health === "unverified") return "warning";
  return "danger";
}

const TONE_COLORS: Record<ToolTone, { fill: string; text: string; border: string }> = {
  success: {
    fill: "var(--fx-status-success)",
    text: "var(--fx-status-success-text)",
    border: "var(--fx-status-success-border)",
  },
  warning: {
    fill: "var(--fx-status-warning)",
    text: "var(--fx-status-warning-text)",
    border: "var(--fx-status-warning-border)",
  },
  danger: {
    fill: "var(--fx-status-danger)",
    text: "var(--fx-status-danger-text)",
    border: "var(--fx-status-danger-border)",
  },
};

export function toneColor(tone: ToolTone): string {
  return TONE_COLORS[tone].fill;
}

export function toneTextColor(tone: ToolTone): string {
  return TONE_COLORS[tone].text;
}

export function toneBorderColor(tone: ToolTone): string {
  return TONE_COLORS[tone].border;
}

export function severityLabel(health: ToolHealth, t: Translate): string {
  if (health === "modified") return t("toolSeverityPaused", "Paused");
  if (healthTone(health) === "warning") return t("toolSeverityCheck", "Needs check");
  return t("toolSeverityUnavailable", "Unavailable");
}

export function platformName(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}

export function isPreference(provider: ToolProvider): provider is ToolProvider & ToolPreference {
  return (TOOL_PREFERENCES as readonly string[]).includes(provider);
}

export function isSelectedCandidate(
  state: PublicCapabilityState | undefined,
  candidate: PublicCapabilityState["candidates"][number],
): boolean {
  return (
    state?.health === "healthy" && candidate.provider === state.provider && candidate.pathLabel === state.pathLabel
  );
}

export function actionKey(request: ToolchainActionRequest): string {
  switch (request.action) {
    case "rescan":
      return "rescan";
    case "install-profile":
      return `profile:${request.profileId}`;
    case "install-component":
      return `component:${request.componentId}:install`;
    case "repair-component":
      return `component:${request.componentId}:repair`;
    case "cancel-component-install":
      return `component:${request.componentId}:cancel`;
    case "remove-component":
      return `component:${request.componentId}:remove`;
    case "set-preference":
      return `preference:${request.capability}`;
    case "choose-custom-tool":
      return `custom:${request.capability}`;
    case "clear-cache":
      return `cache:${request.cacheId}`;
  }
}

export function friendlyToolchainError(error: unknown, t: Translate): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = message.match(/TOOLCHAIN_[A-Z_]+/)?.[0];
  if (code) return friendlyErrorCode(code, t);
  if (/ENOENT|not found|cannot find/i.test(message)) {
    return t(
      "toolActionMissing",
      "A required developer tool is unavailable. Rescan or install the matching Essentials profile.",
    );
  }
  return t(
    "toolActionFailed",
    "The developer-tool action failed. Existing tools were not changed; try again or open logs.",
  );
}

export function friendlyErrorCode(code: string, t: Translate): string {
  if (code === "TOOLCHAIN_DOWNLOAD_OFFLINE")
    return t("toolErrorOffline", "The official download source is unreachable. Check the network and retry.");
  if (code === "TOOLCHAIN_DOWNLOAD_REJECTED")
    return t(
      "toolErrorDownloadRejected",
      "The official download request or redirect was rejected. Retry, then open logs if it continues.",
    );
  if (code === "TOOLCHAIN_INTEGRITY_FAILED")
    return t("toolErrorIntegrity", "The downloaded file failed integrity verification and was discarded.");
  if (code === "TOOLCHAIN_EXTRACTION_FAILED")
    return t("toolErrorExtraction", "The verified archive could not be safely extracted.");
  if (code === "TOOLCHAIN_INSTALL_BUSY")
    return t(
      "toolErrorBusy",
      "This component is being installed or may still be used by a running Agent command. Retry when it is idle.",
    );
  if (code === "TOOLCHAIN_PERMISSION_DENIED")
    return t("toolErrorPermission", "Pi Desktop cannot write or execute its private tool directory.");
  if (code === "TOOLCHAIN_UNSUPPORTED")
    return t("toolErrorUnsupported", "This managed tool is not available for the current platform and architecture.");
  if (code === "TOOLCHAIN_MODIFIED")
    return t("toolErrorModified", "The managed runtime was modified; repair it before use.");
  if (code === "TOOLCHAIN_INVALID_SELECTION")
    return t("toolErrorInvalidSelection", "The selected executable did not provide the requested healthy tool.");
  if (code === "TOOLCHAIN_BROKEN")
    return t("toolErrorBroken", "The downloaded tool could not pass its startup verification.");
  if (code === "TOOLCHAIN_INVALID_CATALOG")
    return t("toolErrorCatalog", "This application build does not contain a valid catalog entry for the tool.");
  if (code.endsWith("_REQUIRED") || code === "TOOLCHAIN_CAPABILITY_REQUIRED") {
    return t(
      "toolErrorRequired",
      "A required developer tool is unavailable. Rescan or install the matching Essentials profile.",
    );
  }
  return t(
    "toolActionFailed",
    "The developer-tool action failed. Existing tools were not changed; try again or open logs.",
  );
}

export function formatBytes(bytes: number | undefined, t: Translate): string {
  if (bytes === undefined) return t("toolSizeUnknown", "Unknown");
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** unit;
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")} ${units[unit]}`;
}

export function operationPhase(phase: PublicToolchainOperation["phase"], t: Translate): string {
  const labels: Record<PublicToolchainOperation["phase"], string> = {
    idle: t("toolPhaseIdle", "Idle"),
    queued: t("toolPhaseQueued", "Queued"),
    downloading: t("toolPhaseDownloading", "Downloading"),
    verifying: t("toolPhaseVerifying", "Verifying"),
    extracting: t("toolPhaseExtracting", "Extracting"),
    probing: t("toolPhaseProbing", "Testing"),
    activating: t("toolPhaseActivating", "Activating"),
    ready: t("toolPhaseReady", "Ready"),
    error: t("toolPhaseError", "Failed"),
    cancelled: t("toolPhaseCancelled", "Cancelled"),
  };
  return labels[phase];
}

export function preferenceLabel(preference: ToolPreference, t: Translate): string {
  const labels: Record<ToolPreference, string> = {
    auto: t("toolPreferenceAuto", "Auto"),
    system: t("toolPreferenceSystem", "System"),
    bundled: t("toolPreferenceBundled", "Bundled"),
    managed: t("toolPreferenceManaged", "Managed by Dexon"),
    custom: t("toolPreferenceCustom", "Custom"),
  };
  return labels[preference];
}

export function providerLabel(provider: ToolProvider, t: Translate): string {
  const labels: Record<ToolProvider, string> = {
    project: t("toolProviderProject", "Project"),
    custom: t("toolProviderCustom", "Custom"),
    system: t("toolProviderSystem", "System"),
    bundled: t("toolProviderBundled", "Bundled"),
    managed: t("toolProviderManaged", "Managed by Dexon"),
    "legacy-upstream-managed": t("toolProviderLegacy", "Legacy"),
  };
  return labels[provider];
}

export function healthLabel(health: ToolHealth, t: Translate): string {
  const labels: Record<ToolHealth, string> = {
    healthy: t("toolHealthHealthy", "Ready"),
    missing: t("toolHealthMissing", "Missing"),
    incomplete: t("toolHealthIncomplete", "Incomplete"),
    unsupported: t("toolHealthUnsupported", "Unsupported"),
    unverified: t("toolHealthUnverified", "Unverified"),
    broken: t("toolHealthBroken", "Broken"),
    modified: t("toolHealthModified", "Modified"),
    "blocked-by-trust": t("toolHealthBlockedByTrust", "Trust required"),
  };
  return labels[health];
}
