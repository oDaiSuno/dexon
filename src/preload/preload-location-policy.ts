import { DEFAULT_DEV_RENDERER_PORT, isDevRendererOrigin } from "../shared/dev-renderer-origin.ts";

export function isTrustedPreloadLocation(rawUrl: string, devPort = DEFAULT_DEV_RENDERER_PORT): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "app:") return url.hostname === "bundle";
    return isDevRendererOrigin(url, devPort);
  } catch {
    return false;
  }
}
