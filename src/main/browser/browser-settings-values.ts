import { isBrowserSearchTemplate } from "../../contract/browser-search.ts";

export function expectString(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

export function expectSafeSingleLine(value: unknown, maxLength: number, label: string, allowEmpty = false): string {
  if (allowEmpty && value === "") return "";
  const stringValue = expectString(value, maxLength, label);
  if (/[\r\n]/.test(stringValue)) throw new Error(`${label} must be a single line`);
  return stringValue;
}

export function validateHomepage(value: string): string {
  if (value === "about:blank") return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("navigation.homepage must be an absolute URL or about:blank");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("navigation.homepage uses an unsupported protocol");
  }
  if (url.username || url.password) throw new Error("navigation.homepage must not contain credentials");
  return url.toString();
}

export function validateDomains(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("advancedBrowserMode.certificateBypassDomains is invalid");
  }
  const domains = value.map((domain) =>
    expectSafeSingleLine(domain, 253, "advancedBrowserMode.certificateBypassDomains[]"),
  );
  if (
    domains.some(
      (domain) =>
        domain.startsWith(".") ||
        domain.endsWith(".") ||
        !domain
          .toLowerCase()
          .split(".")
          .every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)),
    )
  ) {
    throw new Error("advancedBrowserMode.certificateBypassDomains contains an invalid hostname");
  }
  return [...new Set(domains.map((domain) => domain.toLowerCase()))].sort();
}

export function validateSearchTemplate(value: unknown): string {
  if (value === "") return "";
  if (typeof value !== "string" || !isBrowserSearchTemplate(value)) {
    throw new Error("navigation.customSearchTemplate must be an https address containing {query}");
  }
  return value;
}
