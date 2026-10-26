import type { BrowserSearchEngine } from "../../contract/browser-search.ts";
import { browserSearchUrl } from "../../contract/browser-search.ts";
import { BrowserError } from "./browser-error.ts";

export type BrowserNavigationSearch = { searchEngine: BrowserSearchEngine; customSearchTemplate: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function resolveBrowserAddress(value: string, search: BrowserNavigationSearch | null): string {
  if (typeof value !== "string") throw new BrowserError("INVALID_BROWSER_REQUEST", "Browser address is invalid");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 8_192 || /[\0\r\n]/.test(trimmed)) {
    throw new BrowserError("INVALID_BROWSER_REQUEST", "Browser address is invalid");
  }
  if (SCHEME.test(trimmed)) return trimmed;
  if (search && !looksLikeAddress(trimmed)) return browserSearchUrl(search, trimmed);
  return `https://${trimmed}`;
}

function looksLikeAddress(value: string): boolean {
  if (/\s/.test(value)) return false;
  const host = (value.split(/[/?#]/)[0] ?? "").replace(/:\d+$/, "");
  if (!host) return false;
  if (/^localhost$/i.test(host) || IPV4.test(host)) return true;
  return host.includes(".") && host.split(".").every((label) => label.length > 0);
}
