import assert from "node:assert/strict";
import test from "node:test";
import { assertDraftRelease, createReleaseDraft, getExistingRelease } from "./github-release.mjs";

test("an unavailable or unauthorized release lookup fails instead of pretending that the version is new", async (t) => {
  for (const status of [401, 403, 429, 500]) {
    const restore = t.mock.method(
      globalThis,
      "fetch",
      async () => new globalThis.Response("lookup failed", { status }),
    );
    try {
      await assert.rejects(getExistingRelease("oDaiSuno/dexon", "v0.1.1"), new RegExp(String(status)));
    } finally {
      restore.mock.restore();
    }
  }
});

test("only an explicit not-found response is treated as a missing release", async (t) => {
  const response = t.mock.method(
    globalThis,
    "fetch",
    async () => new globalThis.Response("not found", { status: 404 }),
  );
  assert.equal(await getExistingRelease("oDaiSuno/dexon", "v0.1.1"), null);
  response.mock.restore();
  t.mock.method(globalThis, "fetch", async () => new globalThis.Response(JSON.stringify({ id: 7, draft: false })));
  assert.deepEqual(await getExistingRelease("oDaiSuno/dexon", "v0.1.0"), { id: 7, draft: false });
});

test("an already public release is never a valid destination for upload or replacement", () => {
  assert.throws(() => assertDraftRelease({ id: 1, draft: false }), /public|draft/);
  assert.throws(() => assertDraftRelease({ id: 1 }), /public|draft/);
});

test("new releases stay drafts and disclose unsigned macOS and Windows downloads", async (t) => {
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, "https://api.github.com/repos/oDaiSuno/dexon/releases");
    assert.equal(options.method, "POST");
    sent = JSON.parse(options.body);
    return new globalThis.Response(JSON.stringify({ id: 8, draft: true }));
  });
  assert.deepEqual(await createReleaseDraft("oDaiSuno/dexon", "v0.1.1"), { id: 8, draft: true });
  assert.equal(sent.tag_name, "v0.1.1");
  assert.equal(sent.draft, true);
  assert.equal(sent.prerelease, false);
  assert.match(sent.body, /macOS:.*Unsigned Beta/);
  assert.match(sent.body, /not notarized/i);
  assert.match(sent.body, /Windows:.*Unsigned Beta/);
  assert.doesNotMatch(sent.body, /Developer ID signed and notarized/);
});
