import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { on } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function hostMessage(child, predicate) {
  for await (const [message] of on(child, "message", { signal: globalThis.AbortSignal.timeout(10_000) })) {
    if (predicate(message)) return message;
  }
}

async function watchdog(t, realChild = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-watchdog-"));
  const fixture = path.join(directory, "host.mjs");
  const blocker = path.join(directory, "block");
  const api = await importTestBundle(
    "host-watchdog",
    {
      stdin: {
        contents:
          'export { HostManager } from "./host-manager.ts"; export { children } from "electron"; export { flushMainLog } from "./logger.ts"; export { HostActivity } from "../agent-host/host-activity.ts"; export const moduleUrl = import.meta.url;',
        resolveDir: import.meta.dirname,
        loader: "ts",
      },
      plugins: [
        {
          name: "electron-process-boundary",
          setup(builder) {
            builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "watchdog" }));
            builder.onLoad({ filter: /.*/, namespace: "watchdog" }, () => ({
              contents: `
              import { EventEmitter } from "node:events";
              import { fork } from "node:child_process";
              export const children = [];
              export const app = { isPackaged: true, getPath: () => ${JSON.stringify(directory)}, getVersion: () => "test" };
              export class MessageChannelMain {}
              export const utilityProcess = { fork(entry, args, options) {
                const child = ${realChild} ? fork(entry, args, { env: options.env, silent: true }) : new EventEmitter();
                if (!${realChild}) child.pid = 4000 + children.length;
                const kill = ${realChild} ? child.kill.bind(child) : () => child.emit("exit", 1);
                child.messages = [];
                child.kills = 0;
                child.postMessage = (message) => {
                  child.messages.push(message);
                  if (${realChild}) child.send(message);
                };
                child.kill = () => { child.kills += 1; kill(); }; 
                children.push(child);
                return child;
              } };
            `,
              loader: "js",
            }));
          },
        },
      ],
    },
    { registerCleanup: (cleanup) => t.after(cleanup) },
  );
  if (realChild)
    writeFileSync(
      fixture,
      `
    import { existsSync } from "node:fs";
    import { HostActivity } from ${JSON.stringify(api.moduleUrl)};
    const activity = new HostActivity({ post: (message) => process.send(message) });
    const wait = new Int32Array(new SharedArrayBuffer(4));
    process.on("message", (message) => {
      if (message.type === "ping") process.send(activity.pong(message.seq));
      if (message.type === "shutdown") {
        activity.dispose();
        process.exit(0);
      }
      if (message.type === "block") {
        activity.observe({ running: [], starting: [], [message.work]: ["real-session"] });
        setImmediate(() => {
          process.send({ type: "log", message: "blocking" });
          while (existsSync(${JSON.stringify(blocker)})) Atomics.wait(wait, 0, 0, 10);
          setTimeout(() => {
            activity.observe({ running: [], starting: [] });
            process.send(activity.pong(0));
          }, 60);
        });
      }
    });
    setTimeout(() => process.send({ type: "ready", ts: Date.now(), piVersion: "test" }), 25);
  `,
    );
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 1_000_000 });
  const manager = new api.HostManager(fixture);
  const statuses = [];
  manager.setStatusListener((status) => statuses.push(status));
  manager.start();
  const ready = (child) => child.emit("message", { type: "ready", ts: Date.now(), piVersion: "test" });
  const child = api.children[0];
  t.after(async () => {
    rmSync(blocker, { force: true });
    const stopped = manager.stop();
    if (!realChild) api.children.at(-1)?.emit("exit", 0);
    await stopped;
    await api.flushMainLog();
    rmSync(directory, { recursive: true, force: true });
  });
  if (realChild) await hostMessage(child, (message) => message.type === "ready");
  else ready(child);
  return {
    ...api,
    manager,
    child,
    ready,
    statuses,
    async block(work) {
      writeFileSync(blocker, "blocked");
      const entered = hostMessage(child, (message) => message.type === "log" && message.message === "blocking");
      child.postMessage({ type: "block", work });
      await entered;
    },
    async unblock() {
      const resumed = hostMessage(child, (message) => message.type === "pong" && message.seq === 0);
      rmSync(blocker, { force: true });
      return resumed;
    },
    async diagnostics() {
      await api.flushMainLog();
      return readFileSync(path.join(directory, "main.log"), "utf8")
        .split("\n")
        .filter((line) => line.includes("agent-host watchdog "))
        .map((line) => JSON.parse(line.slice(line.indexOf("agent-host watchdog ") + "agent-host watchdog ".length)));
    },
    async tick(ms) {
      t.mock.timers.tick(ms);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test("an idle silent host receives shutdown before a forced kill and crash recovery", async (t) => {
  const h = await watchdog(t);
  assert.equal(h.manager.getGeneration(), 1);
  assert.equal(h.manager.getReadySince(), 1_000_000);
  await h.tick(15_000);
  await h.tick(15_000);
  assert.equal(h.child.messages.at(-1)?.type, "shutdown");
  assert.equal(h.child.kills, 0);
  await h.tick(1499);
  assert.equal(h.child.kills, 0);
  await h.tick(1);
  assert.equal(h.child.kills, 1);
  await h.tick(500);
  assert.equal(h.children.length, 2);
  h.ready(h.children[1]);
  assert.equal(h.manager.getStatus(), "ready");
  assert.equal(h.manager.getGeneration(), 2);
  const [timeout] = await h.diagnostics();
  assert.equal(timeout.reason, "ping-timeout");
  assert.equal(timeout.atStake, 0);
});

for (const work of ["starting", "running"]) {
  test(`a ${work} session survives 30 seconds of silence and recovers without UI errors`, async (t) => {
    const h = await watchdog(t);
    const activity = { running: [], starting: [], [work]: ["session-a"] };
    h.child.emit("message", {
      type: "pong",
      seq: 0,
      ts: Date.now(),
      lagMaxMs: 42,
      activity: work === "starting" ? { running: [], starting: [] } : activity,
    });
    if (work === "starting") h.child.emit("message", { type: "activity", activity });
    await h.tick(15_000);
    await h.tick(15_000);
    assert.equal(h.child.kills, 0);
    assert.equal(
      h.child.messages.some((message) => message.type === "shutdown"),
      false,
    );
    assert.equal(h.manager.getStatus(), "ready");
    assert.deepEqual(h.statuses, ["starting", "ready"]);
    const [stall] = await h.diagnostics();
    assert.deepEqual(stall, {
      reason: "stalled",
      silentMs: 30_000,
      atStake: 1,
      running: activity.running,
      starting: activity.starting,
      lastLagMs: 42,
      pid: h.child.pid,
    });
    await h.tick(15_000);
    assert.equal((await h.diagnostics()).length, 1);
    h.child.emit("message", { type: "pong", seq: 3, ts: Date.now(), lagMaxMs: 30_000, activity });
    await h.tick(15_000);
    assert.equal(h.child.kills, 0);
    assert.equal(h.children.length, 1);
    assert.equal(h.manager.getGeneration(), 1);
    await h.tick(15_000);
    assert.equal((await h.diagnostics()).length, 2);
  });
}

test("sleep resets the heartbeat baseline instead of killing a healthy host", async (t) => {
  const h = await watchdog(t);
  t.mock.timers.setTime(Date.now() + 300_000);
  await h.tick(15_000);
  assert.equal(h.child.kills, 0);
  h.child.emit("message", {
    type: "pong",
    seq: 1,
    ts: Date.now(),
    lagMaxMs: 0,
    activity: { running: [], starting: [] },
  });
  await h.tick(15_000);
  assert.equal(h.child.kills, 0);
  assert.equal(h.manager.getStatus(), "ready");
});

test("an active host exhausts its grace before shutdown and resets activity after restart", async (t) => {
  const h = await watchdog(t);
  h.child.emit("message", { type: "activity", activity: { running: ["a"], starting: ["b"] } });
  for (let elapsed = 15_000; elapsed <= 135_000; elapsed += 15_000) await h.tick(15_000);
  assert.equal(h.child.kills, 0);
  assert.equal(
    h.child.messages.some((message) => message.type === "shutdown"),
    false,
  );
  assert.equal((await h.diagnostics()).length, 1);
  await h.tick(15_000);
  assert.equal(h.child.messages.at(-1).type, "shutdown");
  assert.equal(h.child.kills, 0);
  await h.tick(1500);
  assert.equal(h.child.kills, 1);
  await h.tick(500);
  const next = h.children[1];
  h.ready(next);
  await h.tick(15_000);
  await h.tick(15_000);
  assert.equal(next.messages.at(-1).type, "shutdown");
  const diagnostics = await h.diagnostics();
  assert.equal(diagnostics[1].atStake, 2);
  assert.equal(diagnostics[1].reason, "ping-timeout");
  assert.equal(diagnostics[2].atStake, 0);
  assert.equal(diagnostics[2].lastLagMs, 0);
});

test("clean shutdown during the grace period never kills the replacement host", async (t) => {
  const h = await watchdog(t);
  await h.tick(15_000);
  await h.tick(15_000);
  assert.equal(h.child.messages.at(-1).type, "shutdown");
  h.child.emit("exit", 0);
  await h.tick(0);
  await h.tick(500);
  const next = h.children[1];
  h.ready(next);
  await h.tick(1000);
  assert.equal(h.child.kills, 0);
  assert.equal(next.kills, 0);
  assert.equal(h.manager.getGeneration(), 2);
});

for (const work of ["starting", "running"]) {
  test(`a real IPC child reports ${work} before blocking and survives 30 seconds on the main clock`, async (t) => {
    const h = await watchdog(t, true);
    await h.block(work);
    await h.tick(15_000);
    await h.tick(15_000);
    const [stall] = await h.diagnostics();
    assert.equal(stall.silentMs, 30_000);
    assert.equal(stall.atStake, 1);
    assert.deepEqual(stall[work], ["real-session"]);
    assert.equal(typeof stall.lastLagMs, "number");
    assert.equal(stall.pid, h.child.pid);
    assert.equal(h.child.kills, 0);
    assert.equal(
      h.child.messages.some((message) => message.type === "shutdown"),
      false,
    );
    const pong = await h.unblock();
    assert.ok(pong.lagMaxMs > 0);
    assert.deepEqual(pong.activity, { running: [], starting: [] });
    await h.tick(15_000);
    assert.equal(h.child.kills, 0);
    assert.equal(h.children.length, 1);
    assert.equal(h.manager.getGeneration(), 1);
    assert.deepEqual(h.statuses, ["starting", "ready"]);
  });
}

test("activity reports only membership changes and includes the latest snapshot in pongs", async (t) => {
  const h = await watchdog(t);
  const reports = [];
  const activity = new h.HostActivity({ post: (message) => reports.push(message), now: () => 123 });
  t.after(() => activity.dispose());
  activity.observe({ running: ["b", "a", "a"], starting: ["c"] });
  activity.observe({ running: ["a", "b"], starting: ["c"] });
  assert.deepEqual(reports, [{ type: "activity", activity: { running: ["a", "b"], starting: ["c"] } }]);
  const pong = activity.pong(9);
  assert.equal(pong.seq, 9);
  assert.equal(pong.ts, 123);
  assert.deepEqual(pong.activity, reports[0].activity);
  assert.ok(Number.isFinite(pong.lagMaxMs) && pong.lagMaxMs >= 0);
  activity.observe({ running: [], starting: [] });
  assert.equal(reports.length, 2);
  assert.deepEqual(activity.pong(10).activity, { running: [], starting: [] });
});

test("session initialization publishes its start lock before yielding and clears it after failure", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-activity-start-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const api = await importTestBundle(
    "rpc-activity",
    {
      packages: "external",
      stdin: {
        contents:
          'export { startRpcSession, subscribeActivity, activitySnapshot } from "../agent-host/rpc-manager.ts";',
        resolveDir: import.meta.dirname,
        loader: "ts",
      },
    },
    { registerCleanup: (cleanup) => t.after(cleanup) },
  );
  const reports = [];
  const unsubscribe = api.subscribeActivity((activity) => reports.push(activity));
  t.after(unsubscribe);
  const invalidSession = path.join(directory, "invalid.jsonl");
  writeFileSync(invalidSession, "invalid session contents");
  const start = api.startRpcSession("new-a", invalidSession, directory);
  const rejected = assert.rejects(start, /not a valid/);
  assert.deepEqual(api.activitySnapshot(), { running: [], starting: ["new-a"] });
  await Promise.resolve();
  assert.deepEqual(api.activitySnapshot(), { running: [], starting: ["new-a"] });
  await rejected;
  assert.deepEqual(api.activitySnapshot(), { running: [], starting: [] });
  assert.deepEqual(reports, [
    { running: [], starting: [] },
    { running: [], starting: ["new-a"] },
    { running: [], starting: [] },
  ]);
});
