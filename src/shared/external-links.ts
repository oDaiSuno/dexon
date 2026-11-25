const MAX_EXTERNAL_URL_LENGTH = 8_192;

export function normalizeExternalHref(href: string | undefined): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.length > MAX_EXTERNAL_URL_LENGTH || /[\0\r\n]/.test(trimmed)) return null;
  if (!/^(?:https?:\/\/|mailto:)/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname ? trimmed : null;
    }
    if (parsed.protocol === "mailto:") {
      return parsed.pathname.trim().length > 0 ? trimmed : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function isExternalHttpHref(href: string | undefined): boolean {
  const normalized = normalizeExternalHref(href);
  return normalized !== null && /^https?:\/\//i.test(normalized);
}
