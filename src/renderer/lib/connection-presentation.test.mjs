import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { useConnectionLabel } = await importTestBundle("connection-labels", {
  entryPoints: [path.join(import.meta.dirname, "connection-labels.ts")],
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react"],
});

const { presentConnection } = await importTestBundle("connection-presentation", {
  entryPoints: [path.join(import.meta.dirname, "connection-presentation.ts")],
});

function environment(status, overrides = {}) {
  return {
    id: "gpu-server",
    label: "Training server",
    enabled: true,
    target: { kind: "ssh", sshAlias: "gpu-train" },
    status,
    descriptor: null,
    ...overrides,
  };
}

const now = 10_000;

for (const target of [
  { kind: "ssh", sshAlias: "gpu-train" },
  { kind: "websocket", url: "wss://gpu.example" },
]) {
  test(`an available ${target.kind} environment still needs connecting before sending`, () => {
    assert.deepEqual(presentConnection(environment({ phase: "available" }, { target }), now), {
      tone: "offline",
      status: { kind: "available", label: "Available" },
      step: null,
      progress: null,
      countdown: null,
      canSend: false,
      primaryAction: "connect",
      diagnosis: null,
    });
  });
}

test("the primary available environment can send before its first connection snapshot", () => {
  const view = environment({ phase: "available" }, { id: "primary", target: { kind: "primary" } });
  assert.deepEqual(presentConnection(view, now), {
    tone: "online",
    status: { kind: "available", label: "Available" },
    step: null,
    progress: null,
    countdown: null,
    canSend: true,
    primaryAction: null,
    diagnosis: null,
  });
});

test("a connected environment is online and can send without a recovery action", () => {
  const view = environment({ phase: "connected", generation: 7, since: 500 });
  assert.deepEqual(presentConnection(view, now), {
    tone: "online",
    status: { kind: "connected", label: "Online" },
    step: null,
    progress: null,
    countdown: null,
    canSend: true,
    primaryAction: null,
    diagnosis: null,
  });
});

test("a disabled environment never permits sending even with a usable status", () => {
  for (const status of [{ phase: "connected", generation: 7, since: 500 }, { phase: "available" }]) {
    const view = environment(status, { enabled: false, target: { kind: "primary" }, id: "primary" });
    assert.equal(presentConnection(view, now).canSend, false);
  }
});

test("connecting reports the four provisioning steps and blocks sending without a duplicate connect action", () => {
  for (const [stage, step] of [
    ["authenticating", 1],
    ["checking-runtime", 2],
    ["deploying", 3],
    ["starting-daemon", 4],
    ["verifying", 4],
    ["opening", 4],
    ["synchronizing", 4],
  ]) {
    const view = environment({ phase: "connecting", stage, attempt: 2, progress: null });
    assert.deepEqual(
      presentConnection(view, now),
      {
        tone: "pending",
        status: { kind: "connecting", label: "Connecting" },
        step,
        progress: null,
        countdown: null,
        canSend: false,
        primaryAction: null,
        diagnosis: null,
      },
      stage,
    );
  }
});

test("deployment progress is a bounded fraction and invalid measurements remain unknown", () => {
  for (const [progress, expected] of [
    [0, 0],
    [0.68, 0.68],
    [1, 1],
    [-0.2, 0],
    [1.5, 1],
    [null, null],
    [NaN, null],
    [Infinity, null],
    [-Infinity, null],
  ]) {
    const view = environment({ phase: "connecting", stage: "deploying", attempt: 1, progress });
    assert.equal(presentConnection(view, now).progress, expected, String(progress));
  }
});

test("backoff offers immediate reconnect and counts whole seconds without going negative", () => {
  const view = environment({
    phase: "backoff",
    reason: "network",
    detail: "The connection was interrupted",
    retryAt: 12_001,
    failureCount: 3,
  });
  assert.deepEqual(presentConnection(view, now), {
    tone: "pending",
    status: { kind: "backoff", label: "Reconnecting" },
    step: null,
    progress: null,
    countdown: 3,
    canSend: false,
    primaryAction: "reconnect-now",
    diagnosis: null,
  });
  for (const [timestamp, expected] of [
    [11_001, 1],
    [12_000, 1],
    [12_001, 0],
    [13_000, 0],
  ]) {
    assert.equal(presentConnection(view, timestamp).countdown, expected);
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(presentConnection(view, invalid).countdown, 0);
    assert.equal(presentConnection({ ...view, status: { ...view.status, retryAt: invalid } }, now).countdown, 0);
  }
});

test("offline environments cannot send and offer an explicit connect instead of a retry timer", () => {
  for (const lastFailure of [null, { reason: "timeout", detail: "Server did not respond" }]) {
    const view = environment({ phase: "offline", lastFailure });
    assert.deepEqual(presentConnection(view, now), {
      tone: "offline",
      status: { kind: "offline", label: "Offline" },
      step: null,
      progress: null,
      countdown: null,
      canSend: false,
      primaryAction: "connect",
      diagnosis: null,
    });
    assert.equal(presentConnection({ ...view, id: "primary", target: { kind: "primary" } }, now).canSend, false);
  }
});

test("blocked environments open settings and preserve the complete diagnosis without changing the snapshot", () => {
  const diagnosis = Object.freeze({
    reason: "host-key-changed",
    detail: "The server key differs from the saved key",
    knownHost: "[gpu.example]:2222",
    fingerprint: "SHA256:server-key",
    knownHostsFile: "/home/alex/.ssh/known_hosts",
    mismatchLayer: "ssh-known-hosts",
  });
  const view = Object.freeze(environment(Object.freeze({ phase: "blocked", diagnosis })));
  const before = structuredClone(view);
  const result = presentConnection(view, now);
  assert.deepEqual(result, {
    tone: "blocked",
    status: { kind: "blocked", label: "Needs attention" },
    step: null,
    progress: null,
    countdown: null,
    canSend: false,
    primaryAction: "open-settings",
    diagnosis,
  });
  assert.equal(result.diagnosis, diagnosis);
  assert.deepEqual(view, before);
  assert.deepEqual(presentConnection(view, now + 1_000), result);
});

test("the UI status label is selected by phase rather than treating domain text as a translation key", () => {
  for (const [kind, expected] of [
    ["available", "Available"],
    ["connected", "Online"],
    ["connecting", "Connecting"],
    ["backoff", "Reconnecting"],
    ["offline", "Offline"],
    ["blocked", "Needs attention"],
  ]) {
    const presentation = {
      ...presentConnection(environment({ phase: "available" }), now),
      status: { kind, label: "Untranslated domain text" },
    };
    function StatusLabel() {
      return useConnectionLabel(presentation);
    }
    assert.equal(renderToStaticMarkup(createElement(StatusLabel)), expected, kind);
  }
});
