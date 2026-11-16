import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const { readSessionFileEntries, readSessionHeader } = await importTestBundle("src/agent-host/session-jsonl", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "session-jsonl.ts")],
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pi-session-jsonl-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, "session.jsonl");
}

function observeReads(t) {
  const open = fs.open.bind(fs);
  const reads = [];
  const closed = [];
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    handle.read = async (buffer, offset, length, position) => {
      const result = await read(buffer, offset, length, position);
      reads.push({ requested: length, received: result.bytesRead });
      return result;
    };
    handle.close = async () => {
      await close();
      closed.push(true);
    };
    return handle;
  });
  return { reads, closed };
}

test("windowed history reads preserve a multi-window UTF-8 line and skip malformed trailing records", async (t) => {
  const file = await fixture(t);
  const header = {
    type: "session",
    version: 3,
    id: "windowed",
    cwd: path.dirname(file),
    timestamp: "2026-08-06T00:00:00.000Z",
  };
  const message = {
    type: "message",
    id: "user",
    parentId: null,
    timestamp: header.timestamp,
    message: { role: "user", content: "🙂跨窗口".repeat(160_000) },
  };
  const future = { type: "future_metadata", id: "future", parentId: "user", timestamp: header.timestamp };
  const raw = `${JSON.stringify(header)}\r\n${JSON.stringify(message)}\r\nnull\n{broken\n${JSON.stringify(future)}`;
  await fs.writeFile(file, raw);
  const { reads, closed } = observeReads(t);
  assert.deepEqual(await readSessionFileEntries(file), [header, message, future]);
  assert.ok(reads.length > 3);
  assert.ok(reads.every((read) => read.requested <= 512 * 1024));
  assert.equal(
    reads.reduce((sum, read) => sum + read.received, 0),
    Buffer.byteLength(raw),
  );
  assert.deepEqual(closed, [true]);
  assert.equal(await fs.readFile(file, "utf8"), raw);
});

test("resuming a session reads only the header window even when the body is several megabytes", async (t) => {
  const file = await fixture(t);
  const header = {
    type: "session",
    version: 3,
    id: "header",
    cwd: path.dirname(file),
    timestamp: "2026-08-06T00:00:00.000Z",
  };
  await fs.writeFile(file, `${JSON.stringify(header)}\n${"x".repeat(6 * 1024 * 1024)}`);
  const { reads, closed } = observeReads(t);
  assert.deepEqual(await readSessionHeader(file), header);
  assert.ok(reads.reduce((sum, read) => sum + read.received, 0) <= 64 * 1024);
  assert.deepEqual(closed, [true]);
});

test("oversized headers fail without reading the body and release their file handle", async (t) => {
  const file = await fixture(t);
  await fs.writeFile(file, JSON.stringify({ type: "session", cwd: "x".repeat(128 * 1024) }));
  const { reads, closed } = observeReads(t);
  await assert.rejects(readSessionHeader(file), /header exceeds/);
  assert.ok(reads.reduce((sum, read) => sum + read.received, 0) <= 64 * 1024);
  assert.deepEqual(closed, [true]);
});

test("a failed asynchronous read still releases the file handle", async (t) => {
  let closed = false;
  t.mock.method(fs, "open", async () => ({
    async read() {
      throw Object.assign(new Error("read denied"), { code: "EIO" });
    },
    async close() {
      closed = true;
    },
  }));
  await assert.rejects(readSessionFileEntries("unreadable.jsonl"), { code: "EIO" });
  assert.equal(closed, true);
});

test("a byte-limited snapshot includes only newline-terminated entries before its boundary", async (t) => {
  const file = await fixture(t);
  const header = { type: "session", version: 3, id: "bounded", cwd: path.dirname(file), timestamp: "2026-01-01" };
  const first = { type: "message", id: "first", parentId: null, message: { role: "user", content: "first" } };
  const last = { type: "message", id: "last", parentId: "first", message: { role: "user", content: "🙂last" } };
  const prefix = `${JSON.stringify(header)}\n${JSON.stringify(first)}\n`;
  await fs.writeFile(file, `${prefix}${JSON.stringify(last)}\n`);
  const maxBytes = Buffer.byteLength(prefix) + Buffer.byteLength(JSON.stringify(last));
  assert.deepEqual(await readSessionFileEntries(file, { maxBytes }), [header, first]);
  assert.deepEqual(await readSessionFileEntries(file, { maxBytes: maxBytes + 1 }), [header, first, last]);
});
