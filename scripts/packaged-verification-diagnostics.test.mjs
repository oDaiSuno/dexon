import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  describeManagedProcessHelperIntegrationFailure,
  describePackagedStartupFailure,
  lastProgressStep,
} from "./packaged-verification-diagnostics.mjs";

function withIsolatedRoot(visit) {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-packaged-diagnostics-"));
  try {
    visit(isolatedRoot);
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

function writeLines(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

test("a startup that exits 127 after writing an ok report names the status, the report and only the newest log lines", () => {
  withIsolatedRoot((isolatedRoot) => {
    const userData = path.join(isolatedRoot, "user-data");
    writeLines(path.join(userData, "packaged-startup-check.json"), ['{ "ok": true, "platformArch": "linux-x64" }']);
    const logLines = Array.from({ length: 60 }, (_, index) => `main log line ${String(index + 1).padStart(3, "0")}`);
    writeLines(path.join(userData, "logs", "main.log"), logLines);

    const message = describePackagedStartupFailure({
      result: { status: 127, signal: null, stdout: "probe booted\n", stderr: "Failed to remove /tmp/x\n" },
      isolatedRoot,
    });

    assert.match(message, /exited 127/u);
    assert.match(message, /packaged-startup-check\.json[^\n]*ok: true/u);
    assert.ok(message.includes("main log line 060"), message);
    assert.ok(message.includes("main log line 021"), message);
    assert.ok(!message.includes("main log line 020"), message);
    assert.ok(message.includes("probe booted"), message);
    assert.ok(message.includes("Failed to remove /tmp/x"), message);
  });
});

test("a startup that dies before writing anything reports the missing report and the missing log", () => {
  withIsolatedRoot((isolatedRoot) => {
    const message = describePackagedStartupFailure({
      result: { status: 127, signal: null, stdout: "", stderr: "" },
      isolatedRoot,
    });

    assert.match(message, /packaged-startup-check\.json[^\n]*not written/u);
    assert.match(message, /main\.log[^\n]*not found/u);
  });
});

test("a report truncated by the crash is described as unreadable instead of throwing", () => {
  withIsolatedRoot((isolatedRoot) => {
    fs.mkdirSync(path.join(isolatedRoot, "user-data"), { recursive: true });
    fs.writeFileSync(path.join(isolatedRoot, "user-data", "packaged-startup-check.json"), '{\n  "ok": tru');

    const message = describePackagedStartupFailure({
      result: { status: 127, signal: null, stdout: "", stderr: "" },
      isolatedRoot,
    });

    assert.match(message, /packaged-startup-check\.json[^\n]*unreadable/u);
  });
});

test("a report without a boolean ok field is described as malformed", () => {
  withIsolatedRoot((isolatedRoot) => {
    fs.mkdirSync(path.join(isolatedRoot, "user-data"), { recursive: true });
    fs.writeFileSync(
      path.join(isolatedRoot, "user-data", "packaged-startup-check.json"),
      '{"platformArch":"linux-x64","rendererReady":true}',
    );

    const message = describePackagedStartupFailure({
      result: { status: 127, signal: null, stdout: "", stderr: "" },
      isolatedRoot,
    });

    assert.match(message, /packaged-startup-check\.json[^\n]*malformed/u);
  });
});

test("a startup killed by a signal names the signal instead of reporting a null exit status", () => {
  withIsolatedRoot((isolatedRoot) => {
    const message = describePackagedStartupFailure({
      result: { status: null, signal: "SIGKILL", stdout: "", stderr: "" },
      isolatedRoot,
    });

    assert.match(message, /SIGKILL/u);
    assert.doesNotMatch(message, /exited null/u);
  });
});

test("a report that says ok false is quoted with the error the app recorded", () => {
  withIsolatedRoot((isolatedRoot) => {
    fs.mkdirSync(path.join(isolatedRoot, "user-data"), { recursive: true });
    fs.writeFileSync(
      path.join(isolatedRoot, "user-data", "packaged-startup-check.json"),
      JSON.stringify({ ok: false, error: "Agent Host startup timed out" }),
    );

    const message = describePackagedStartupFailure({
      result: { status: 1, signal: null, stdout: "", stderr: "" },
      isolatedRoot,
    });

    assert.match(message, /ok: false/u);
    assert.ok(message.includes("Agent Host startup timed out"), message);
  });
});

test("a startup that could not even be spawned still reports the report and the log it left behind", () => {
  withIsolatedRoot((isolatedRoot) => {
    fs.mkdirSync(path.join(isolatedRoot, "AppData", "Roaming", "Dexon"), { recursive: true });
    fs.writeFileSync(
      path.join(isolatedRoot, "AppData", "Roaming", "Dexon", "packaged-startup-check.json"),
      '{"ok":true}',
    );
    writeLines(path.join(isolatedRoot, "Home", "Library", "Logs", "Dexon", "main.log"), ["quit cleanup failed"]);

    const message = describePackagedStartupFailure({
      result: {
        status: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("spawnSync /tmp/dexon ETIMEDOUT"), { code: "ETIMEDOUT" }),
      },
      isolatedRoot,
      timeoutMs: 60_000,
    });

    assert.match(message, /spawnSync \/tmp\/dexon ETIMEDOUT/u);
    assert.match(message, /packaged-startup-check\.json[^\n]*ok: true/u);
    assert.ok(message.includes("quit cleanup failed"), message);
  });
});

test("the last reported progress step wins when the integration reports several", () => {
  const stdout = [
    '{"progress":"identity-uncertain-port-timeout"}',
    "scenario output that is not JSON",
    '{"progress":"windows-containment","status":"running"}',
    '{"progress":"graceful-stop"}',
  ].join("\n");

  assert.equal(lastProgressStep(stdout), "graceful-stop");
});

test("progress parsing skips noise that is not JSON or has no progress field", () => {
  const stdout = [
    "started container",
    '{"progress":',
    '{"ok":false,"error":"crashed"}',
    '{"progress":"helper-ready"}',
    "still running",
  ].join("\n");

  assert.equal(lastProgressStep(stdout), "helper-ready");
});

test("the final ok report line is not mistaken for a progress step", () => {
  const stdout = [
    '{"progress":"reaper-identity-fail-closed"}',
    '{"ok":true,"scenarios":["reaper-identity-fail-closed"]}',
  ].join("\n");

  assert.equal(lastProgressStep(stdout), "reaper-identity-fail-closed");
});

test("an integration that printed nothing reports no progress step", () => {
  assert.equal(lastProgressStep(""), undefined);
  assert.equal(lastProgressStep(undefined), undefined);
});

test("an integration that times out names the step it reached and the timeout", () => {
  const message = describeManagedProcessHelperIntegrationFailure({
    result: {
      status: null,
      signal: "SIGTERM",
      stdout: '{"progress":"windows-containment"}\n',
      stderr: "EBUSY: resource busy or locked",
      error: Object.assign(new Error("spawnSync node ETIMEDOUT"), { code: "ETIMEDOUT" }),
    },
    timeoutMs: 180_000,
  });

  assert.match(message, /windows-containment/u);
  assert.match(message, /180000/u);
  assert.ok(message.includes("EBUSY: resource busy or locked"), message);
});

test("an integration that fails before reporting any progress says so and keeps the error output", () => {
  const message = describeManagedProcessHelperIntegrationFailure({
    result: { status: 1, signal: null, stdout: "noise\n", stderr: "helper exited early" },
  });

  assert.match(message, /no progress reported/u);
  assert.ok(message.includes("helper exited early"), message);
  assert.match(message, /exited 1/u);
});
