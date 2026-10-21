import { DEFAULT_DEV_RENDERER_PORT, isDevRendererOrigin } from "../shared/dev-renderer-origin.ts";

export function isAllowedMainNavigation(rawUrl: string, isDev: boolean, devPort = DEFAULT_DEV_RENDERER_PORT): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "app:") return true;
    return isDev && isDevRendererOrigin(url, devPort);
  } catch {
    return false;
  }
}
