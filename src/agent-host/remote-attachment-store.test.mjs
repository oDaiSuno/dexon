import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, utimes, writeFile } = fs;
const { RemoteAttachmentStore, RemoteAttachmentError, assertPathAllowed } = await importTestBundle(
  "src/agent-host/remote-attachment-store",
  {
    packages: "external",
    stdin: {
      contents:
        'export { RemoteAttachmentStore, RemoteAttachmentError } from "./remote-attachment-store.ts"; export { assertPathAllowed } from "./file-access.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "remote-attachment-test-entry.ts",
      loader: "ts",
    },
  },
);

async function fixture(t, options) {
  const parent = await mkdtemp(path.join(tmpdir(), "pi-remote-attachment-"));
  const root = path.join(parent, "staged-attachments");
  const store = new RemoteAttachmentStore(root, options);
  t.after(async () => {
    await store.dispose();
    await rm(parent, { recursive: true, force: true });
  });
  return { parent, root, store };
}

function attachmentError(code, statusCode) {
  return (error) => {
    assert.ok(error instanceof RemoteAttachmentError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  };
}

test("initialize creates or tightens a private root", async (t) => {
  const { root, store } = await fixture(t);
  await mkdir(root, { mode: 0o777 });
  await chmod(root, 0o777);
  await store.initialize();
  assert.equal((await lstat(root)).isDirectory(), true);
  if (process.platform !== "win32") assert.equal((await lstat(root)).mode & 0o777, 0o700);
});

test("initialize refuses a symlink root without changing its target", async (t) => {
  const { parent, root, store } = await fixture(t);
  const target = path.join(parent, "outside");
  await mkdir(target, { mode: 0o755 });
  await chmod(target, 0o755);
  await symlink(target, root, "dir");
  await assert.rejects(store.initialize(), attachmentError("UNSAFE_ROOT", 500));
  if (process.platform !== "win32") assert.equal((await lstat(target)).mode & 0o777, 0o755);
});

test("stage returns private, readable UUID paths and sanitized cross-platform names", async (t) => {
  const { root, store } = await fixture(t);
  await store.initialize();
  for (const [name, expected] of [
    ["../../etc/secret\u0000\n.txt", "secret.txt"],
    ["C:\\Users\\private\\report\u007f.txt", "report.txt"],
    ["../..", "attachment.bin"],
    [undefined, "attachment.bin"],
  ]) {
    const data = Buffer.from(`content:${name}`);
    const saved = await store.stage({ name, data, mime: "text/plain; charset=utf-8" });
    assert.equal(saved.name, expected);
    assert.equal(saved.mime, "text/plain");
    assert.equal(saved.size, data.length);
    assert.equal(saved.deduplicated, false);
    assert.equal(path.isAbsolute(saved.path), true);
    assert.equal(path.dirname(saved.path), path.resolve(root));
    assert.match(path.basename(saved.path), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/);
    assert.deepEqual(await readFile(saved.path), data);
    await assertPathAllowed(saved.path);
    if (process.platform !== "win32") assert.equal((await lstat(saved.path)).mode & 0o777, 0o600);
  }
});

const images = [
  ["png", "image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])],
  ["jpg", "image/jpeg", Buffer.from([255, 216, 255, 1])],
  ["gif", "image/gif", Buffer.from("GIF87a-content")],
  ["gif", "image/gif", Buffer.from("GIF89a-content")],
  ["webp", "image/webp", Buffer.from("RIFF0000WEBPcontent")],
];

test("image bytes determine MIME and safe suffixes instead of executable suffixes", async (t) => {
  const { store } = await fixture(t);
  await store.initialize();
  for (const [extension, mime, data] of images) {
    const saved = await store.stage({ name: "payload.exe", mime: "IMAGE/SVG+XML; charset=utf-8", data });
    assert.equal(saved.mime, mime);
    assert.equal(saved.name, `payload.${extension}`);
    assert.equal(path.extname(saved.path), `.${extension}`);
  }
  const disguised = await store.stage({ name: "hidden.cmd", mime: "application/octet-stream", data: images[0][2] });
  assert.equal(disguised.mime, "image/png");
  assert.equal(disguised.name, "hidden.png");
});

test("image MIME or image suffix requires supported magic, including SVG and uncommon formats", async (t) => {
  const { store, root } = await fixture(t);
  await store.initialize();
  for (const input of [
    { name: "file.txt", mime: "image/png" },
    ...["png", "JPG", "jpeg", "gif", "webp", "svg", "svgz", "avif", "heic", "bmp", "tiff", "ico", "jxl"].map(
      (extension) => ({ name: `spoof.${extension}`, mime: "text/plain" }),
    ),
  ]) {
    await assert.rejects(
      store.stage({ ...input, data: Buffer.from("<svg>unsafe</svg>") }),
      attachmentError("INVALID_IMAGE", 400),
    );
  }
  assert.deepEqual(await readdir(root), []);
});

test("stage rejects empty data and enforces inclusive 20 MiB image and 25 MiB file limits", async (t) => {
  const { store } = await fixture(t);
  await store.initialize();
  await assert.rejects(store.stage({ data: Buffer.alloc(0) }), attachmentError("EMPTY_ATTACHMENT", 400));
  const image = Buffer.alloc(20 * 1024 * 1024);
  images[0][2].copy(image);
  assert.equal((await store.stage({ name: "at.png", data: image })).size, image.length);
  await assert.rejects(
    store.stage({ name: "over.png", data: Buffer.concat([image, Buffer.from([1])]) }),
    attachmentError("ATTACHMENT_TOO_LARGE", 413),
  );
  const file = Buffer.alloc(25 * 1024 * 1024, 1);
  assert.equal((await store.stage({ name: "at.bin", data: file })).size, file.length);
  await assert.rejects(
    store.stage({ data: Buffer.concat([file, Buffer.from([1])]) }),
    attachmentError("ATTACHMENT_TOO_LARGE", 413),
  );
});

test("stage verifies optional SHA256 against actual bytes, including malformed declarations", async (t) => {
  const { store, root } = await fixture(t);
  await store.initialize();
  const sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  for (const hash of ["", "wrong", "0".repeat(64), sha256]) {
    await assert.rejects(
      store.stage({ data: Buffer.from("not abc"), sha256: hash }),
      attachmentError("INVALID_SHA256", 400),
    );
  }
  assert.deepEqual(await readdir(root), []);
  const saved = await store.stage({ data: Buffer.from("abc"), sha256: sha256.toUpperCase() });
  assert.equal(await readFile(saved.path, "utf8"), "abc");
});

test("same and concurrent content reuses one file, touches it, and recreates deleted content", async (t) => {
  const { store, root } = await fixture(t);
  await store.initialize();
  const data = Buffer.from("shared bytes");
  const first = await store.stage({ name: "one.txt", data });
  await utimes(first.path, new Date(1_000), new Date(1_000));
  const copies = await Promise.all(
    Array.from({ length: 12 }, (_, index) => store.stage({ name: `${index}.txt`, data })),
  );
  assert.ok(copies.every((copy) => copy.path === first.path && copy.deduplicated));
  assert.ok((await lstat(first.path)).mtimeMs > 1_000);
  assert.equal((await readdir(root)).length, 1);
  await unlink(first.path);
  const replacement = await store.stage({ data });
  assert.equal(replacement.deduplicated, false);
  assert.notEqual(replacement.path, first.path);
  assert.deepEqual(await readFile(replacement.path), data);
});

test("initialize indexes actual persisted bytes without trusting filenames or following symlink files", async (t) => {
  const { root, parent, store } = await fixture(t);
  await mkdir(root);
  const existing = path.join(root, "previous.txt");
  const target = path.join(parent, "outside.txt");
  await writeFile(existing, "persisted", { mode: 0o600 });
  await writeFile(target, "outside", { mode: 0o600 });
  const link = path.join(root, "linked.txt");
  await symlink(target, link);
  await store.initialize();
  const reused = await store.stage({ data: Buffer.from("persisted"), name: "new.txt" });
  assert.equal(reused.path, existing);
  assert.equal(reused.deduplicated, true);
  const notLinked = await store.stage({ data: Buffer.from("outside") });
  assert.notEqual(notLinked.path, link);
  assert.equal(notLinked.deduplicated, false);
  assert.equal(await readFile(target, "utf8"), "outside");
  await assert.rejects(assertPathAllowed(link));
});

test("dedup rechecks links, bytes, permissions, and image suffixes", async (t) => {
  const { store, root, parent } = await fixture(t);
  await store.initialize();
  const data = Buffer.from("safe content");
  const first = await store.stage({ data });
  const outside = path.join(parent, "target");
  await writeFile(outside, data, { mode: 0o600 });
  await utimes(outside, new Date(1_000), new Date(1_000));
  await unlink(first.path);
  await symlink(outside, first.path);
  const second = await store.stage({ data });
  assert.equal(second.deduplicated, false);
  assert.notEqual(second.path, first.path);
  assert.equal((await lstat(outside)).mtimeMs, 1_000);
  await writeFile(second.path, "tampered");
  const third = await store.stage({ data });
  assert.equal(third.deduplicated, false);
  assert.deepEqual(await readFile(third.path), data);
  await chmod(third.path, 0o644);
  const fourth = await store.stage({ data });
  if (process.platform !== "win32") assert.equal((await lstat(fourth.path)).mode & 0o777, 0o600);
  await store.dispose();
  await writeFile(path.join(root, "persisted.exe"), images[0][2], { mode: 0o600 });
  const restarted = new RemoteAttachmentStore(root);
  t.after(() => restarted.dispose());
  await restarted.initialize();
  const image = await restarted.stage({ name: "picture.png", data: images[0][2] });
  assert.equal(path.extname(image.path), ".png");
});

test(
  "abort before or during an atomic incoming write leaves no temp or committed file",
  { timeout: 10_000 },
  async (t) => {
    const { store, root } = await fixture(t);
    await store.initialize();
    await assert.rejects(
      store.stage({ data: Buffer.from("cancelled"), signal: globalThis.AbortSignal.abort() }),
      attachmentError("ATTACHMENT_ABORTED", 400),
    );
    const controller = new globalThis.AbortController();
    let settled = false;
    const pending = store.stage({ data: Buffer.alloc(25 * 1024 * 1024, 2), signal: controller.signal });
    const rejected = assert.rejects(pending, attachmentError("ATTACHMENT_ABORTED", 400));
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    let temporary;
    while (!settled && !temporary) {
      temporary = (await readdir(root)).find((name) => name.startsWith(".incoming-"));
    }
    controller.abort();
    await rejected;
    assert.match(temporary, /^\.incoming-[0-9a-f-]{36}$/);
    assert.deepEqual(await readdir(root), []);
    const successful = await store.stage({ data: Buffer.from("after abort") });
    assert.equal(await readFile(successful.path, "utf8"), "after abort");
    assert.ok((await readdir(root)).every((name) => !name.startsWith(".incoming-")));
  },
);

test("initialize expires old files and incoming remnants without following links", async (t) => {
  const now = Date.UTC(2030, 0, 10);
  const { root, parent, store } = await fixture(t, { now: () => now });
  await mkdir(root);
  const names = ["expired.txt", "boundary.txt", "fresh.txt", ".incoming-abandoned"];
  for (const name of names) await writeFile(path.join(root, name), name);
  const week = 7 * 24 * 60 * 60 * 1_000;
  await utimes(path.join(root, names[0]), new Date(now - week - 1_000), new Date(now - week - 1_000));
  await utimes(path.join(root, names[1]), new Date(now - week), new Date(now - week));
  await utimes(path.join(root, names[2]), new Date(now), new Date(now));
  const outside = path.join(parent, "outside");
  await writeFile(outside, "untouched");
  await symlink(outside, path.join(root, "link"));
  await store.initialize();
  await assert.rejects(lstat(path.join(root, names[0])), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(root, names[3])), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, names[1]), "utf8"), names[1]);
  assert.equal(await readFile(path.join(root, names[2]), "utf8"), names[2]);
  assert.equal(await readFile(outside, "utf8"), "untouched");
});

test("cleanup uses mtime LRU capacity and reuse refreshes TTL through the injected clock", async (t) => {
  let now = Date.UTC(2030, 0, 10);
  const { store, root } = await fixture(t, { now: () => now, maxTotalBytes: 6, ttlMs: 1_000 });
  await store.initialize();
  const first = await store.stage({ data: Buffer.from("aaa") });
  now += 100;
  const second = await store.stage({ data: Buffer.from("bbb") });
  now += 100;
  const reused = await store.stage({ data: Buffer.from("aaa") });
  assert.equal(reused.path, first.path);
  now += 100;
  const third = await store.stage({ data: Buffer.from("ccc") });
  await assert.rejects(lstat(second.path), { code: "ENOENT" });
  assert.equal(await readFile(first.path, "utf8"), "aaa");
  assert.equal(await readFile(third.path, "utf8"), "ccc");
  assert.equal((await readdir(root)).length, 2);
  now += 950;
  await store.cleanup();
  await assert.rejects(lstat(first.path), { code: "ENOENT" });
  assert.equal(await readFile(third.path, "utf8"), "ccc");
  now += 100;
  await store.cleanup();
  assert.deepEqual(await readdir(root), []);
  const recreated = await store.stage({ data: Buffer.from("aaa") });
  assert.equal(recreated.deduplicated, false);
});

test("hourly cleanup unrefs once and disposal stops cleanup but preserves files", async (t) => {
  let now = Date.UTC(2030, 0, 10);
  const tasks = new Map();
  let unrefs = 0;
  const timers = {
    setInterval(callback, interval) {
      assert.equal(interval, 60 * 60 * 1_000);
      const handle = {
        unref() {
          unrefs += 1;
        },
      };
      tasks.set(handle, callback);
      return handle;
    },
    clearInterval(handle) {
      tasks.delete(handle);
    },
  };
  const { store } = await fixture(t, { now: () => now, timers });
  await Promise.all([store.initialize(), store.initialize()]);
  const old = await store.stage({ data: Buffer.from("old") });
  assert.equal(tasks.size, 1);
  assert.equal(unrefs, 1);
  now += 7 * 24 * 60 * 60 * 1_000 + 1_000;
  await [...tasks.values()][0]();
  await assert.rejects(lstat(old.path), { code: "ENOENT" });
  const fresh = await store.stage({ data: Buffer.from("fresh") });
  await store.dispose();
  await store.dispose();
  assert.equal(tasks.size, 0);
  now += 8 * 24 * 60 * 60 * 1_000;
  await store.cleanup();
  assert.equal(await readFile(fresh.path, "utf8"), "fresh");
  await assert.rejects(store.stage({ data: Buffer.from("late") }), attachmentError("STORE_DISPOSED", 500));
  await assert.rejects(store.initialize(), attachmentError("STORE_DISPOSED", 500));
});

test("operations reject uninitialized stores, non-directory roots, and replaced roots", async (t) => {
  const { root, parent, store } = await fixture(t);
  await assert.rejects(store.stage({ data: Buffer.from("early") }), attachmentError("STORE_NOT_INITIALIZED", 500));
  await writeFile(root, "not a directory");
  await assert.rejects(store.initialize(), attachmentError("UNSAFE_ROOT", 500));
  await unlink(root);
  await store.initialize();
  const saved = await store.stage({ data: Buffer.from("original") });
  const outside = path.join(parent, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, path.basename(saved.path)), "original");
  const { rename } = await import("node:fs/promises");
  await rename(root, `${root}-original`);
  await symlink(outside, root, "dir");
  await assert.rejects(store.stage({ data: Buffer.from("original") }), attachmentError("UNSAFE_ROOT", 500));
  await assert.rejects(store.stage({ data: Buffer.from("new") }), attachmentError("UNSAFE_ROOT", 500));
  await assert.rejects(store.cleanup(), attachmentError("UNSAFE_ROOT", 500));
  await assert.rejects(store.initialize(), attachmentError("UNSAFE_ROOT", 500));
  assert.deepEqual(await readdir(outside), [path.basename(saved.path)]);
});

test("rename failure maps to 500, cleans the temp, and permits retry", async (t) => {
  const { store, root } = await fixture(t);
  await store.initialize();
  const original = fs.rename;
  const restore = () => {
    fs.rename = original;
    syncBuiltinESMExports();
  };
  t.after(restore);
  fs.rename = async () => {
    throw Object.assign(new Error("Disk unavailable"), { code: "EIO" });
  };
  syncBuiltinESMExports();
  await assert.rejects(
    store.stage({ data: Buffer.from("retry content") }),
    attachmentError("ATTACHMENT_IO_ERROR", 500),
  );
  assert.deepEqual(await readdir(root), []);
  restore();
  const saved = await store.stage({ data: Buffer.from("retry content") });
  assert.equal(saved.deduplicated, false);
  assert.equal(await readFile(saved.path, "utf8"), "retry content");
});

test("name truncation preserves suffixes so long SVG names cannot evade validation", async (t) => {
  const { store } = await fixture(t);
  await store.initialize();
  await assert.rejects(
    store.stage({ name: "文".repeat(200) + ".svg", data: Buffer.from("<svg/>") }),
    attachmentError("INVALID_IMAGE", 400),
  );
  const saved = await store.stage({ name: "文".repeat(200) + ".txt", data: Buffer.from("long plain text") });
  assert.equal(path.extname(saved.name), ".txt");
  assert.ok(Buffer.byteLength(path.basename(saved.path)) <= 240);
});

test("stage snapshots bytes before awaiting so caller mutation cannot invalidate SHA or corrupt dedup", async (t) => {
  const { store } = await fixture(t);
  await store.initialize();
  const data = Buffer.from("abc");
  const pending = store.stage({ data, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  data.fill(120);
  const saved = await pending;
  assert.equal(await readFile(saved.path, "utf8"), "abc");
  const reused = await store.stage({ data: Buffer.from("abc") });
  assert.equal(reused.path, saved.path);
  assert.equal(reused.deduplicated, true);
});

test("image magic requires exact bytes rather than high-bit ASCII lookalikes or truncated headers", async (t) => {
  const { store, root } = await fixture(t);
  await store.initialize();
  const highGif = Buffer.from("GIF89a").map((byte) => byte | 128);
  const highWebp = Buffer.from("RIFF0000WEBP").map((byte) => byte | 128);
  for (const data of [
    highGif,
    highWebp,
    images[0][2].subarray(0, 7),
    Buffer.from("GIF89"),
    Buffer.from("RIFF0000WEB"),
  ]) {
    await assert.rejects(store.stage({ name: "image.png", data }), attachmentError("INVALID_IMAGE", 400));
  }
  assert.deepEqual(await readdir(root), []);
});

test("restart dedup skips image-spoof paths and retains safe image copies", async (t) => {
  const { root, store } = await fixture(t);
  await mkdir(root);
  const spoof = path.join(root, "untrusted.svg");
  const safe = path.join(root, "a-picture.png");
  await writeFile(spoof, "<svg/>");
  await writeFile(safe, images[0][2]);
  await writeFile(path.join(root, "z-picture.exe"), images[0][2]);
  await store.initialize();
  const plain = await store.stage({ name: "text.txt", data: Buffer.from("<svg/>") });
  assert.notEqual(plain.path, spoof);
  assert.equal(plain.deduplicated, false);
  const image = await store.stage({ name: "new.png", data: images[0][2] });
  assert.equal(image.path, safe);
  assert.equal(image.deduplicated, true);
});

test("persisted JPEG files with the safe jpeg alias remain eligible for content dedup", async (t) => {
  const { root, store } = await fixture(t);
  await mkdir(root);
  const existing = path.join(root, "previous.jpeg");
  await writeFile(existing, images[1][2], { mode: 0o600 });
  await store.initialize();
  const saved = await store.stage({ name: "current.jpg", data: images[1][2] });
  assert.equal(saved.path, existing);
  assert.equal(saved.mime, "image/jpeg");
  assert.equal(saved.deduplicated, true);
});

test("dedup recreates content when its path disappears during verification", async (t) => {
  const { store } = await fixture(t);
  await store.initialize();
  const first = await store.stage({ data: Buffer.from("racing content") });
  const original = fs.open;
  t.after(() => {
    fs.open = original;
    syncBuiltinESMExports();
  });
  fs.open = async (...args) => {
    const handle = await original(...args);
    if (args[0] === first.path) {
      const read = handle.readFile.bind(handle);
      handle.readFile = async (...readArgs) => {
        const data = await read(...readArgs);
        await unlink(first.path);
        return data;
      };
    }
    return handle;
  };
  syncBuiltinESMExports();
  const saved = await store.stage({ data: Buffer.from("racing content") });
  assert.equal(saved.deduplicated, false);
  assert.equal(await readFile(saved.path, "utf8"), "racing content");
});
