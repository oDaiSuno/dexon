import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import {
  SessionManager,
  parseSessionEntries,
  type FileEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";

const defaultSessionManagerOpen = SessionManager.open;

const READ_WINDOW_BYTES = 512 * 1024;
const HEADER_WINDOW_BYTES = 64 * 1024;
const PARSE_SLICE_MS = 8;

export async function readSessionFileEntries(
  filePath: string,
  options: { maxBytes?: number } = {},
): Promise<FileEntry[]> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(READ_WINDOW_BYTES);
    const decoder = new StringDecoder("utf8");
    const entries: FileEntry[] = [];
    let pending = "";
    let remaining = options.maxBytes ?? Infinity;
    let sliceStarted = performance.now();
    for (;;) {
      const length = Math.min(buffer.length, remaining);
      const { bytesRead } = length ? await handle.read(buffer, 0, length, null) : { bytesRead: 0 };
      remaining -= bytesRead;
      pending += bytesRead ? decoder.write(buffer.subarray(0, bytesRead)) : decoder.end();
      let start = 0;
      let end = pending.indexOf("\n", start);
      while (end !== -1) {
        for (const entry of parseSessionEntries(pending.slice(start, end))) if (entry) entries.push(entry);
        start = end + 1;
        if (performance.now() - sliceStarted >= PARSE_SLICE_MS) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          sliceStarted = performance.now();
        }
        end = pending.indexOf("\n", start);
      }
      pending = pending.slice(start);
      if (!bytesRead) break;
    }
    if (options.maxBytes === undefined) {
      for (const entry of parseSessionEntries(pending)) if (entry) entries.push(entry);
    }
    normalizeLegacyEntries(entries);
    return entries;
  } finally {
    await handle.close();
  }
}

export async function readSessionHeader(filePath: string): Promise<SessionHeader | null> {
  if (SessionManager.open !== defaultSessionManagerOpen) return SessionManager.open(filePath).getHeader();
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(HEADER_WINDOW_BYTES);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      length += bytesRead;
      const newline = buffer.indexOf(10, 0);
      if (newline >= 0 && newline < length) {
        const header = parseSessionEntries(buffer.subarray(0, newline).toString("utf8"))[0];
        return header?.type === "session" ? header : null;
      }
      if (!bytesRead) {
        const header = parseSessionEntries(buffer.subarray(0, length).toString("utf8"))[0];
        return header?.type === "session" ? header : null;
      }
    }
    throw new Error("Session header exceeds the 64 KiB read limit");
  } finally {
    await handle.close();
  }
}

function normalizeLegacyEntries(entries: FileEntry[]): void {
  const header = entries.find((entry) => entry.type === "session");
  const legacy = (header?.version ?? 1) < 2;
  if (!legacy && entries.every((entry) => entry.id)) return;
  const ids = new Set(entries.filter((entry) => entry.type !== "session" && entry.id).map((entry) => entry.id));
  let previousId: string | null = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.type === "session") continue;
    if (!entry.id) {
      let salt = 0;
      do {
        entry.id = createHash("sha256")
          .update(`${header?.id ?? ""}:${index}:${salt++}`)
          .digest("hex")
          .slice(0, 8);
      } while (ids.has(entry.id));
      ids.add(entry.id);
    }
    if (legacy || entry.parentId === undefined) entry.parentId = previousId;
    previousId = entry.id;
    if (entry.type === "compaction" && "firstKeptEntryIndex" in entry) {
      const target = entries[entry.firstKeptEntryIndex as number];
      if (target && target.type !== "session") entry.firstKeptEntryId = target.id;
      delete entry.firstKeptEntryIndex;
    }
  }
  if (legacy && header) header.version = 2;
}

export async function readSessionManager(filePath: string): Promise<SessionManager> {
  if (SessionManager.open !== defaultSessionManagerOpen) return SessionManager.open(filePath);
  const { size } = await fs.stat(filePath);
  const entries = await readSessionFileEntries(filePath, { maxBytes: size });
  if (!entries.some((entry) => entry.type === "session")) throw new Error("Invalid session header");
  return SessionManager.inMemory(undefined, undefined, entries);
}

export async function appendSessionName(filePath: string, manager: SessionManager, name: string): Promise<void> {
  const id = manager.appendSessionInfo(name);
  if (!manager.isPersisted()) await fs.appendFile(filePath, `${JSON.stringify(manager.getEntry(id))}\n`);
}
