import assert from "node:assert/strict";
import test from "node:test";
import { assertSmokeCompletion } from "../src/smoke/result.ts";

const successfulExit = { code: 0, signal: null, pid: 42 };

test("a zero-exit smoke process without completion evidence is rejected", () => {
  assert.throws(() => assertSmokeCompletion(successfulExit, undefined), /without completing/);
});

test("only an explicit completed result is accepted", () => {
  for (const report of [{}, { completed: false }, { completed: "true" }, []]) {
    assert.throws(() => assertSmokeCompletion(successfulExit, report), /without completing/);
  }
  assert.doesNotThrow(() => assertSmokeCompletion(successfulExit, { completed: true, pid: 42 }));
});

test("completion evidence must belong to the process that was launched", () => {
  assert.throws(() => assertSmokeCompletion(successfulExit, { completed: true, pid: 7 }), /another process/);
});

test("a renderer check must complete every required scene, not merely exit successfully", () => {
  const report = { completed: true, pid: 42, pass: true, records: [] };
  assert.throws(() => assertSmokeCompletion(successfulExit, report, ["chat-composer"]), /chat-composer/);
  const complete = { ...report, records: [{ name: "chat-composer", pass: true }] };
  assert.doesNotThrow(() => assertSmokeCompletion(successfulExit, complete, ["chat-composer"]));
  assert.throws(() => assertSmokeCompletion(successfulExit, { ...complete, pass: false }, ["chat-composer"]), /failed/);
  assert.throws(
    () =>
      assertSmokeCompletion(successfulExit, { ...complete, records: [{ name: "chat-composer", pass: false }] }, [
        "chat-composer",
      ]),
    /chat-composer/,
  );
});

test("a failed or terminated process is rejected even if it wrote a completed result", () => {
  const report = { completed: true, pid: 42 };
  assert.throws(() => assertSmokeCompletion({ ...successfulExit, code: 1 }, report), /status 1/);
  assert.throws(() => assertSmokeCompletion({ ...successfulExit, code: null, signal: "SIGTERM" }, report), /SIGTERM/);
});

test("an explicit failed native result cannot certify a completed check", () => {
  assert.throws(() => assertSmokeCompletion(successfulExit, { completed: true, pid: 42, pass: false }), /failed/);
});
