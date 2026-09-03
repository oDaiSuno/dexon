import assert from "node:assert/strict";
import test from "node:test";

import { base64ByteLength, normalizeImage } from "./image-normalization.ts";

function fakeDependencies({ dimensions = { width: 1000, height: 1000 }, encodedSize = 8 } = {}) {
  const calls = { decoded: 0, encoded: [] };
  return {
    dependencies: {
      async decodeDimensions() {
        calls.decoded += 1;
        return { width: dimensions.width, height: dimensions.height };
      },
      async encodeJpeg(_bytes, options) {
        calls.encoded.push(options);
        return new Uint8Array(encodedSize).fill(7);
      },
      toBase64: (bytes) => Buffer.from(bytes).toString("base64"),
    },
    calls,
  };
}

test("base64ByteLength handles padding correctly", () => {
  assert.equal(base64ByteLength(Buffer.from("a").toString("base64")), 1);
  assert.equal(base64ByteLength(Buffer.from("ab").toString("base64")), 2);
  assert.equal(base64ByteLength(Buffer.from("abc").toString("base64")), 3);
  assert.equal(base64ByteLength(""), 0);
});

test("GIFs pass through byte-identical and reject when oversized", async () => {
  const bytes = new Uint8Array(8);
  const { dependencies } = fakeDependencies();
  const result = await normalizeImage(bytes, "image/gif", dependencies);

  assert.deepEqual(result, { data: Buffer.from(bytes).toString("base64"), mimeType: "image/gif" });

  await assert.rejects(
    normalizeImage(new Uint8Array(9), "image/gif", dependencies, { maxBytes: 8 }),
    (error) => error.code === "too-large",
  );
});

test("unsupported formats are rejected before decoding", async () => {
  const { dependencies, calls } = fakeDependencies();

  for (const mimeType of ["image/heic", "", "image/x-unknown"]) {
    await assert.rejects(
      normalizeImage(new Uint8Array(4), mimeType, dependencies),
      (error) => error.code === "unsupported-format",
    );
    assert.equal(calls.decoded, 0);
  }
});

test("small in-limit images pass through without re-encoding", async () => {
  const bytes = new Uint8Array(32).fill(7);
  const { dependencies, calls } = fakeDependencies();

  const normalized = await normalizeImage(bytes, "image/png", dependencies);

  assert.deepEqual(normalized, { data: Buffer.from(bytes).toString("base64"), mimeType: "image/png" });
  assert.equal(calls.encoded.length, 0);
});

test("AVIF is decoded and re-encoded even within the size limit", async () => {
  const { dependencies, calls } = fakeDependencies();

  const normalized = await normalizeImage(new Uint8Array(4), "image/avif", dependencies);

  assert.equal(normalized.mimeType, "image/jpeg");
  assert.equal(normalized.convertedFrom, "image/avif");
  assert.equal(calls.encoded.length, 1);
});

test("oversized images are downscaled to the max long edge before re-encoding", async () => {
  const { dependencies, calls } = fakeDependencies({ dimensions: { width: 4000, height: 3000 } });
  const result = await normalizeImage(new Uint8Array(16), "image/png", dependencies);

  assert.deepEqual(calls.encoded, [{ width: 2000, height: 1500, quality: 80 }]);
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.convertedFrom, "image/png");
});

test("images within the size limit but beyond the max edge are still downscaled", async () => {
  const { dependencies, calls } = fakeDependencies({ dimensions: { width: 3000, height: 1000 } });

  await normalizeImage(new Uint8Array(16), "image/png", dependencies);

  assert.deepEqual(calls.encoded, [{ width: 2000, height: 666, quality: 80 }]);
});

test("images that stay oversized after compression are rejected", async () => {
  const { dependencies, calls } = fakeDependencies({ encodedSize: 4.5 * 1024 * 1024 + 8 });

  await assert.rejects(
    normalizeImage(new Uint8Array(16), "image/avif", dependencies),
    (error) => error.code === "too-large",
  );
  assert.equal(calls.encoded.length, 1);
});
