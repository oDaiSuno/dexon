import assert from "node:assert/strict";
import test from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fixture, task, agent, duration, http, localHttp, until } from "./runtime-test-support.mjs";

test("missing agent cwd fails immediately without retrying the launch", async (t) => {
  const f = await fixture(t);
  await f.enable(task(f.cwd, [{ ...agent("launch", "Missing workspace"), retry: { maxAttempts: 3, backoff: "1s" } }]));
  rmSync(f.cwd, { recursive: true });
  const started = f.start();
  const run = await until(() => {
    const run = f.runtime.getRun(started.runId);
    return run.attempts[0]?.settledAtMs !== null && run.attempts[0]?.outcome && run;
  });
  assert.equal(run.phase, "failed");
  assert.equal(run.wakeAtMs, null);
  assert.equal(run.attempts.length, 1);
  assert.equal(run.attempts[0].outcome, "rejected_before_commit");
  assert.equal(run.attempts[0].detail.code, "invalid_input");
  assert.equal(run.attempts[0].detail.maybeApplied, false);
  assert.equal(run.attempts[0].detail.message, "Automation cwd must be an existing directory");
  assert.equal(f.model.requests().length, 0);
  await f.advance(60000);
  assert.equal(f.runtime.getRun(started.runId).attempts.length, 1);
});

async function settled(f, runId) {
  return until(() => {
    const run = f.runtime.getRun(runId);
    return run.attempts[0]?.outcome && run;
  });
}

function script(f, source, options = {}) {
  writeFileSync(path.join(f.cwd, "job.mjs"), source);
  return {
    kind: "action",
    id: "job",
    call: { action: "script.run", with: { path: "job.mjs", effect: "read", secrets: ["api"], ...options } },
  };
}

function assertNoSecret(f, runId, secret) {
  const text = JSON.stringify({
    run: f.runtime.getRun(runId),
    inbox: f.runtime.listInbox(),
    task: f.runtime.getTask("task"),
  });
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes(JSON.stringify(secret).slice(1, -1)), false);
}

test("successful HTTP outputs expose public response headers only", async (t) => {
  const f = await fixture(t, { secrets: { api: "header-private-token" } });
  const endpoint = await localHttp(t, (_request, response) => {
    response.sendDate = false;
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "2",
      "cache-control": "no-store",
      location: "/public-resource",
      "x-request-id": "request-public-123",
      "set-cookie": "session=server-private-cookie",
      authorization: "Bearer server-private-authorization",
      "proxy-authorization": "Bearer server-private-proxy",
      "x-api-key": "server-private-key",
      "x-internal-token": "server-private-token",
    });
    response.end("{}");
  });
  await f.enable(task(f.cwd, [http("read", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
  const run = await f.phase(f.start().runId, "succeeded");
  assert.equal(endpoint.requests[0].headers.authorization, "header-private-token");
  assert.deepEqual(run.steps[0].output.headers, {
    "cache-control": "no-store",
    "content-length": "2",
    "content-type": "application/json",
    location: "/public-resource",
    "x-request-id": "request-public-123",
  });
  await f.restart();
  assert.deepEqual(f.runtime.getRun(run.id).steps[0].output.headers, run.steps[0].output.headers);
});

test("HTTP secret echoes fail read attempts before any output is persisted", async (t) => {
  const secret = "http-echo-private-token";
  const f = await fixture(t, { secrets: { api: secret } });
  const endpoint = await localHttp(t, (request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ echo: request.headers.authorization }));
  });
  await f.enable(task(f.cwd, [http("echo", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
  const run = await settled(f, f.start().runId);
  assert.equal(run.phase, "failed");
  assert.equal(run.attempts[0].outcome, "rejected_before_commit");
  assert.equal(run.attempts[0].detail.code, "invalid_input");
  assert.equal(run.steps[0].output, null);
  assertNoSecret(f, run.id, secret);
  await f.restart();
  assertNoSecret(f, run.id, secret);
});

test("watch HTTP secret echoes are probe faults rather than unhealthy samples", async (t) => {
  const secret = "watch-private-token";
  const f = await fixture(t, { secrets: { api: secret } });
  let echo = true;
  const endpoint = await localHttp(t, (request, response) => {
    response.writeHead(echo ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ healthy: false, echo: request.headers.authorization }));
  });
  await f.enable(
    task(f.cwd, [duration()], {
      triggers: [
        {
          id: "watch",
          kind: "watch",
          every: "30s",
          probe: {
            action: "http.request",
            with: { url: { origin: endpoint.origin }, secretHeaders: { Authorization: "api" } },
          },
          mode: { type: "threshold", healthy: { ref: "probe.output.healthy", op: "eq", value: true }, consecutive: 2 },
        },
      ],
    }),
  );
  await f.advance(30000);
  await f.advance(30000);
  assert.equal(endpoint.requests.length, 2);
  assert.deepEqual(f.runtime.listRuns(), []);
  await f.restart();
  echo = false;
  await f.advance(30000);
  assert.deepEqual(f.runtime.listRuns(), []);
  await f.advance(30000);
  const run = await until(() => f.runtime.listRuns()[0]);
  await f.phase(run.id, "waiting");
  assertNoSecret(f, run.id, secret);
});

test("secret reader failures stop HTTP preparation without exposing the reader error", async (t) => {
  const secret = "reader-private-token";
  const f = await fixture(t);
  f.deps.secrets.read = async () => {
    throw new Error(`Authorization: ${secret}`);
  };
  const endpoint = await localHttp(t, (_request, response) => response.end("{}"));
  await f.enable(task(f.cwd, [http("read", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
  const run = await settled(f, f.start().runId);
  assert.equal(run.phase, "failed");
  assert.equal(run.attempts[0].outcome, "rejected_before_commit");
  assert.equal(run.attempts[0].detail.code, "missing_secret");
  assert.equal(run.attempts[0].detail.message, "Approved secret is unavailable");
  assert.equal(endpoint.requests.length, 0);
  assertNoSecret(f, run.id, secret);
  await f.restart();
  assertNoSecret(f, run.id, secret);
});

test("task validation rejects secret names with trailing newlines", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.runtime.saveTask(
      task(f.cwd, [http("read", "https://example.com", { secretHeaders: { Authorization: "api\n" } })]),
    ),
    /Invalid secret name/,
  );
  assert.deepEqual(f.runtime.listTasks(), []);
});

test("script stdout containing JSON-escaped secrets is rejected before persistence", async (t) => {
  const secret = 'script-"private\\token\n\tend';
  const f = await fixture(t, { secrets: { api: secret } });
  await f.enable(
    task(f.cwd, [
      script(f, "console.log(JSON.stringify({ echo: JSON.stringify(process.env.DEXON_SECRET_api).slice(1, -1) }));"),
    ]),
  );
  const run = await settled(f, f.start().runId);
  assert.equal(run.phase, "failed");
  assert.equal(run.attempts[0].outcome, "rejected_before_commit");
  assert.equal(run.attempts[0].detail.code, "invalid_input");
  assert.equal(run.steps[0].output, null);
  assertNoSecret(f, run.id, secret);
  await f.restart();
  assertNoSecret(f, run.id, secret);
});

for (const [effect, phase, outcome] of [
  ["unsafe", "attention", "outcome_unknown"],
  [{ idempotent: { window: "forever" } }, "backoff", "retryable_within_window"],
]) {
  test(`HTTP secret echoes preserve ${outcome} for dispatched writes`, async (t) => {
    const secret = "write-private-token";
    const f = await fixture(t, { secrets: { api: secret } });
    const endpoint = await localHttp(t, (request, response) => {
      response.setHeader("content-type", "text/plain");
      response.end(request.headers.authorization);
    });
    await f.enable(
      task(f.cwd, [
        http("write", endpoint.origin, { method: "POST", effect, secretHeaders: { Authorization: "api" } }),
      ]),
    );
    const run = await settled(f, f.start().runId);
    assert.equal(run.phase, phase);
    assert.equal(run.attempts[0].outcome, outcome);
    assert.equal(run.attempts[0].detail.code, "invalid_input");
    assert.equal(run.attempts[0].detail.maybeApplied, true);
    assert.equal(endpoint.requests.length, 1);
    assertNoSecret(f, run.id, secret);
    await f.restart();
    assertNoSecret(f, run.id, secret);
  });
}

for (const header of ["etag", "location", "x-request-id"]) {
  test(`HTTP public ${header} headers are checked for used secret echoes`, async (t) => {
    const secret = `${header}-private-token`;
    const f = await fixture(t, { secrets: { api: secret } });
    const endpoint = await localHttp(t, (request, response) => {
      response.setHeader(header, request.headers.authorization);
      response.end("public body");
    });
    await f.enable(task(f.cwd, [http("read", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
    const run = await settled(f, f.start().runId);
    assert.equal(run.phase, "failed");
    assert.equal(run.attempts[0].detail.code, "invalid_input");
    assertNoSecret(f, run.id, secret);
    await f.restart();
    assertNoSecret(f, run.id, secret);
  });
}

for (const [reported, effect, phase, outcome] of [
  ["stdout", "read", "failed", "rejected_before_commit"],
  ["stdout", "unsafe", "attention", "outcome_unknown"],
  ["not_applied", "read", "failed", "rejected_before_commit"],
  ["not_applied", "unsafe", "attention", "outcome_unknown"],
  ["maybe_applied", "unsafe", "attention", "outcome_unknown"],
]) {
  test(`script ${reported} secret echoes preserve ${outcome} under ${effect}`, async (t) => {
    const secret = "script-private-token";
    const f = await fixture(t, { secrets: { api: secret } });
    const source =
      reported === "stdout"
        ? "console.log(JSON.stringify({ echo: process.env.DEXON_SECRET_api }));"
        : `console.log(JSON.stringify({ __dexonEffect: ${JSON.stringify(reported)}, transient: true, message: process.env.DEXON_SECRET_api }));`;
    await f.enable(task(f.cwd, [script(f, source, { effect })]));
    const run = await settled(f, f.start().runId);
    assert.equal(run.phase, phase);
    assert.equal(run.attempts[0].outcome, outcome);
    assert.equal(run.attempts[0].detail.code, "invalid_input");
    assert.equal(run.attempts[0].detail.message, "Executor result contains an approved secret");
    assert.equal(run.steps[0].output, null);
    assertNoSecret(f, run.id, secret);
    await f.restart();
    assertNoSecret(f, run.id, secret);
  });
}

for (const reported of ["stdout", "not_applied", "maybe_applied"]) {
  test(`watch script ${reported} secret echoes do not advance unhealthy streaks`, async (t) => {
    const secret = 'probe-"private\\token\nend';
    const f = await fixture(t, { secrets: { api: secret } });
    const source =
      reported === "stdout"
        ? "console.log(JSON.stringify({ healthy: false, echo: process.env.DEXON_SECRET_api }));"
        : `console.log(JSON.stringify({ __dexonEffect: ${JSON.stringify(reported)}, message: JSON.stringify(process.env.DEXON_SECRET_api).slice(1, -1) }));`;
    const probe = script(f, source).call;
    await f.enable(
      task(f.cwd, [duration()], {
        triggers: [
          {
            id: "watch",
            kind: "watch",
            every: "30s",
            probe,
            mode: {
              type: "threshold",
              healthy: { ref: "probe.output.healthy", op: "eq", value: true },
              consecutive: 1,
            },
          },
        ],
      }),
    );
    await f.advance(30000);
    await f.restart();
    await f.advance(30000);
    assert.deepEqual(f.runtime.listRuns(), []);
    assert.deepEqual(f.runtime.listInbox(), []);
  });
}

test("watch item secret echoes are rejected before runs or deduplication state are persisted", async (t) => {
  const secret = "items-private-token";
  const f = await fixture(t, { secrets: { api: secret } });
  let echo = true;
  const endpoint = await localHttp(t, (request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        items: [{ id: "item-1", value: echo ? request.headers.authorization : "public" }],
        cursor: echo ? secret : "public-cursor",
      }),
    );
  });
  await f.enable(
    task(f.cwd, [duration()], {
      triggers: [
        {
          id: "items",
          kind: "watch",
          every: "30s",
          probe: {
            action: "http.request",
            with: { url: { origin: endpoint.origin }, secretHeaders: { Authorization: "api" } },
          },
          mode: { type: "items", itemsPath: "items", keyPath: "id", cursorPath: "cursor", emit: { startRun: {} } },
        },
      ],
    }),
  );
  await f.advance(30000);
  assert.deepEqual(f.runtime.listRuns(), []);
  await f.restart();
  echo = false;
  await f.advance(30000);
  const run = await until(() => f.runtime.listRuns()[0]);
  const waiting = await f.phase(run.id, "waiting");
  assert.deepEqual(waiting.input, { id: "item-1", value: "public" });
  assertNoSecret(f, run.id, secret);
});

for (const value of [null, ""]) {
  test(`unavailable ${JSON.stringify(value)} secret values are rejected before dispatch`, async (t) => {
    const f = await fixture(t, { secrets: { api: value } });
    const endpoint = await localHttp(t, (_request, response) => response.end("{}"));
    await f.enable(task(f.cwd, [http("read", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
    const run = await settled(f, f.start().runId);
    assert.equal(run.phase, "failed");
    assert.equal(run.attempts[0].outcome, "rejected_before_commit");
    assert.equal(run.attempts[0].detail.code, "missing_secret");
    assert.equal(endpoint.requests.length, 0);
  });
}

test("secret values not used by the attempt do not reject public output", async (t) => {
  const reads = [];
  const f = await fixture(t, { secrets: { api: "actual-private-token", unused: "true" } });
  const read = f.deps.secrets.read;
  f.deps.secrets.read = async (name) => {
    reads.push(name);
    return read(name);
  };
  const endpoint = await localHttp(t, (_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end('{"healthy":true}');
  });
  await f.enable(task(f.cwd, [http("read", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
  const run = await f.phase(f.start().runId, "succeeded");
  assert.deepEqual(run.steps[0].output.body, { healthy: true });
  assert.deepEqual(reads, ["api"]);
});

test("script input failures never persist the secret reader message", async (t) => {
  const secret = "script-reader-private-token";
  const f = await fixture(t);
  f.deps.secrets.read = async () => {
    throw new SyntaxError(`Secret storage parse failure: ${secret}`);
  };
  await f.enable(task(f.cwd, [script(f, "console.log(JSON.stringify({ ok: true }));")]));
  const run = await settled(f, f.start().runId);
  assert.equal(run.phase, "failed");
  assert.equal(run.attempts[0].detail.code, "missing_secret");
  assert.equal(run.attempts[0].detail.message, "Script input could not be prepared");
  assertNoSecret(f, run.id, secret);
});

test("script secret names use the shared validation rule", async (t) => {
  const f = await fixture(t);
  for (const name of ["UPPER", "api\n", "a".repeat(81), "", "space name"]) {
    const step = script(f, 'console.log("null");', { secrets: [name] });
    await assert.rejects(f.runtime.saveTask(task(f.cwd, [step])), /Invalid secret names/);
  }
  const saved = await f.enable(task(f.cwd, [script(f, 'console.log("null");', { secrets: ["api.v1_-valid"] })]));
  assert.deepEqual(saved.requiredGrant.secrets, ["api.v1_-valid"]);
});

test("HTTP preparation errors never include secret request headers", async (t) => {
  const secret = "header-private\ntoken";
  const f = await fixture(t, { secrets: { api: secret } });
  const endpoint = await localHttp(t, (_request, response) => response.end("{}"));
  await f.enable(task(f.cwd, [http("read", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
  const run = await settled(f, f.start().runId);
  assert.equal(run.phase, "failed");
  assert.deepEqual(run.attempts[0].detail, {
    code: "invalid_input",
    message: "HTTP request could not be prepared",
    maybeApplied: false,
  });
  assert.equal(endpoint.requests.length, 0);
  assertNoSecret(f, run.id, secret);
});

test("every used value remains protected when a secret name is read more than once", async (t) => {
  const first = "first-private-token";
  const second = "second-private-token";
  const f = await fixture(t);
  let reads = 0;
  f.deps.secrets.read = async () => (reads++ === 0 ? first : second);
  const endpoint = await localHttp(t, (request, response) => response.end(request.headers.authorization));
  await f.enable(
    task(f.cwd, [
      http("write", endpoint.origin, {
        method: "POST",
        effect: "unsafe",
        secretHeaders: { Authorization: "api" },
        body: { credential: { $secret: "api" } },
      }),
    ]),
  );
  const run = await settled(f, f.start().runId);
  assert.equal(run.phase, "attention");
  assert.equal(run.attempts[0].outcome, "outcome_unknown");
  assert.equal(reads, 2);
  assert.equal(endpoint.requests[0].headers.authorization, first);
  assert.deepEqual(JSON.parse(endpoint.requests[0].body), { credential: second });
  assertNoSecret(f, run.id, first);
  assertNoSecret(f, run.id, second);
});

test("watch reader failures are probe faults without requests or alarms", async (t) => {
  const f = await fixture(t);
  let reads = 0;
  f.deps.secrets.read = async () => {
    reads++;
    throw new Error("Authorization: watch-reader-private-token");
  };
  const endpoint = await localHttp(t, (_request, response) => response.end("{}"));
  await f.enable(
    task(f.cwd, [duration()], {
      triggers: [
        {
          id: "watch",
          kind: "watch",
          every: "30s",
          probe: {
            action: "http.request",
            with: { url: { origin: endpoint.origin }, secretHeaders: { Authorization: "api" } },
          },
          mode: { type: "threshold", healthy: { ref: "probe.ok", op: "eq", value: true }, consecutive: 1 },
        },
      ],
    }),
  );
  await f.advance(30000);
  await f.advance(30000);
  assert.equal(reads, 2);
  assert.equal(endpoint.requests.length, 0);
  assert.deepEqual(f.runtime.listRuns(), []);
});

test("runtime input and template substitutions never expand secret placeholders into approved secrets", async (t) => {
  const secret = "runtime-injection-guard-secret";
  const f = await fixture(t, { secrets: { api: secret } });
  const originA = await localHttp(t, (_request, response) => response.end('{"ok":true}'));
  const originB = await localHttp(t, (_request, response) => response.end('{"ok":true}'));
  await f.enable(
    task(f.cwd, [
      http("authorized", originA.origin, { secretHeaders: { Authorization: "api" } }),
      http("forward", originB.origin, {
        method: "POST",
        headers: { "x-note": { $tmpl: "note={{input.note}}" } },
        body: { raw: { $ref: "input.note" }, templated: { $tmpl: "val={{input.note}}" } },
      }),
    ]),
  );
  const run = await f.phase(f.start("task", { note: "{{secret:api}}" }).runId, "succeeded");
  assert.equal(run.phase, "succeeded");
  assert.equal(originA.requests[0].headers.authorization, secret);
  assert.equal(originB.requests[0].headers["x-note"], "note={{secret:api}}");
  assert.deepEqual(JSON.parse(originB.requests[0].body), {
    raw: "{{secret:api}}",
    templated: "val={{secret:api}}",
  });
});

test("secret echo guard ignores fixed observation metadata like applied", async (t) => {
  const f = await fixture(t, { secrets: { api: "applied" } });
  const endpoint = await localHttp(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  await f.enable(task(f.cwd, [http("call", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
  const run = await f.phase(f.start().runId, "succeeded");
  assert.equal(run.phase, "succeeded");
});
