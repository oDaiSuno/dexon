import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { stageRemoteAttachment } from "./remote-attachment-client.ts";

const TOKEN = "t".repeat(48);
const bytes = Buffer.from("hello attachment\n", "utf8");
const DIGEST = "2852d7262f1fd6339a426560101d5840edf5b8999b90eb6b2eea86c8b9f7e298";
const staged = (overrides = {}) => ({
  path: "/home/dev/.dexon/attachments/ab/hello.txt",
  name: "hello.txt",
  mime: "text/plain",
  size: bytes.length,
  deduplicated: false,
  ...overrides,
});
const request = (overrides = {}) => ({
  environmentId: "remote-1",
  name: "hello.txt",
  mime: "text/plain",
  base64: bytes.toString("base64"),
  ...overrides,
});

async function remote(t, respond) {
  const seen = [];
  const server = createServer((incoming, response) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      const observed = {
        method: incoming.method,
        url: incoming.url,
        headers: incoming.headers,
        body: Buffer.concat(chunks),
      };
      seen.push(observed);
      if (respond) respond(observed, response);
      else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ staged: staged() }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

test("uploads raw bytes with authentication, filename, content type and digest headers", async (t) => {
  const server = await remote(t);
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url, authToken: TOKEN }, request());
  assert.deepEqual(result, { ok: true, staged: staged() });
  assert.equal(server.seen.length, 1);
  const [observed] = server.seen;
  assert.equal(observed.method, "POST");
  assert.equal(observed.url, "/attachments/stage");
  assert.equal(observed.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(observed.headers["content-type"], "text/plain");
  assert.equal(observed.headers["x-dexon-filename"], "hello.txt");
  assert.equal(observed.headers["x-dexon-sha256"], DIGEST);
  assert.deepEqual(observed.body, bytes);
});

test("omits authorization without a token and falls back to octet-stream without a mime", async (t) => {
  const server = await remote(t);
  for (const authToken of [undefined, ""]) {
    const result = await stageRemoteAttachment({ httpBaseUrl: server.url, authToken }, request({ mime: undefined }));
    assert.equal(result.ok, true);
  }
  assert.equal(server.seen.length, 2);
  for (const observed of server.seen) {
    assert.equal(observed.headers.authorization, undefined);
    assert.equal(observed.headers["content-type"], "application/octet-stream");
  }
});

test("percent-encodes non-ASCII filenames and forwards the caller supplied digest", async (t) => {
  const server = await remote(t);
  const name = "报告 final #1.pdf";
  const result = await stageRemoteAttachment(
    { httpBaseUrl: server.url },
    request({ name, sha256: DIGEST.toUpperCase() }),
  );
  assert.equal(result.ok, true);
  assert.equal(server.seen[0].headers["x-dexon-filename"], encodeURIComponent(name));
  assert.equal(decodeURIComponent(server.seen[0].headers["x-dexon-filename"]), name);
  assert.equal(server.seen[0].headers["x-dexon-sha256"], DIGEST);
});

async function rejected(t, overrides, expectedCode, endpointOverrides = {}) {
  const server = await remote(t);
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url, ...endpointOverrides }, request(overrides));
  assert.equal(result.ok, false);
  assert.equal(result.code, expectedCode);
  assert.equal(server.seen.length, 0);
  return result;
}

test("an empty payload is refused locally", async (t) => {
  await rejected(t, { base64: "" }, "empty-payload");
});

test("encoded content exceeding the size budget is refused before base64 validation", async (t) => {
  const limit = 25 * 1024 * 1024;
  const result = await rejected(t, { base64: "!".repeat(Math.ceil(limit / 3) * 4 + 4) }, "too-large");
  assert.match(result.message, /25 MiB/);
});

test("padding cannot hide decoded bytes beyond the 25 MiB budget", async (t) => {
  const encodedLength = Math.ceil((25 * 1024 * 1024) / 3) * 4;
  await rejected(t, { base64: `${"A".repeat(encodedLength - 1)}=` }, "too-large");
});

test("a payload of exactly 25 MiB is accepted", async (t) => {
  const server = await remote(t, (_observed, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ staged: staged({ size: 25 * 1024 * 1024 }) }));
  });
  const result = await stageRemoteAttachment(
    { httpBaseUrl: server.url },
    request({ base64: Buffer.alloc(25 * 1024 * 1024, 7).toString("base64") }),
  );
  assert.equal(result.ok, true);
  assert.equal(server.seen[0].body.length, 25 * 1024 * 1024);
});

for (const [label, base64] of [
  ["characters outside the alphabet", "aGVsbG8*"],
  ["missing padding", "aGVsbG8"],
  ["embedded whitespace", "aGVs bG8="],
  ["padding in the middle", "aGV=bG8="],
  ["excess padding", "aGVsbG8==="],
  ["non-string content", 42],
  ["non-zero padding bits for one decoded byte", "Zh=="],
  ["non-zero padding bits for two decoded bytes", "Zm9="],
]) {
  test(`malformed base64 is refused: ${label}`, async (t) => {
    await rejected(t, { base64 }, "unsupported-type");
  });
}

for (const [base64, text] of [
  ["Zg==", "f"],
  ["Zm8=", "fo"],
  ["Zm9v", "foo"],
]) {
  test(`canonical base64 ${base64} uploads exactly its decoded bytes`, async (t) => {
    const server = await remote(t, (_observed, response) =>
      response.end(JSON.stringify(staged({ size: text.length }))),
    );
    const result = await stageRemoteAttachment({ httpBaseUrl: server.url }, request({ base64 }));
    assert.equal(result.ok, true);
    assert.deepEqual(server.seen[0].body, Buffer.from(text));
  });
}

for (const [label, name] of [
  ["empty", ""],
  ["blank", "   "],
  ["non-string", 7],
  ["longer than 255 UTF-8 bytes", "a".repeat(256)],
  ["multi-byte beyond 255 bytes", "报".repeat(86)],
  ["control characters", "bad\nname.txt"],
  ["null byte", "bad\u0000.txt"],
  ["path separator", "dir/file.txt"],
  ["backslash", "dir\\file.txt"],
  ["dot segment", ".."],
  ["lone surrogate", "bad\ud800.txt"],
]) {
  test(`filename is refused: ${label}`, async (t) => {
    await rejected(t, { name }, "unsupported-type");
  });
}

test("a 255 byte filename is accepted", async (t) => {
  const server = await remote(t);
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url }, request({ name: "a".repeat(255) }));
  assert.equal(result.ok, true);
});

for (const [label, mime] of [
  ["no subtype", "text"],
  ["spaces", "text /plain"],
  ["control characters", "text/plain\r\nX-Evil: 1"],
  ["non-string", 5],
  ["too long", `text/${"a".repeat(300)}`],
]) {
  test(`mime type is refused: ${label}`, async (t) => {
    await rejected(t, { mime }, "unsupported-type");
  });
}

test("a mime type with parameters is forwarded", async (t) => {
  const server = await remote(t);
  await stageRemoteAttachment({ httpBaseUrl: server.url }, request({ mime: "text/plain; charset=utf-8" }));
  assert.equal(server.seen[0].headers["content-type"], "text/plain; charset=utf-8");
});

for (const [label, sha256] of [
  ["too short", "abc123"],
  ["non-hex", "z".repeat(64)],
  ["non-string", 12],
  ["a digest that does not match the bytes", "0".repeat(64)],
]) {
  test(`sha256 is refused: ${label}`, async (t) => {
    await rejected(t, { sha256 }, "unsupported-type");
  });
}

for (const [label, environmentId] of [
  ["empty", ""],
  ["non-string", null],
  ["control characters", "env\n1"],
  ["longer than 1024 characters", "a".repeat(1025)],
]) {
  test(`environment id is refused: ${label}`, async (t) => {
    await rejected(t, { environmentId }, "unsupported-type");
  });
}

test("an environment id of exactly 1024 characters is accepted", async (t) => {
  const server = await remote(t);
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url }, request({ environmentId: "a".repeat(1024) }));
  assert.equal(result.ok, true);
  assert.equal(server.seen.length, 1);
});

test("a request that is not an object is refused", async (t) => {
  const server = await remote(t);
  for (const bad of [null, undefined, "text", 3]) {
    const result = await stageRemoteAttachment({ httpBaseUrl: server.url }, bad);
    assert.equal(result.ok, false);
    assert.equal(result.code, "unsupported-type");
  }
  assert.equal(server.seen.length, 0);
});

const replyStatus =
  (status, body = "") =>
  (_observed, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  };

for (const [status, code] of [
  [404, "unsupported"],
  [413, "too-large"],
  [400, "unsupported-type"],
  [415, "unsupported-type"],
  [500, "write-failed"],
  [401, "disconnected"],
  [403, "disconnected"],
  [502, "disconnected"],
  [503, "disconnected"],
  [504, "disconnected"],
  [409, "write-failed"],
  [507, "write-failed"],
]) {
  test(`HTTP ${status} from the remote environment maps to ${code}`, async (t) => {
    const server = await remote(t, replyStatus(status, JSON.stringify({ error: `secret ${TOKEN}` })));
    const result = await stageRemoteAttachment({ httpBaseUrl: server.url, authToken: TOKEN }, request());
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(typeof result.message, "string");
    assert.notEqual(result.message, "");
    assert.equal(result.message.includes(TOKEN), false);
  });
}

test("the daemon's direct staged object is returned through the desktop result contract", async (t) => {
  const server = await remote(t, replyStatus(200, JSON.stringify(staged())));
  assert.deepEqual(await stageRemoteAttachment({ httpBaseUrl: server.url }, request()), { ok: true, staged: staged() });
});

test("a successful reply with the server's own normalised name, mime and deduplication flag is returned as is", async (t) => {
  const reported = staged({ name: "hello (1).txt", mime: "text/plain", deduplicated: true });
  const server = await remote(t, replyStatus(200, JSON.stringify({ ok: true, staged: reported })));
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url }, request());
  assert.deepEqual(result, { ok: true, staged: reported });
});

for (const [label, body] of [
  ["not JSON", "<html>proxy</html>"],
  ["not an object", "[]"],
  ["missing staged", "{}"],
  ["empty path", JSON.stringify({ staged: staged({ path: "" }) })],
  ["non-string path", JSON.stringify({ staged: staged({ path: 5 }) })],
  ["path with control characters", JSON.stringify({ staged: staged({ path: "/tmp/a\nb" }) })],
  ["non-string name", JSON.stringify({ staged: staged({ name: null }) })],
  ["empty name", JSON.stringify({ staged: staged({ name: "" }) })],
  ["oversized name", JSON.stringify({ staged: staged({ name: "a".repeat(256) }) })],
  ["non-string mime", JSON.stringify({ staged: staged({ mime: 1 }) })],
  ["empty mime", JSON.stringify({ staged: staged({ mime: "" }) })],
  ["invalid mime", JSON.stringify({ staged: staged({ mime: "text" }) })],
  ["negative size", JSON.stringify({ staged: staged({ size: -1 }) })],
  ["fractional size", JSON.stringify({ staged: staged({ size: 1.5 }) })],
  ["size that disagrees with the bytes sent", JSON.stringify({ staged: staged({ size: bytes.length + 1 }) })],
  ["non-boolean deduplicated", JSON.stringify({ staged: staged({ deduplicated: "no" }) })],
  ["ok flag set to false", JSON.stringify({ ok: false, staged: staged() })],
]) {
  test(`a malformed success reply is rejected as write-failed: ${label}`, async (t) => {
    const server = await remote(t, replyStatus(200, body));
    const result = await stageRemoteAttachment({ httpBaseUrl: server.url }, request());
    assert.equal(result.ok, false);
    assert.equal(result.code, "write-failed");
  });
}

test("an oversized success reply is abandoned without being buffered", async (t) => {
  const server = await remote(t, (_observed, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"staged":');
    const filler = Buffer.alloc(64 * 1024, 0x20);
    const timer = globalThis.setInterval(() => response.write(filler), 1);
    response.on("close", () => globalThis.clearInterval(timer));
  });
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url }, request());
  assert.equal(result.ok, false);
  assert.equal(result.code, "write-failed");
  assert.match(result.message, /too large/i);
});

test("an unreachable environment reports disconnected without exposing the token", async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const result = await stageRemoteAttachment({ httpBaseUrl: `http://127.0.0.1:${port}`, authToken: TOKEN }, request());
  assert.equal(result.ok, false);
  assert.equal(result.code, "disconnected");
  assert.equal(result.message.includes(TOKEN), false);
});

test("a connection dropped mid-request reports disconnected", async (t) => {
  const server = await remote(t, (_observed, response) => response.socket.destroy());
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url, authToken: TOKEN }, request());
  assert.equal(result.ok, false);
  assert.equal(result.code, "disconnected");
  assert.equal(result.message.includes(TOKEN), false);
});

test("an unresponsive environment has a 60 second deadline and times out as disconnected", async (t) => {
  const timeout = globalThis.AbortSignal.timeout.bind(globalThis.AbortSignal);
  const deadlines = [];
  t.mock.method(globalThis.AbortSignal, "timeout", (duration) => {
    deadlines.push(duration);
    return timeout(30);
  });
  const server = await remote(t, () => {});
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url }, request());
  assert.deepEqual(deadlines, [60_000]);
  assert.equal(result.ok, false);
  assert.equal(result.code, "disconnected");
  assert.match(result.message, /timed out/i);
});

test("a redirect is refused and the token is not forwarded to the redirect target", async (t) => {
  const target = await remote(t);
  const server = await remote(t, (_observed, response) => {
    response.writeHead(307, { location: `${target.url}/attachments/stage` });
    response.end();
  });
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url, authToken: TOKEN }, request());
  assert.equal(result.ok, false);
  assert.equal(result.code, "disconnected");
  assert.equal(target.seen.length, 0);
  assert.equal(result.message.includes(TOKEN), false);
});

for (const [label, httpBaseUrl] of [
  ["embedded credentials", "http://user:pass@127.0.0.1:9/"],
  ["a non-HTTP protocol", "ftp://127.0.0.1/"],
  ["a file URL", "file:///etc/passwd"],
  ["an unparsable URL", "not a url"],
  ["an empty URL", ""],
]) {
  test(`an endpoint with ${label} is refused before any request`, async () => {
    const result = await stageRemoteAttachment({ httpBaseUrl, authToken: TOKEN }, request());
    assert.equal(result.ok, false);
    assert.equal(result.code, "disconnected");
    assert.equal(result.message.includes(TOKEN), false);
  });
}

test("a non-string endpoint URL is refused", async () => {
  const result = await stageRemoteAttachment({ httpBaseUrl: 5 }, request());
  assert.equal(result.ok, false);
  assert.equal(result.code, "disconnected");
});

test("a token is never sent over plaintext HTTP to a non-loopback host", async () => {
  for (const host of ["192.0.2.10", "example.com", "[2001:db8::1]"]) {
    const result = await stageRemoteAttachment({ httpBaseUrl: `http://${host}:9/`, authToken: TOKEN }, request());
    assert.equal(result.ok, false);
    assert.equal(result.code, "disconnected");
    assert.match(result.message, /loopback/i);
    assert.equal(result.message.includes(TOKEN), false);
  }
});

test("a token is refused when it cannot be sent as a header value", async (t) => {
  const server = await remote(t);
  const result = await stageRemoteAttachment({ httpBaseUrl: server.url, authToken: "bad\r\ntoken" }, request());
  assert.equal(result.ok, false);
  assert.equal(result.code, "disconnected");
  assert.equal(server.seen.length, 0);
});

test("IPv6 loopback with a token is allowed over plaintext HTTP", async (t) => {
  const server = createServer((incoming, response) => {
    incoming.resume();
    incoming.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ staged: staged() }));
    });
  });
  const listening = await new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(0, "::1", () => resolve(true));
  });
  t.after(() => new Promise((resolve) => (listening ? server.close(resolve) : resolve())));
  if (!listening) return t.skip("IPv6 loopback unavailable");
  const result = await stageRemoteAttachment(
    { httpBaseUrl: `http://[::1]:${server.address().port}`, authToken: TOKEN },
    request(),
  );
  assert.equal(result.ok, true);
});

test("an HTTPS endpoint with a token is not rejected by the plaintext rule", async () => {
  const result = await stageRemoteAttachment({ httpBaseUrl: "https://127.0.0.1:1/", authToken: TOKEN }, request());
  assert.equal(result.ok, false);
  assert.equal(result.code, "disconnected");
  assert.doesNotMatch(result.message, /loopback/i);
});

test("an endpoint URL path prefix is ignored and the stage route is always /attachments/stage", async (t) => {
  const server = await remote(t);
  await stageRemoteAttachment({ httpBaseUrl: `${server.url}/some/prefix?x=1#frag` }, request());
  assert.equal(server.seen[0].url, "/attachments/stage");
});
