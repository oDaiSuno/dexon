export const APP_WEBSITE_URL = "https://dexon.app";
export const APP_DOCS_URL = "https://dexon.app/docs";
export const APP_REPOSITORY_URL = "https://github.com/oDaiSuno/dexon";
export const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues`;

export function appReleaseUrl(version: string): string {
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `${APP_REPOSITORY_URL}/releases/tag/${encodeURIComponent(tag)}`;
}
