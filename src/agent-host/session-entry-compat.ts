/**
 * Backward compatibility for session entries written by the upstream
 * Pi Agent Desktop. Dexon shares the ~/.pi/agent data directory, so sessions
 * created before the rename still carry the old "pi-desktop-*" customType
 * markers.
 *
 * Read paths accept both spellings; every write uses the Dexon spelling.
 * This file is the only place where the legacy spellings may appear.
 */

export const CHANNEL_SOURCE_TYPE = "dexon-channel-source";
export const CHANNEL_SOURCE_CANCELLED_TYPE = "dexon-channel-source-cancelled";
export const CHANNEL_ATTACHMENT_CONTEXT_TYPE = "dexon-channel-attachment-context";
export const SESSION_TOOLS_TYPE = "dexon-session-tools";

const LEGACY_CHANNEL_SOURCE_TYPE = "pi-desktop-channel-source";
const LEGACY_CHANNEL_SOURCE_CANCELLED_TYPE = "pi-desktop-channel-source-cancelled";
const LEGACY_CHANNEL_ATTACHMENT_CONTEXT_TYPE = "pi-desktop-channel-attachment-context";
const LEGACY_SESSION_TOOLS_TYPE = "pi-desktop-session-tools";

export function isChannelSourceType(customType: string): boolean {
  return customType === CHANNEL_SOURCE_TYPE || customType === LEGACY_CHANNEL_SOURCE_TYPE;
}

export function isChannelSourceCancelledType(customType: string): boolean {
  return customType === CHANNEL_SOURCE_CANCELLED_TYPE || customType === LEGACY_CHANNEL_SOURCE_CANCELLED_TYPE;
}

export function isChannelAttachmentContextType(customType: string): boolean {
  return customType === CHANNEL_ATTACHMENT_CONTEXT_TYPE || customType === LEGACY_CHANNEL_ATTACHMENT_CONTEXT_TYPE;
}

export function isSessionToolsType(customType: string): boolean {
  return customType === SESSION_TOOLS_TYPE || customType === LEGACY_SESSION_TOOLS_TYPE;
}

/** Remove toolchain summary markers (Dexon and legacy spelling) from stored system prompts. */
export function stripToolchainMarkers(text: string): string {
  return text
    .replace(/\n*<(?:dexon|pi-desktop)-toolchain revision="\d+">[\s\S]*?<\/(?:dexon|pi-desktop)-toolchain>\n*/g, "")
    .trimEnd();
}
