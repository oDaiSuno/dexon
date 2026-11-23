import assert from "node:assert/strict";
import test from "node:test";

import { parseAutomationCommand } from "./automation-commands.ts";
import { isAutomationSecretName, isAutomationSecretValue } from "../shared/automation/secret-name.ts";

const enableTask = {
  type: "enable-task",
  environmentId: "remote-1",
  taskId: "task-1",
  revision: 1,
  planHash: "aB09".repeat(16),
};

test("enable commands validate target identity and revision and discard unrecognized fields", () => {
  const input = { ...enableTask, revision: Number.MAX_SAFE_INTEGER, ignored: "discard me" };
  const parsed = parseAutomationCommand(input);
  assert.deepEqual(parsed, { ...enableTask, revision: Number.MAX_SAFE_INTEGER });
  assert.notEqual(parsed, input);
  input.taskId = "changed";
  assert.equal(parsed.taskId, "task-1");

  for (const value of [null, undefined, false, "enable-task", [], {}, { ...enableTask, type: "unknown" }]) {
    assert.throws(() => parseAutomationCommand(value), /Invalid automation command/);
  }
  for (const field of ["environmentId", "taskId"]) {
    for (const value of [undefined, null, 1, "", " ", "x\0y", "x\ny", "x\ry", "x".repeat(257)]) {
      assert.throws(() => parseAutomationCommand({ ...enableTask, [field]: value }), /Invalid automation command/);
    }
  }
  for (const revision of [undefined, "1", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseAutomationCommand({ ...enableTask, revision }), /Invalid automation command/);
  }
  for (const planHash of [undefined, 1, "", "a".repeat(63), "a".repeat(65), "g".repeat(64), "a".repeat(64) + "\n"]) {
    assert.throws(() => parseAutomationCommand({ ...enableTask, planHash }), /Invalid automation command/);
  }
});

test("attention commands validate resolution fields and return an independent clean request", () => {
  const request = {
    runId: "run-1",
    stepIndex: 0,
    expectedVersion: 1,
    requestId: "request-1",
    requestDigest: "digest-1",
    resolution: { kind: "attention", action: "retry", output: { nested: [null, true, 42, { text: "value" }] } },
  };
  const command = { type: "resolve-attention", environmentId: "remote-1", request };
  const parsed = parseAutomationCommand({
    ...command,
    ignored: true,
    request: { ...request, ignored: true, resolution: { ...request.resolution, ignored: true } },
  });
  assert.deepEqual(parsed, command);
  assert.notEqual(parsed.request, request);
  assert.notEqual(parsed.request.resolution, request.resolution);
  assert.notEqual(parsed.request.resolution.output, request.resolution.output);
  request.resolution.output.nested[3].text = "changed";
  assert.equal(parsed.request.resolution.output.nested[3].text, "value");

  for (const action of ["mark_succeeded", "retry", "mark_failed", "confirm_cancelled"]) {
    const input = {
      ...command,
      request: { ...request, resolution: { kind: "attention", action } },
    };
    assert.deepEqual(parseAutomationCommand(input), input);
  }
  const invalidRequests = [
    undefined,
    null,
    [],
    { ...request, runId: "" },
    { ...request, requestId: "" },
    { ...request, requestDigest: 42 },
    { ...request, stepIndex: -1 },
    { ...request, stepIndex: 0.5 },
    { ...request, stepIndex: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, expectedVersion: 0 },
    { ...request, expectedVersion: 1.5 },
    { ...request, expectedVersion: Infinity },
    { ...request, resolution: undefined },
    { ...request, resolution: { kind: "approval", approved: true } },
    { ...request, resolution: { kind: "attention", action: "unknown" } },
    { ...request, resolution: { kind: "attention", action: ["retry"] } },
  ];
  for (const invalidRequest of invalidRequests) {
    assert.throws(() => parseAutomationCommand({ ...command, request: invalidRequest }), /Invalid automation command/);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  let sharedDag = null;
  for (let i = 0; i < 16; i += 1) sharedDag = [sharedDag, sharedDag];
  for (const output of [
    NaN,
    Infinity,
    { value: undefined },
    { value: () => {} },
    cyclic,
    sharedDag,
    new Date(),
    new Map(),
  ]) {
    assert.throws(
      () =>
        parseAutomationCommand({
          ...command,
          request: { ...request, resolution: { kind: "attention", action: "retry", output } },
        }),
      /Invalid automation command/,
    );
  }
});

test("secret commands require a valid name and limit non-empty values by UTF-8 bytes", () => {
  for (const name of ["a", "api.key_1-2", "a".repeat(80)]) {
    assert.equal(isAutomationSecretName(name), true);
    const input = { type: "set-secret", environmentId: "remote-1", name, value: "secret", ignored: true };
    assert.deepEqual(parseAutomationCommand(input), {
      type: "set-secret",
      environmentId: "remote-1",
      name,
      value: "secret",
    });
    assert.deepEqual(parseAutomationCommand({ type: "delete-secret", environmentId: "remote-1", name }), {
      type: "delete-secret",
      environmentId: "remote-1",
      name,
    });
  }
  for (const name of [undefined, null, 1, "", "UPPER", "a/b", "a b", "a".repeat(81), "api-key\n"]) {
    assert.equal(isAutomationSecretName(name), false);
    for (const type of ["set-secret", "delete-secret"]) {
      assert.throws(
        () => parseAutomationCommand({ type, environmentId: "remote-1", name, value: "secret" }),
        /Invalid automation command/,
      );
    }
  }
  for (const value of [" ", "x".repeat(65_536), "é".repeat(32_768), "😀".repeat(16_384)]) {
    assert.equal(isAutomationSecretValue(value), true);
    const command = { type: "set-secret", environmentId: "remote-1", name: "api-key", value };
    assert.deepEqual(parseAutomationCommand(command), command);
  }
  for (const value of [undefined, null, 1, {}, "", "x".repeat(65_537), "é".repeat(32_769), "😀".repeat(16_385)]) {
    assert.equal(isAutomationSecretValue(value), false);
    assert.throws(
      () => parseAutomationCommand({ type: "set-secret", environmentId: "remote-1", name: "api-key", value }),
      /Invalid automation command/,
    );
  }
  assert.deepEqual(parseAutomationCommand({ type: "list-secret-names", environmentId: "remote-1", ignored: true }), {
    type: "list-secret-names",
    environmentId: "remote-1",
  });
});
