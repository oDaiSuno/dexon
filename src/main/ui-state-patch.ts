import type { DesktopUiStatePatch } from "../contract/desktop";
import { isChatAppearancePreferences } from "../shared/chat-appearance.ts";
import { isSessionOrchestrationSettings } from "../shared/session-orchestration.ts";
import path from "node:path";

const RENDERER_WRITABLE_UI_STATE_FIELDS = new Set([
  "backgroundMode",
  "managedProcessesEnabled",
  "sessionOrchestration",
  "chatAppearance",
  "lastSpaceCwd",
  "openProjects",
]);

const MAX_OPEN_PROJECTS = 200;

export function validateDesktopUiStatePatch(value: unknown): DesktopUiStatePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid UI state patch");
  const patch = value as Record<string, unknown>;
  if (Object.keys(patch).some((key) => !RENDERER_WRITABLE_UI_STATE_FIELDS.has(key))) {
    throw new Error("Unsupported UI state field");
  }

  const validated: DesktopUiStatePatch = {};
  if ("backgroundMode" in patch) {
    if (typeof patch.backgroundMode !== "boolean") throw new Error("Background mode must be a boolean");
    validated.backgroundMode = patch.backgroundMode;
  }
  if ("managedProcessesEnabled" in patch) {
    if (typeof patch.managedProcessesEnabled !== "boolean") {
      throw new Error("Managed processes setting must be a boolean");
    }
    validated.managedProcessesEnabled = patch.managedProcessesEnabled;
  }
  if ("sessionOrchestration" in patch) {
    if (!isSessionOrchestrationSettings(patch.sessionOrchestration)) {
      throw new Error("Invalid session collaboration settings");
    }
    validated.sessionOrchestration = patch.sessionOrchestration;
  }
  if ("chatAppearance" in patch) {
    if (!isChatAppearancePreferences(patch.chatAppearance)) throw new Error("Invalid chat appearance preferences");
    validated.chatAppearance = patch.chatAppearance;
  }
  if ("lastSpaceCwd" in patch) {
    const value = patch.lastSpaceCwd;
    if (value !== null) {
      if (
        typeof value !== "string" ||
        !value ||
        value.length > 4096 ||
        /[\0\r\n]/.test(value) ||
        !path.isAbsolute(value)
      ) {
        throw new Error("Last space must be an absolute directory path");
      }
    }
    validated.lastSpaceCwd = value;
  }
  if ("openProjects" in patch) {
    validated.openProjects = validateOpenProjects(patch.openProjects);
  }
  return validated;
}

function validateOpenProjects(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Open projects must be a list of folders");
  if (value.length > MAX_OPEN_PROJECTS) throw new Error("Open projects cannot hold more than 200 folders");
  const seen = new Set<string>();
  return value.map((entry) => {
    if (
      typeof entry !== "string" ||
      !entry ||
      entry.length > 4096 ||
      /[\0\r\n]/.test(entry) ||
      !path.isAbsolute(entry)
    ) {
      throw new Error("Open projects must be absolute folder paths");
    }
    if (seen.has(entry)) throw new Error("Open projects must not repeat a folder");
    seen.add(entry);
    return entry;
  });
}
