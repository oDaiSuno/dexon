import fs from "node:fs/promises";
import { mkdirSync, readFileSync, truncateSync } from "node:fs";
import path from "node:path";
import {
  isMissingFile,
  normalizePersistedRecord,
  parseLegacyCache,
  toPersistedRecord,
  type PersistedIndexRecord,
} from "./session-index-cache";

export const JOURNAL_FILE = "session-index.v2.jsonl";
const LEGACY_CACHE_FILE = "session-index-cache.json";
const CHUNK_RECORDS = 256;
const COMPACT_RATIO = 2;
const COMPACT_SLACK = 1024;
const HEADER = '{"v":2}\n';

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function applyLine(records: Map<string, PersistedIndexRecord>, line: string): void {
  let value: { op?: unknown; r?: unknown; p?: unknown };
  try {
    value = JSON.parse(line) as { op?: unknown; r?: unknown; p?: unknown };
  } catch {
    return;
  }
  if (value.op === "del" && typeof value.p === "string") {
    records.delete(value.p);
    return;
  }
  const record = value.op === "put" ? normalizePersistedRecord("", value.r) : undefined;
  if (record) records.set(record.filePath, record);
}

export class SessionIndexJournal {
  private tail: Promise<void> = Promise.resolve();
  private lines = 0;
  private compacting = false;
  private failure: unknown;
  hasSnapshot = false;
  private readonly filePath: string;

  constructor(private readonly directory: string) {
    this.filePath = path.join(directory, JOURNAL_FILE);
  }

  load(): Promise<PersistedIndexRecord[]> {
    return this.enqueue(() => this.readSnapshot());
  }

  private async readSnapshot(): Promise<PersistedIndexRecord[]> {
    const text = await readOptional(this.filePath);
    if (text !== null) {
      try {
        const replay = this.replay(text);
        let step = replay.next();
        while (!step.done) {
          await yieldToEventLoop();
          step = replay.next();
        }
        if (!text.endsWith("\n")) await fs.truncate(this.filePath, this.completeBytes(text));
        return step.value;
      } catch (error) {
        console.error("[agent-host] session index journal is unreadable; rebuilding:", error);
        this.hasSnapshot = false;
        this.lines = 0;
        await this.writeSnapshot([]);
        return [];
      }
    }
    const legacy = await readOptional(path.join(this.directory, LEGACY_CACHE_FILE));
    let records: PersistedIndexRecord[] = [];
    let legacyValid = false;
    if (legacy !== null) {
      try {
        records = parseLegacyCache(legacy);
        legacyValid = true;
      } catch (error) {
        console.error("[agent-host] legacy session index cache is invalid; ignoring:", error);
      }
    }
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.writeSnapshot(records);
    this.lines = records.length;
    this.hasSnapshot = legacyValid;
    return records;
  }

  loadSync(): PersistedIndexRecord[] {
    const read = (filePath: string) => {
      try {
        return readFileSync(filePath, "utf8");
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    };
    const text = read(this.filePath);
    if (text !== null) {
      try {
        const replay = this.replay(text);
        let step = replay.next();
        while (!step.done) step = replay.next();
        if (!text.endsWith("\n")) truncateSync(this.filePath, this.completeBytes(text));
        return step.value;
      } catch (error) {
        console.error("[agent-host] session index journal is unreadable; rebuilding:", error);
        this.hasSnapshot = false;
        this.lines = 0;
        void this.enqueue(() => this.writeSnapshot([])).catch(() => undefined);
        return [];
      }
    }
    const legacy = read(path.join(this.directory, LEGACY_CACHE_FILE));
    let records: PersistedIndexRecord[] = [];
    let legacyValid = false;
    if (legacy !== null) {
      try {
        records = parseLegacyCache(legacy);
        legacyValid = true;
      } catch (error) {
        console.error("[agent-host] legacy session index cache is invalid; ignoring:", error);
      }
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    void this.enqueue(async () => {
      await this.writeSnapshot(records);
      this.lines = records.length;
    }).catch(() => undefined);
    this.hasSnapshot = legacyValid;
    return records;
  }

  private completeBytes(text: string): number {
    return Buffer.byteLength(text.slice(0, text.lastIndexOf("\n") + 1));
  }

  private *replay(text: string): Generator<void, PersistedIndexRecord[]> {
    const lines = text.slice(0, text.lastIndexOf("\n") + 1).split("\n");
    if (JSON.parse(lines.shift() ?? "null")?.v !== 2) throw new Error("Invalid session index journal header");
    const records = new Map<string, PersistedIndexRecord>();
    this.lines = 0;
    for (const line of lines) {
      if (!line) continue;
      applyLine(records, line);
      this.lines += 1;
      if (this.lines % CHUNK_RECORDS === 0) yield;
    }
    this.hasSnapshot = true;
    return [...records.values()];
  }

  put(record: PersistedIndexRecord): Promise<void> {
    return this.append(`${JSON.stringify({ op: "put", r: toPersistedRecord(record) })}\n`, 1);
  }

  remove(filePath: string): void {
    void this.append(`${JSON.stringify({ op: "del", p: filePath })}\n`, 1).catch(() => undefined);
  }

  writeChanges(upserts: readonly PersistedIndexRecord[], removals: readonly string[]): Promise<void> {
    return this.enqueue(async () => {
      const lines: string[] = [];
      const drain = async () => {
        if (lines.length === 0) return;
        const count = lines.length;
        await fs.appendFile(this.filePath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
        this.lines += count;
        lines.length = 0;
      };
      for (const record of upserts) {
        lines.push(JSON.stringify({ op: "put", r: toPersistedRecord(record) }));
        if (lines.length === CHUNK_RECORDS) await drain();
      }
      for (const filePath of removals) {
        lines.push(JSON.stringify({ op: "del", p: filePath }));
        if (lines.length === CHUNK_RECORDS) await drain();
      }
      await drain();
    });
  }

  maybeCompact(records: Iterable<PersistedIndexRecord>, liveCount: number): void {
    if (this.compacting || this.lines <= COMPACT_RATIO * liveCount + COMPACT_SLACK) return;
    this.compacting = true;
    const snapshot = [...records];
    void this.enqueue(async () => {
      try {
        await this.writeSnapshot(snapshot);
        this.lines = snapshot.length;
      } finally {
        this.compacting = false;
      }
    }).catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }

  private append(text: string, count: number): Promise<void> {
    return this.enqueue(async () => {
      await fs.appendFile(this.filePath, text, { encoding: "utf8", mode: 0o600 });
      this.lines += count;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(task);
    this.tail = pending.then(
      () => undefined,
      (error) => {
        this.failure = error;
        console.error("[agent-host] session index journal operation failed:", error);
      },
    );
    return pending;
  }

  private async writeSnapshot(records: readonly PersistedIndexRecord[]): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, HEADER, { encoding: "utf8", mode: 0o600 });
      for (let offset = 0; offset < records.length; offset += CHUNK_RECORDS) {
        const chunk = records.slice(offset, offset + CHUNK_RECORDS);
        const text = chunk.map((record) => JSON.stringify({ op: "put", r: toPersistedRecord(record) })).join("\n");
        await fs.appendFile(temporary, `${text}\n`, "utf8");
        await yieldToEventLoop();
      }
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
