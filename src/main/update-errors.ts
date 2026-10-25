import type { UpdateErrorCode } from "../contract/desktop";

const MAX_ERROR_DETAIL_LENGTH = 800;

export type UpdateOperation = "check" | "download" | "install";

export class UpdateManagerError extends Error {
  readonly code: UpdateErrorCode;

  constructor(code: UpdateErrorCode, message: string) {
    super(message);
    this.name = "UpdateManagerError";
    this.code = code;
  }
}

export const ERROR_MESSAGES: Record<UpdateErrorCode, string> = {
  UPDATE_OFFLINE: "Unable to reach the update service. Check your network and try again.",
  UPDATE_NOT_PUBLISHED: "The update is not available yet. It may still be under release review.",
  UPDATE_METADATA_INVALID: "The update information is invalid or incomplete. The current version was not changed.",
  UPDATE_SIGNATURE_INVALID: "Update signature verification failed. Installation was stopped.",
  UPDATE_DOWNLOAD_FAILED: "The update could not be downloaded. You can keep using this version and retry.",
  UPDATE_BUSY: "Another update operation is already in progress.",
  UPDATE_INVALID_STATE: "The update action is not available in the current state.",
  UPDATE_UNSUPPORTED: "Automatic updates are not supported in this build or on this platform.",
  UPDATE_UNKNOWN: "The update operation failed. You can keep using the current version and retry.",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactUpdateError(value: unknown): string {
  let text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);

  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    text = text.replace(new RegExp(escapeRegExp(home), "gi"), "[LOCAL_PATH]");
  }

  text = text
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[AUTH_REDACTED]")
    .replace(/\b(?:gh[opusr]_)[A-Za-z0-9_]{12,}\b/gi, "[TOKEN_REDACTED]")
    .replace(
      /\b(authorization|proxy-authorization|token|password|secret|api[-_]?key)\b\s*[:=]\s*["']?[^\s,"'}]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/([?&](?:access_token|auth|key|password|secret|token)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?/gi, "[LOCAL_PATH]")
    .replace(/\/(?:Users|home)\/[^/\s"']+(?:\/[^\s"']*)?/g, "[LOCAL_PATH]")
    .replace(/\/(?:private\/)?var\/folders\/[^\s"']+/g, "[CACHE_PATH]")
    .replace(/\/tmp\/[^\s"']+/g, "[CACHE_PATH]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL_REDACTED]")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > MAX_ERROR_DETAIL_LENGTH) {
    return `${text.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`;
  }
  return text || "No error detail was provided";
}

export function classifyUpdateError(error: unknown, context?: UpdateOperation): UpdateErrorCode {
  if (error instanceof UpdateManagerError) return error.code;
  const errorCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  const text =
    `${errorCode} ${error instanceof Error ? `${error.name} ${error.message}` : String(error)}`.toLowerCase();

  if (/signature|code signing|publisher|not trusted|err_updater_invalid_signature/.test(text)) {
    return "UPDATE_SIGNATURE_INVALID";
  }
  if (
    /enetunreach|enotfound|eai_again|econnreset|econnrefused|etimedout|err_name_not_resolved|err_internet_disconnected|err_connection_reset|network|offline|internet disconnected/.test(
      text,
    )
  ) {
    return "UPDATE_OFFLINE";
  }
  if (/\b404\b|not found|no published (?:release|version)|latest(?:-mac)?\.yml.*missing/.test(text)) {
    return "UPDATE_NOT_PUBLISHED";
  }
  if (/yaml|metadata|sha-?512|checksum|parse|semver|invalid version|update info|latest(?:-mac)?\.yml/.test(text)) {
    return "UPDATE_METADATA_INVALID";
  }
  if (context === "download" || /download|blockmap/.test(text)) {
    return "UPDATE_DOWNLOAD_FAILED";
  }
  return "UPDATE_UNKNOWN";
}
