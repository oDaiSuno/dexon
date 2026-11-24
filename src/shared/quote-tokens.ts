import { isValidSkillName, splitLeadingSkillCommand } from "./skill-commands.ts";

export type QuoteSourceRole = "assistant" | "user";

export interface QuoteReference {
  readonly id: string;
  readonly text: string;
  readonly from: QuoteSourceRole;
  readonly entryId?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface ParsedQuotedPrompt {
  readonly quotes: readonly QuoteReference[];
  readonly body: string;
}

export type ComposerQuoteSegment =
  { readonly type: "text"; readonly text: string } | { readonly type: "quote"; readonly quote: QuoteReference };

const COMPOSER_PREFIX = "\uE000quote:";
const COMPOSER_SUFFIX = "\uE001";

export function encodeComposerQuoteToken(quote: Omit<QuoteReference, "id"> & { id?: string }): string {
  const json = JSON.stringify({
    id: quote.id ?? "1",
    text: quote.text,
    from: quote.from,
    entryId: quote.entryId,
    prefix: quote.prefix,
    suffix: quote.suffix,
  });
  const encoded = encodeURIComponent(json).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${COMPOSER_PREFIX}${encoded}${COMPOSER_SUFFIX}`;
}

export function decodeComposerQuoteToken(token: string): QuoteReference | null {
  if (!token.startsWith(COMPOSER_PREFIX) || !token.endsWith(COMPOSER_SUFFIX)) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(token.slice(COMPOSER_PREFIX.length, -COMPOSER_SUFFIX.length)));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const quote = value as Record<string, unknown>;
    if (typeof quote.id !== "string" || typeof quote.text !== "string") return null;
    if (quote.from !== "assistant" && quote.from !== "user") return null;
    for (const key of ["entryId", "prefix", "suffix"]) {
      if (quote[key] !== undefined && typeof quote[key] !== "string") return null;
    }
    return value as QuoteReference;
  } catch {
    return null;
  }
}

export function segmentByComposerQuoteTokens(text: string): ComposerQuoteSegment[] {
  const segments: ComposerQuoteSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\uE000quote:[^\uE000\uE001]*\uE001/g)) {
    const quote = decodeComposerQuoteToken(match[0]);
    if (!quote) continue;
    if (match.index > cursor) segments.push({ type: "text", text: text.slice(cursor, match.index) });
    segments.push({ type: "quote", quote });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length || segments.length === 0) segments.push({ type: "text", text: text.slice(cursor) });
  return segments;
}

function escapeAttribute(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    '"': "&quot;",
    "<": "&lt;",
    ">": "&gt;",
    "\n": "&#10;",
    "\r": "&#13;",
  };
  return value.replace(/[&"<>\n\r]/g, (char) => entities[char]);
}

function unescapeAttribute(value: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&quot;": '"',
    "&lt;": "<",
    "&gt;": ">",
    "&#10;": "\n",
    "&#13;": "\r",
    "&apos;": "'",
  };
  return value.replace(/&(?:amp|quot|lt|gt|apos|#10|#13);/g, (entity) => entities[entity]);
}

function splitQuoteSkill(text: string): { prefix: string; body: string } {
  const typed = splitLeadingSkillCommand(text);
  if (typed) {
    const body = typed.rest.trimStart();
    return { prefix: text.slice(0, text.length - body.length), body };
  }
  const expanded = /^<skill name="([^"]+)" location="[^"]*">\n[\s\S]*?\n<\/skill>(?:\n\n|$)/.exec(text);
  if (expanded && isValidSkillName(expanded[1])) {
    return { prefix: expanded[0], body: text.slice(expanded[0].length) };
  }
  return { prefix: "", body: text };
}

interface QuoteEnvelope extends ParsedQuotedPrompt {
  readonly prefix: string;
  readonly block: string;
  readonly remainder: string;
  readonly openTags: readonly { start: number; end: number }[];
}

function readQuoteEnvelope(text: string): QuoteEnvelope | null {
  const { prefix, body } = splitQuoteSkill(text);
  const match = /^<quotes>\n([\s\S]*?)\n<\/quotes>(?=\n\n|$)/.exec(body);
  if (!match) return null;
  const quotes: QuoteReference[] = [];
  const openTags: { start: number; end: number }[] = [];
  const entries = /<quote((?:\s+[a-z]+="[^"<>]*")+)>\n([\s\S]*?)\n<\/quote>/g;
  let cursor = 0;
  for (const entry of match[1].matchAll(entries)) {
    if (entry.index !== cursor) return null;
    const attributes = new Map<string, string>();
    for (const attribute of entry[1].matchAll(/\s+([a-z]+)="([^"]*)"/g)) {
      if (attributes.has(attribute[1])) return null;
      attributes.set(attribute[1], unescapeAttribute(attribute[2]));
    }
    const id = attributes.get("id");
    const from = attributes.get("from");
    if (!id || !/^[1-9]\d*$/.test(id) || quotes.some((quote) => quote.id === id)) return null;
    if (from !== "assistant" && from !== "user") return null;
    quotes.push({
      id,
      from,
      text: entry[2].replace(/<(\\+)\/quote/g, (_match, slashes: string) => `<${slashes.slice(1)}/quote`),
      ...(attributes.has("entry") ? { entryId: attributes.get("entry") } : {}),
      ...(attributes.has("pre") ? { prefix: attributes.get("pre") } : {}),
      ...(attributes.has("suf") ? { suffix: attributes.get("suf") } : {}),
    });
    const start = "<quotes>\n".length + entry.index;
    openTags.push({ start, end: start + "<quote".length + entry[1].length + 1 });
    cursor = entry.index + entry[0].length;
    if (match[1][cursor] === "\n") cursor += 1;
  }
  if (quotes.length === 0 || cursor !== match[1].length) return null;
  const remainder = body.slice(match[0].length);
  return { prefix, quotes, body: remainder.slice(2), block: match[0], remainder, openTags };
}

export function serializeComposerQuotesForSend(text: string): string {
  const skill = splitQuoteSkill(text);
  const segments = segmentByComposerQuoteTokens(skill.body);
  const quotes: QuoteReference[] = [];
  const body = segments
    .map((segment) => {
      if (segment.type === "text") return segment.text;
      const id = String(quotes.length + 1);
      quotes.push({ ...segment.quote, id });
      return `[quote:${id}]`;
    })
    .join("");
  if (quotes.length === 0) return text;
  const entries = quotes.map((quote) => {
    const attributes = [
      ["id", quote.id],
      ["from", quote.from],
      ["entry", quote.entryId],
      ["pre", quote.prefix],
      ["suf", quote.suffix],
    ];
    const open = attributes
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
      .join(" ");
    const escaped = quote.text.replace(/<(\\*)\/quote/g, (_match, slashes: string) => `<\\${slashes}/quote`);
    return `<quote ${open}>\n${escaped}\n</quote>`;
  });
  const onlyQuotes = segments.every((segment) => segment.type === "quote" || !segment.text.trim());
  const prose = onlyQuotes ? quotes.map((quote) => `[quote:${quote.id}]`).join(" ") : body;
  const typed = splitLeadingSkillCommand(text);
  const prefix = typed ? `${text.slice(0, text.length - typed.rest.length)} ` : skill.prefix;
  return `${prefix}<quotes>\n${entries.join("\n")}\n</quotes>\n\n${prose}`;
}

export function parseQuotedPrompt(text: string): ParsedQuotedPrompt {
  const envelope = readQuoteEnvelope(text);
  return envelope ? { quotes: envelope.quotes, body: envelope.body } : { quotes: [], body: text };
}

export function expandQuotedPromptToComposerText(text: string): string {
  const envelope = readQuoteEnvelope(text);
  if (!envelope) return text;
  const byId = new Map(envelope.quotes.map((quote) => [quote.id, quote]));
  const used = new Set<string>();
  const body = envelope.body.replace(/\[quote:([1-9]\d*)\]/g, (raw, id: string) => {
    const quote = byId.get(id);
    if (!quote) return raw;
    used.add(id);
    return encodeComposerQuoteToken(quote);
  });
  const unused = envelope.quotes.filter((quote) => !used.has(quote.id)).map(encodeComposerQuoteToken);
  return envelope.prefix + [...unused, body].filter(Boolean).join(" ");
}

export function stripQuoteCoordinates(text: string): string {
  const envelope = readQuoteEnvelope(text);
  if (!envelope) return text;
  let block = "";
  let cursor = 0;
  for (const tag of envelope.openTags) {
    block += envelope.block.slice(cursor, tag.start);
    block += envelope.block.slice(tag.start, tag.end).replace(/\s+(?:entry|pre|suf)="[^"]*"/g, "");
    cursor = tag.end;
  }
  block += envelope.block.slice(cursor);
  return block === envelope.block ? text : envelope.prefix + block + envelope.remainder;
}

export function stripQuoteCoordinatesFromMessages<T extends { role?: string; content?: unknown }>(
  messages: readonly T[],
): T[] {
  let changed = false;
  const result = messages.map((message) => {
    if (message.role !== "user") return message;
    if (typeof message.content === "string") {
      const content = stripQuoteCoordinates(message.content);
      if (content === message.content) return message;
      changed = true;
      return { ...message, content };
    }
    if (!Array.isArray(message.content)) return message;
    let contentChanged = false;
    const content = message.content.map((block: unknown) => {
      if (!block || typeof block !== "object") return block;
      const part = block as { type?: unknown; text?: unknown };
      if (part.type !== "text" || typeof part.text !== "string") return block;
      const text = stripQuoteCoordinates(part.text);
      if (text === part.text) return block;
      contentChanged = true;
      return { ...block, text };
    });
    if (!contentChanged) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? result : (messages as T[]);
}

export function quoteSnippet(text: string, maxChars = 28): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = [...clean];
  const limit = Math.max(0, Math.floor(maxChars));
  if (chars.length <= limit) return clean;
  return limit === 0
    ? ""
    : `${chars
        .slice(0, limit - 1)
        .join("")
        .trimEnd()}…`;
}

function readableSkillPrefix(prefix: string): string {
  const expanded = /^<skill name="([^"]+)"/.exec(prefix);
  return expanded ? `/skill:${expanded[1]} ` : prefix;
}

export function formatQuotedPromptForCopy(text: string): string {
  const envelope = readQuoteEnvelope(serializeComposerQuotesForSend(text));
  if (!envelope) return text;
  const byId = new Map(envelope.quotes.map((quote) => [quote.id, quote]));
  const used = new Set<string>();
  const onlyQuote = /^\s*\[quote:([1-9]\d*)\]\s*$/.exec(envelope.body);
  const prose = onlyQuote ? envelope.body.trim() : envelope.body;
  const body = prose.replace(/\[quote:([1-9]\d*)\]/g, (raw, id: string) => {
    const quote = byId.get(id);
    if (!quote) return raw;
    used.add(id);
    return onlyQuote ? quote.text : `「${quote.text}」`;
  });
  const unused = envelope.quotes
    .filter((quote) => !used.has(quote.id))
    .map((quote) =>
      quote.text
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n"),
    );
  return readableSkillPrefix(envelope.prefix) + [...unused, body].filter(Boolean).join("\n\n");
}

export function quoteTitleText(text: string): string {
  const envelope = readQuoteEnvelope(text);
  const skill = splitQuoteSkill(text);
  const segments = segmentByComposerQuoteTokens(envelope?.body ?? skill.body);
  const firstQuote = envelope?.quotes[0] ?? segments.find((segment) => segment.type === "quote")?.quote;
  const body = segments
    .map((segment) => (segment.type === "text" ? segment.text : " "))
    .join("")
    .replace(/\[quote:[1-9]\d*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = body || (firstQuote ? quoteSnippet(firstQuote.text, 60) : "");
  return (readableSkillPrefix(envelope?.prefix ?? skill.prefix) + title).trim();
}
