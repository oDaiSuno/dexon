import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { on } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";

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
          'export { HostManager } from "./host-manager.ts"; export { children } from "electron"; export { flushMainLog } from "./logger.ts"; export { HostActivity } from "../agent-host/host-activity.ts"; export { createRpcServer, createRpcClient } from "../contract/rpc.ts"; export const moduleUrl = import.meta.url;',
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
    import { MessageChannel } from "node:worker_threads";
    import { HostActivity, createRpcServer } from ${JSON.stringify(api.moduleUrl)};
    const server = createRpcServer();
    const activity = new HostActivity({ post: (message) => process.send(message), inFlightRequests: () => server.inFlightRequests() });
    const wait = new Int32Array(new SharedArrayBuffer(4));
    server.handle({
      "files.list": () => {
        process.send({ type: "log", message: "blocking" });
        while (existsSync(${JSON.stringify(blocker)})) Atomics.wait(wait, 0, 0, 10);
        setTimeout(() => process.send(activity.pong(0)), 60);
        return { entries: [] };
      },
    });
    process.on("message", (message) => {
      if (message.type === "ping") process.send(activity.pong(message.seq));
      if (message.type === "threads") process.send({ type: "log", message: "threads:" + (process.env.UV_THREADPOOL_SIZE ?? "unset") });
      if (message.type === "shutdown") {
        activity.dispose();
        process.exit(0);
      }
      if (message.type === "block") {
        if (message.work === "request") {
          const { port1, port2 } = new MessageChannel();
          server.attachPort(port1);
          port2.postMessage({ kind: "request", id: "slow", method: "files.list", params: { path: "/slow-mount" } });
          return;
        }
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

test("an idle silent host is flagged unresponsive at 10 seconds and restarted at 25 seconds", async (t) => {
  const h = await watchdog(t);
  assert.equal(h.manager.getGeneration(), 1);
  assert.equal(h.manager.getReadySince(), 1_000_000);
  await h.tick(5_000);
  assert.equal(h.manager.getStatus(), "ready");
  await h.tick(5_000);
  assert.equal(h.manager.getStatus(), "unresponsive", "the UI learns about the stall at 10 seconds");
  assert.equal(h.child.kills, 0);
  await h.tick(10_000);
  assert.equal(
    h.child.messages.some((message) => message.type === "shutdown"),
    false,
    "an unresponsive host is not shut down before 25 seconds",
  );
  await h.tick(5_000);
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
  assert.deepEqual(h.statuses.slice(0, 3), ["starting", "ready", "unresponsive"]);
  const [stall, timeout] = await h.diagnostics();
  assert.equal(stall.reason, "unresponsive");
  assert.equal(stall.silentMs, 10_000);
  assert.equal(timeout.reason, "ping-timeout");
  assert.equal(timeout.atStake, 0);
  assert.equal(timeout.silentMs, 25_000);
});

test("a heartbeat after a stall returns the same host to ready without a restart", async (t) => {
  const h = await watchdog(t);
  await h.tick(5_000);
  await h.tick(5_000);
  assert.equal(h.manager.getStatus(), "unresponsive");
  const answer = () =>
    h.child.emit("message", {
      type: "pong",
      seq: 2,
      ts: Date.now(),
      lagMaxMs: 9_000,
      activity: { running: [], starting: [] },
    });
  answer();
  assert.equal(h.manager.getStatus(), "ready", "recovery is immediate, not on the next tick");
  assert.equal(h.manager.getGeneration(), 1, "the same host keeps serving the window");
  for (let elapsed = 5_000; elapsed <= 30_000; elapsed += 5_000) {
    await h.tick(5_000);
    answer();
  }
  assert.equal(h.manager.getStatus(), "ready");
  assert.equal(h.child.kills, 0);
  assert.equal(h.children.length, 1);
  assert.deepEqual(h.statuses, ["starting", "ready", "unresponsive", "ready"]);
});

test("slow requests in flight hold an idle host until 45 seconds even when new requests keep arriving", async (t) => {
  const h = await watchdog(t);
  const busy = (inFlightRequests) => ({ running: [], starting: [], inFlightRequests });
  h.child.emit("message", { type: "pong", seq: 1, ts: Date.now(), lagMaxMs: 0, activity: busy(1) });
  for (let elapsed = 5_000; elapsed <= 40_000; elapsed += 5_000) {
    await h.tick(5_000);
    h.child.emit("message", { type: "activity", activity: { running: [], starting: [] } });
  }
  assert.equal(
    h.child.messages.some((message) => message.type === "shutdown"),
    false,
    "a host with requests in flight survives past the idle 25 second limit",
  );
  assert.equal(h.manager.getStatus(), "unresponsive");
  await h.tick(5_000);
  assert.equal(h.child.messages.at(-1)?.type, "shutdown", "the 45 second deadline does not move with new requests");
  const timeout = (await h.diagnostics()).at(-1);
  assert.equal(timeout.reason, "ping-timeout");
  assert.equal(timeout.silentMs, 45_000);
  assert.equal(timeout.inFlightRequests, 1, "session updates between heartbeats keep the last reported request count");
});

for (const work of ["starting", "running"]) {
  test(`a ${work} session keeps an unresponsive host alive and recovers without a restart`, async (t) => {
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
    for (let elapsed = 5_000; elapsed <= 30_000; elapsed += 5_000) await h.tick(5_000);
    assert.equal(h.child.kills, 0);
    assert.equal(
      h.child.messages.some((message) => message.type === "shutdown"),
      false,
    );
    assert.equal(h.manager.getStatus(), "unresponsive");
    assert.deepEqual(h.statuses, ["starting", "ready", "unresponsive"]);
    const [stall] = await h.diagnostics();
    assert.deepEqual(stall, {
      reason: "unresponsive",
      silentMs: 10_000,
      atStake: 1,
      inFlightRequests: 0,
      running: activity.running,
      starting: activity.starting,
      lastLagMs: 42,
      pid: h.child.pid,
    });
    assert.equal((await h.diagnostics()).length, 1, "the stall is logged once rather than on every tick");
    h.child.emit("message", { type: "pong", seq: 3, ts: Date.now(), lagMaxMs: 30_000, activity });
    assert.equal(h.manager.getStatus(), "ready");
    await h.tick(5_000);
    assert.equal(h.child.kills, 0);
    assert.equal(h.children.length, 1);
    assert.equal(h.manager.getGeneration(), 1);
  });
}

test("sleep resets the heartbeat baseline instead of killing a healthy host", async (t) => {
  const h = await watchdog(t);
  t.mock.timers.setTime(Date.now() + 300_000);
  await h.tick(5_000);
  assert.equal(h.child.kills, 0);
  assert.equal(h.manager.getStatus(), "ready");
  h.child.emit("message", {
    type: "pong",
    seq: 1,
    ts: Date.now(),
    lagMaxMs: 0,
    activity: { running: [], starting: [] },
  });
  await h.tick(5_000);
  assert.equal(h.child.kills, 0);
  assert.equal(h.manager.getStatus(), "ready");
});

test("an active host exhausts its 145 second grace before shutdown and resets activity after restart", async (t) => {
  const h = await watchdog(t);
  h.child.emit("message", { type: "activity", activity: { running: ["a"], starting: ["b"] } });
  for (let elapsed = 5_000; elapsed < 145_000; elapsed += 5_000) await h.tick(5_000);
  assert.equal(h.child.kills, 0);
  assert.equal(
    h.child.messages.some((message) => message.type === "shutdown"),
    false,
  );
  assert.equal((await h.diagnostics()).length, 1);
  await h.tick(5_000);
  assert.equal(h.child.messages.at(-1).type, "shutdown");
  assert.equal(h.child.kills, 0);
  await h.tick(1500);
  assert.equal(h.child.kills, 1);
  await h.tick(500);
  const next = h.children[1];
  h.ready(next);
  for (let elapsed = 5_000; elapsed <= 25_000; elapsed += 5_000) await h.tick(5_000);
  assert.equal(next.messages.at(-1).type, "shutdown");
  const timeouts = (await h.diagnostics()).filter((entry) => entry.reason === "ping-timeout");
  assert.equal(timeouts[0].atStake, 2);
  assert.equal(timeouts[0].silentMs, 145_000);
  assert.equal(timeouts[1].atStake, 0);
  assert.equal(timeouts[1].lastLagMs, 0);
});

test("restarting by hand while the host is unresponsive replaces it once, even if clicked twice", async (t) => {
  const h = await watchdog(t);
  let cleanups = 0;
  h.manager.setBeforeRestartHandler(async () => {
    cleanups += 1;
  });
  await h.tick(5_000);
  await h.tick(5_000);
  assert.equal(h.manager.getStatus(), "unresponsive");
  await Promise.all([h.manager.restartHost(), h.manager.restartHost()]);
  assert.equal(h.manager.getStatus(), "starting");
  assert.equal(h.child.messages.filter((message) => message.type === "shutdown").length, 1);
  h.child.emit("exit", 0);
  await h.tick(0);
  await h.tick(500);
  assert.equal(cleanups, 1, "managed process cleanup runs once before the replacement starts");
  assert.equal(h.children.length, 2, "two clicks start exactly one replacement");
  h.ready(h.children[1]);
  assert.equal(h.manager.getStatus(), "ready");
  assert.equal(h.manager.getGeneration(), 2);
  await h.manager.restartHost();
  assert.equal(h.children.length, 2, "a responsive host ignores the restart request");
});

test("a hand restart waits for the frozen host to exit and force-kills it after the grace", async (t) => {
  const h = await watchdog(t);
  await h.tick(5_000);
  await h.tick(5_000);
  await h.manager.restartHost();
  assert.equal(h.child.messages.at(-1)?.type, "shutdown");
  await h.tick(1_499);
  assert.equal(h.child.kills, 0);
  await h.tick(1);
  assert.equal(h.child.kills, 1, "a host that ignores shutdown is killed");
  await h.tick(500);
  assert.equal(h.children.length, 2);
  h.ready(h.children[1]);
  assert.equal(h.manager.getStatus(), "ready");
});

test("clean shutdown during the grace period never kills the replacement host", async (t) => {
  const h = await watchdog(t);
  for (let elapsed = 5_000; elapsed <= 25_000; elapsed += 5_000) await h.tick(5_000);
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

test("a window port requested before the host is ready is closed instead of queued", async (t) => {
  const h = await watchdog(t);
  h.child.emit("exit", 1);
  await h.tick(0);
  assert.equal(h.manager.getStatus(), "starting");
  const port = {
    closed: 0,
    close() {
      this.closed += 1;
    },
  };
  h.manager.attachRendererPort(port);
  assert.equal(port.closed, 1, "the window asks again once the host reports ready");
  await h.tick(500);
  const next = h.children[1];
  next.emit("spawn");
  assert.equal(
    next.messages.some((message) => message.type === "attach-port"),
    false,
    "no stale port is replayed into the new host",
  );
});

for (const work of ["starting", "running"]) {
  test(`a real IPC child reports ${work} before blocking and survives 30 seconds on the main clock`, async (t) => {
    const h = await watchdog(t, true);
    await h.block(work);
    for (let elapsed = 5_000; elapsed <= 30_000; elapsed += 5_000) await h.tick(5_000);
    const [stall] = await h.diagnostics();
    assert.equal(stall.silentMs, 10_000);
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
    assert.deepEqual(pong.activity, { running: [], starting: [], inFlightRequests: 0 });
    await h.tick(5_000);
    assert.equal(h.child.kills, 0);
    assert.equal(h.children.length, 1);
    assert.equal(h.manager.getGeneration(), 1);
    assert.deepEqual(h.statuses, ["starting", "ready", "unresponsive", "ready"]);
  });
}

test("the local agent host process starts with sixteen file-system worker threads", async (t) => {
  const previous = process.env.UV_THREADPOOL_SIZE;
  delete process.env.UV_THREADPOOL_SIZE;
  t.after(() => {
    if (previous !== undefined) process.env.UV_THREADPOOL_SIZE = previous;
  });
  const h = await watchdog(t, true);
  const reply = hostMessage(h.child, (message) => message.type === "log" && message.message.startsWith("threads:"));
  h.child.postMessage({ type: "threads" });
  assert.equal((await reply).message, "threads:16");
});

test("activity reports only membership changes and every pong carries the live in-flight request count", async (t) => {
  const h = await watchdog(t);
  const reports = [];
  let inFlightRequests = 0;
  const activity = new h.HostActivity({
    post: (message) => reports.push(message),
    now: () => 123,
    inFlightRequests: () => inFlightRequests,
  });
  t.after(() => activity.dispose());
  activity.observe({ running: ["b", "a", "a"], starting: ["c"] });
  activity.observe({ running: ["a", "b"], starting: ["c"] });
  assert.deepEqual(reports, [{ type: "activity", activity: { running: ["a", "b"], starting: ["c"] } }]);
  inFlightRequests = 3;
  const pong = activity.pong(9);
  assert.equal(pong.seq, 9);
  assert.equal(pong.ts, 123);
  assert.deepEqual(pong.activity, { running: ["a", "b"], starting: ["c"], inFlightRequests: 3 });
  assert.ok(Number.isFinite(pong.lagMaxMs) && pong.lagMaxMs >= 0);
  assert.equal(reports.length, 1, "request traffic alone never produces extra activity messages");
  activity.observe({ running: [], starting: [] });
  assert.equal(reports.length, 2);
  inFlightRequests = 0;
  assert.deepEqual(activity.pong(10).activity, { running: [], starting: [], inFlightRequests: 0 });
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

test("the first synchronously blocking RPC request after an idle heartbeat receives the fixed 45 second grace", async (t) => {
  const h = await watchdog(t, true);
  const heartbeat = hostMessage(h.child, (message) => message.type === "pong");
  await h.tick(5_000);
  assert.equal((await heartbeat).activity.inFlightRequests, 0);
  await h.block("request");
  for (let elapsed = 5_000; elapsed <= 40_000; elapsed += 5_000) await h.tick(5_000);
  assert.equal(h.manager.getStatus(), "unresponsive");
  assert.equal(
    h.child.messages.some((message) => message.type === "shutdown"),
    false,
  );
  await h.tick(5_000);
  assert.equal(h.child.messages.at(-1).type, "shutdown");
  const timeout = (await h.diagnostics()).at(-1);
  assert.equal(timeout.silentMs, 45_000);
  assert.equal(timeout.inFlightRequests, 1);
});

test("overlapping RPC requests publish only busy and idle edges and disposal stops reporting", async (t) => {
  const h = await watchdog(t);
  const server = h.createRpcServer();
  const reports = [];
  const activity = new h.HostActivity({
    post: (message) => reports.push(message),
    inFlightRequests: () => server.inFlightRequests(),
  });
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const client = h.createRpcClient(port2);
  t.after(() => {
    activity.dispose();
    client.close();
    server.detachPort(port1);
  });
  const started = [Promise.withResolvers(), Promise.withResolvers()];
  const completed = [Promise.withResolvers(), Promise.withResolvers()];
  let index = 0;
  server.handle({
    "host.ping": () => {
      const current = index++;
      started[current].resolve();
      return completed[current].promise;
    },
  });
  const first = client.call("host.ping");
  await started[0].promise;
  const second = client.call("host.ping");
  await started[1].promise;
  assert.deepEqual(reports, [{ type: "activity", activity: { running: [], starting: [], inFlightRequests: 1 } }]);
  completed[0].resolve({ ok: true, ts: 0 });
  await first;
  assert.equal(reports.length, 1, "finishing one of two requests leaves the host busy without another report");
  completed[1].resolve({ ok: true, ts: 0 });
  await second;
  assert.deepEqual(reports, [
    { type: "activity", activity: { running: [], starting: [], inFlightRequests: 1 } },
    { type: "activity", activity: { running: [], starting: [], inFlightRequests: 0 } },
  ]);
  activity.dispose();
  server.handle({ "host.ping": () => ({ ok: true, ts: 0 }) });
  await client.call("host.ping");
  assert.equal(reports.length, 2);
});
