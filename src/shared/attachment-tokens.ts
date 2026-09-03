/**
 * In-sentence attachment token grammar shared by the composer, the transcript
 * renderer and tests.
 *
 * An attachment is a literal `@path` reference in the message text — the same
 * shape the `@` autocomplete (AtMenu) has always produced. Every entry point
 * (paste, plus-menu, drag-drop, programmatic handle) inserts this token; the
 * model reads the referenced file itself through the `read` tool, mirroring
 * pi CLI's interactive semantics where a pasted file path is plain text.
 */

export interface AttachmentToken {
  /** Index of the leading "@" in the value. */
  start: number;
  /** Exclusive end of the raw token text in the value (quotes included, trailing space excluded). */
  end: number;
  /** The referenced path (quote-wrapped tokens are unescaped here). */
  path: string;
  quoted: boolean;
}

/** Matches a quoted @token: start-of-line or whitespace, then @"…" with no line breaks. */
const QUOTED_TOKEN_SCAN = /(^|\s)@"([^"\n]*)"/g;
/** Matches an unquoted @word: start-of-line or whitespace, then non-space non-quote chars. */
const PLAIN_TOKEN_SCAN = /(^|\s)@([^\s"]+)/g;

/**
 * Unquoted @words only count as attachment tokens when they look like paths.
 * Without this, plain "@mention hi" prose would render as file chips.
 */
export function looksLikePath(word: string): boolean {
  if (word.includes("/") || word.includes("\\") || word.startsWith("~")) return true;
  return /\.[A-Za-z0-9]{1,12}$/.test(word);
}

/** Parse all attachment tokens in a message value, in document order. */
export function findAttachmentTokens(value: string): AttachmentToken[] {
  const tokens: AttachmentToken[] = [];
  for (const match of value.matchAll(QUOTED_TOKEN_SCAN)) {
    const start = match.index + match[1].length;
    tokens.push({ start, end: start + match[2].length + 3, path: match[2], quoted: true });
  }
  for (const match of value.matchAll(PLAIN_TOKEN_SCAN)) {
    const word = match[2];
    if (!looksLikePath(word)) continue;
    const start = match.index + match[1].length;
    tokens.push({ start, end: start + word.length + 1, path: word, quoted: false });
  }
  tokens.sort((a, b) => a.start - b.start);
  return tokens;
}

/**
 * Insert a closed attachment token at the caret (or at the end when no caret
 * is available). Quoting follows buildAtInsertText: paths containing spaces
 * get wrapped in quotes.
 */
export function insertAttachmentToken(
  value: string,
  caret: number | null,
  path: string,
): { value: string; caret: number } {
  const at = caret ?? value.length;
  const needsQuotes = path.includes(" ");
  const body = needsQuotes ? `"${path}"` : path;
  // The token grammar requires "@" to start a line or follow whitespace; keep
  // tokens separated from preceding prose so parsing stays unambiguous.
  const glue = at > 0 && !/\s/.test(value[at - 1] ?? "") ? " " : "";
  const text = `${glue}@${body} `;
  return { value: value.slice(0, at) + text + value.slice(at), caret: at + text.length };
}

/**
 * Remove a token and one adjacent trailing space (the separator inserted with
 * it). Returns the new value and the caret position for re-focusing.
 */
export function removeAttachmentToken(
  value: string,
  token: Pick<AttachmentToken, "start" | "end">,
): { value: string; caret: number } {
  let end = token.end;
  if (value[end] === " ") end += 1;
  return { value: value.slice(0, token.start) + value.slice(end), caret: token.start };
}

/**
 * Backspace semantics for token ends: when the caret sits directly after a
 * token (optionally after its trailing separator space), delete the whole
 * token at once. Returns null when the caret is not at a token end so the
 * default single-character delete applies.
 */
export function backspaceAtTokenEnd(
  value: string,
  caret: number,
  tokens: readonly AttachmentToken[],
): { value: string; caret: number } | null {
  if (caret <= 0) return null;
  for (const token of tokens) {
    if (token.end === caret) return removeAttachmentToken(value, token);
    if (token.end === caret - 1 && value[caret - 1] === " ") {
      return removeAttachmentToken(value, token);
    }
  }
  return null;
}

export type AttachmentSegment = { type: "text"; text: string } | { type: "token"; token: AttachmentToken };

/** Split a message into text and token segments for mixed rendering. */
export function segmentByAttachmentTokens(value: string): AttachmentSegment[] {
  const tokens = findAttachmentTokens(value);
  if (tokens.length === 0) return [{ type: "text", text: value }];
  const segments: AttachmentSegment[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) segments.push({ type: "text", text: value.slice(cursor, token.start) });
    segments.push({ type: "token", token });
    cursor = token.end;
  }
  if (cursor < value.length) segments.push({ type: "text", text: value.slice(cursor) });
  return segments;
}

/**
 * The literal text a token chip serializes to (and is parsed back from).
 * Paths containing whitespace are quote-wrapped; a trailing separator space is
 * added by the editor, not by this function.
 */
export function attachmentTokenText(path: string): string {
  return path.includes(" ") ? `@"${path}"` : `@${path}`;
}

/** Basename for chip display; keeps a short trailing slash marker for directories. */
export function attachmentTokenName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return base || path;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "heic", "heif"]);

export function isImagePath(path: string): boolean {
  const base = attachmentTokenName(path);
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return base.includes(".") && IMAGE_EXTENSIONS.has(ext);
}
