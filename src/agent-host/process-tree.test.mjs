import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { getProcessStartFingerprint, parseLinuxProcessStatStartTime, terminateProcessTree } from "./process-tree.ts";

const POLL_INTERVAL_MS = 50;
const windowsSystemEntry = /[\\/]windows(?:[\\/]|$)/i;
const commandProcess = [
  'const { spawn } = require("node:child_process");',
  'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore", windowsHide: true });',
  'process.stdout.write(String(grandchild.pid) + "\\n");',
  "setInterval(() => {}, 1000);",
].join("\n");

function windowsPathKeys() {
  return Object.keys(process.env).filter((name) => name.toLowerCase() === "path");
}

function withoutWindowsSystemPath() {
  const saved = new Map();
  for (const name of windowsPathKeys()) {
    saved.set(name, process.env[name]);
    process.env[name] = (process.env[name] ?? "")
      .split(";")
      .filter((entry) => !windowsSystemEntry.test(entry))
      .join(";");
  }
  return () => {
    for (const [name, value] of saved) process.env[name] = value;
  };
}

function remainingWindowsSystemEntries() {
  return windowsPathKeys().flatMap((name) =>
    (process.env[name] ?? "").split(";").filter((entry) => windowsSystemEntry.test(entry)),
  );
}

function isAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function waitUntilGone(processId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(processId)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return true;
}

function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const onData = (chunk) => {
      buffered += chunk.toString();
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      stream.off("data", onData);
      resolve(buffered.slice(0, newline).trim());
    };
    stream.on("data", onData);
    stream.once("error", reject);
    stream.once("close", () => reject(new Error("the command process reported no grandchild")));
  });
}

test("parses Linux proc stat start time even when comm contains spaces and parentheses", () => {
  const prefix = "4321 (worker ) with spaces)";
  const fields = [
    "S",
    "1",
    "4321",
    "4321",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "987654",
  ];
  assert.equal(parseLinuxProcessStatStartTime(`${prefix} ${fields.join(" ")}`), "987654");
  assert.equal(parseLinuxProcessStatStartTime("malformed"), null);
  assert.equal(parseLinuxProcessStatStartTime("1 (x) S 1 2"), null);
});

test("reads a stable fingerprint for the current POSIX process", async () => {
  if (process.platform === "win32") return;
  const first = await getProcessStartFingerprint(process.pid);
  const second = await getProcessStartFingerprint(process.pid);
  assert.ok(first);
  assert.equal(second, first);
  if (process.platform === "linux") assert.match(first, /^linux:[a-f0-9-]{36}:\d+$/u);
});

test("terminating a process tree still ends the whole tree when PATH lacks System32", async (t) => {
  if (process.platform !== "win32") {
    t.skip("process trees are terminated by taskkill.exe only on Windows");
    return;
  }
  const restorePath = withoutWindowsSystemPath();
  assert.deepEqual(remainingWindowsSystemEntries(), []);
  const child = spawn(process.execPath, ["-e", commandProcess], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  try {
    assert.ok(child.pid);
    const grandchildProcessId = Number(await firstLine(child.stdout));
    assert.ok(Number.isSafeInteger(grandchildProcessId) && grandchildProcessId > 0);
    assert.equal(isAlive(grandchildProcessId), true);
    await terminateProcessTree(child, 3_000);
    assert.ok(await waitUntilGone(child.pid, 10_000), "the command process must exit");
    assert.ok(await waitUntilGone(grandchildProcessId, 10_000), "the grandchild must exit with the tree");
  } finally {
    restorePath();
    if (child.pid && isAlive(child.pid)) child.kill("SIGKILL");
  }
});
