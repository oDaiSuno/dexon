import { configureSmokeEnvironment } from "./environment";
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostManager, type HostStatus } from "../main/host-manager";
import { ManagedProcessReaper } from "../main/managed-process/reaper";
import { canRestartHostAfterCleanup } from "../main/managed-process/restart-gate";

configureSmokeEnvironment();

const OBSERVE_MS = 56_000;
const WINDOW_NONCE = "a".repeat(64);
const WINDOWS_RECORD = {
  version: 2,
  platform: "win32",
  processId: "proc-a",
  runId: "run-a",
  hostInstanceId: "host-a",
  nonce: WINDOW_NONCE,
  createdAt: 1,
  helperPid: 4242,
  helperStartFingerprint: "helper-fingerprint",
  helperBuildId: "pimpd-0.1.13-p1-abcdef123456",
  jobName: `Local\\PiDesktop.Managed.${WINDOW_NONCE}`,
};
const LEFTOVER_JOURNAL = JSON.stringify({ version: 2, revision: 1, records: [WINDOWS_RECORD] });

type HostBehaviour = {
  counter: boolean;
  readyDelayMs: number;
  answerPings: boolean;
  ignorePingsLaunches?: number;
  exitBeforeReadyLaunches?: number;
  exitAfterReadyMs?: number;
  exitAfterReadyLaunches?: number;
};

type StatusEntry = { status: HostStatus; at: number; detail?: string };
type Verdict = { pass: boolean; detail: string };
type ScenarioRecord = { name: string; pass: boolean; detail: string };

type Scene = { journal: string; counter: string; entry: string };

const activeHosts: HostManager[] = [];

function fakeHostSource(config: Record<string, unknown>): string {
  return `import fs from "node:fs";

const config = ${JSON.stringify(config)};
const counter = config.counterFile;
const launch = counter ? (fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0) + 1 : 1;
if (counter) fs.writeFileSync(counter, String(launch));
const until = Date.now() + config.readyDelayMs;
while (Date.now() < until) {}
if (launch <= (config.exitBeforeReadyLaunches ?? 0)) process.exit(1);
const answersPings = config.answerPings || launch > (config.ignorePingsLaunches ?? Infinity);
process.parentPort.on("message", (event) => {
  const type = event.data?.type;
  if (type === "shutdown") process.exit(0);
  if (type === "ping" && answersPings) process.parentPort.postMessage({ type: "pong", ts: Date.now() });
});
process.parentPort.postMessage({ type: "ready", ts: Date.now(), piVersion: "liveness" });
if (config.exitAfterReadyMs !== undefined && launch <= (config.exitAfterReadyLaunches ?? 0)) {
  setTimeout(() => process.exit(1), config.exitAfterReadyMs);
}
setInterval(() => {}, 1 << 30);
`;
}

function scene(root: string, name: string, journalContent?: string): Scene {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  const journal = path.join(directory, "journal-v2.json");
  if (journalContent !== undefined) fs.writeFileSync(journal, journalContent);
  return {
    journal,
    counter: path.join(directory, "launch-count"),
    entry: path.join(directory, "fake-host.mjs"),
  };
}

function startHost(
  place: Scene,
  reaper: ManagedProcessReaper,
  behaviour: HostBehaviour,
): { host: HostManager; records: StatusEntry[] } {
  const { counter, ...rest } = behaviour;
  fs.writeFileSync(place.entry, fakeHostSource({ ...rest, counterFile: counter ? place.counter : undefined }));
  const records: StatusEntry[] = [];
  const started = Date.now();
  const host = new HostManager(place.entry);
  host.setStatusListener((status, detail) => {
    records.push({ status, ...(detail ? { detail } : {}), at: Date.now() - started });
  });
  host.setBeforeRestartHandler(async () => {
    const status = await reaper.reapAll();
    if (!canRestartHostAfterCleanup(status)) {
      throw new Error(`Managed process cleanup blocked Host restart (${status.errorCode ?? "unknown"})`);
    }
  });
  activeHosts.push(host);
  return { host, records };
}

function order(records: readonly StatusEntry[]): string {
  return records.map((entry) => entry.status).join(">") || "none";
}

function launchCount(counter: string): number | null {
  return fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

async function settle(name: string, run: () => Promise<Verdict>): Promise<ScenarioRecord> {
  try {
    return { name, ...(await run()) };
  } catch (error) {
    return { name, pass: false, detail: message(error) };
  }
}

async function slowStart(root: string, name: string, readyDelayMs: number): Promise<Verdict> {
  const place = scene(root, name);
  const reaper = new ManagedProcessReaper(place.journal, { platform: "win32" });
  await reaper.initialize();
  const { host, records } = startHost(place, reaper, { counter: false, readyDelayMs, answerPings: true });
  host.start();
  await sleep(OBSERVE_MS);
  const starts = records.filter((entry) => entry.status === "starting").length;
  const crashes = records.filter((entry) => entry.status === "crashed").length;
  const last = records.at(-1)?.status ?? "none";
  return {
    pass: crashes === 0 && starts === 1 && last === "ready",
    detail: `order=${order(records)} starts=${starts} crashes=${crashes} last=${last}`,
  };
}

async function hungHost(root: string): Promise<Verdict> {
  const name = "hung-host-is-restarted-within-30s";
  const place = scene(root, name);
  const reaper = new ManagedProcessReaper(place.journal, { platform: "linux", groupExists: () => false });
  await reaper.initialize();
  const { host, records } = startHost(place, reaper, {
    counter: true,
    readyDelayMs: 0,
    answerPings: false,
    ignorePingsLaunches: 1,
  });
  host.start();
  await sleep(OBSERVE_MS);
  const firstReady = records.findIndex((entry) => entry.status === "ready");
  const restart =
    firstReady < 0 ? -1 : records.findIndex((entry, index) => index > firstReady && entry.status === "starting");
  const gap = restart < 0 ? null : records[restart].at - records[firstReady].at;
  const recovered = restart >= 0 && records.slice(restart + 1).some((entry) => entry.status === "ready");
  const crashed = records.some((entry) => entry.status === "crashed");
  return {
    pass: gap !== null && gap >= 24_000 && gap <= 36_000 && recovered && !crashed,
    detail: `order=${order(records)} restartAfterReadyMs=${gap ?? "none"} recovered=${recovered} crashed=${crashed}`,
  };
}

async function windowsCrashRecovery(root: string): Promise<Verdict> {
  const name = "windows-crash-without-cleanup-helper-recovers";
  const place = scene(root, name);
  const reaper = new ManagedProcessReaper(place.journal, { platform: "win32" });
  await reaper.initialize();
  const { host, records } = startHost(place, reaper, {
    counter: true,
    readyDelayMs: 0,
    answerPings: true,
    exitAfterReadyMs: 1_000,
    exitAfterReadyLaunches: 1,
  });
  host.start();
  await sleep(15_000);
  const readies = records.filter((entry) => entry.status === "ready").length;
  const crashed = records.some((entry) => entry.status === "crashed");
  return {
    pass: readies >= 2 && !crashed,
    detail: `order=${order(records)} readies=${readies} crashed=${crashed}`,
  };
}

async function leftoverBlocksRetry(root: string): Promise<Verdict> {
  const name = "leftover-record-blocks-restart-and-retry";
  const place = scene(root, name, LEFTOVER_JOURNAL);
  const reaper = new ManagedProcessReaper(place.journal, { platform: "win32" });
  await reaper.initialize();
  const { host, records } = startHost(place, reaper, {
    counter: true,
    readyDelayMs: 0,
    answerPings: true,
    exitAfterReadyMs: 1_000,
    exitAfterReadyLaunches: 99,
  });
  host.start();
  if (!(await waitUntil(() => records.some((entry) => entry.status === "crashed"), 15_000))) {
    return { pass: false, detail: `no crash: order=${order(records)}` };
  }
  const before = launchCount(place.counter);
  let rejection = "";
  try {
    await host.restartAfterCrash();
  } catch (error) {
    rejection = message(error);
  }
  const after = launchCount(place.counter);
  const blocked = rejection.includes("Managed process cleanup blocked Host restart");
  return {
    pass: blocked && host.getStatus() === "crashed" && after === before,
    detail: `rejection=${rejection || "resolved"} status=${host.getStatus()} launches=${String(before)}=>${String(after)}`,
  };
}

async function damagedJournal(root: string): Promise<Verdict> {
  const name = "damaged-journal-blocks-restart";
  const place = scene(root, name, "not json");
  const reaper = new ManagedProcessReaper(place.journal, { platform: "win32" });
  await reaper.initialize();
  const { host, records } = startHost(place, reaper, {
    counter: true,
    readyDelayMs: 0,
    answerPings: true,
    exitAfterReadyMs: 1_000,
    exitAfterReadyLaunches: 99,
  });
  host.start();
  const crashed = await waitUntil(() => records.some((entry) => entry.status === "crashed"), 15_000);
  const launches = launchCount(place.counter);
  return {
    pass: crashed && launches === 1,
    detail: `order=${order(records)} launches=${String(launches)}`,
  };
}

async function retryRestartsCrashedHost(root: string): Promise<Verdict> {
  const name = "retry-restarts-crashed-host";
  const place = scene(root, name);
  const reaper = new ManagedProcessReaper(place.journal, { platform: "linux", groupExists: () => false });
  await reaper.initialize();
  const { host, records } = startHost(place, reaper, {
    counter: true,
    readyDelayMs: 0,
    answerPings: true,
    exitBeforeReadyLaunches: 3,
    exitAfterReadyMs: 1_000,
    exitAfterReadyLaunches: 4,
  });
  host.start();
  if (!(await waitUntil(() => records.some((entry) => entry.status === "crashed"), 20_000))) {
    return { pass: false, detail: `no crash: order=${order(records)}` };
  }
  const index = records.length;
  try {
    await host.restartAfterCrash();
  } catch (error) {
    return { pass: false, detail: `restartAfterCrash rejected: ${message(error)}` };
  }
  await waitUntil(() => records.slice(index).filter((entry) => entry.status === "ready").length >= 2, 15_000);
  const after = records.slice(index).map((entry) => entry.status);
  const launches = launchCount(place.counter);
  return {
    pass:
      after[0] === "starting" &&
      after.filter((status) => status === "ready").length >= 2 &&
      !after.includes("crashed") &&
      launches === 5,
    detail: `afterRetry=${after.join(">")} launches=${String(launches)}`,
  };
}

async function run(): Promise<void> {
  await app.whenReady();
  const resultPath = process.env.DEXON_ELECTRON_RESULT;
  if (!resultPath) throw new Error("host-liveness requires DEXON_ELECTRON_RESULT");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-host-liveness-"));
  const records = await Promise.all([
    settle("slow-start-11s-stays-ready", () => slowStart(root, "slow-start-11s-stays-ready", 11_000)),
    settle("slow-start-20s-stays-ready", () => slowStart(root, "slow-start-20s-stays-ready", 20_000)),
    settle("hung-host-is-restarted-within-30s", () => hungHost(root)),
    settle("windows-crash-without-cleanup-helper-recovers", () => windowsCrashRecovery(root)),
    settle("leftover-record-blocks-restart-and-retry", () => leftoverBlocksRetry(root)),
    settle("damaged-journal-blocks-restart", () => damagedJournal(root)),
    settle("retry-restarts-crashed-host", () => retryRestartsCrashedHost(root)),
  ]);
  for (const host of activeHosts) await Promise.race([host.stop(), sleep(3_000)]);
  for (const record of records) {
    console.log(`host-liveness ${record.pass ? "PASS" : "FAIL"} ${record.name}: ${record.detail}`);
  }
  fs.writeFileSync(
    resultPath,
    JSON.stringify(
      { completed: true, pid: process.pid, check: "host-liveness", pass: records.every((r) => r.pass), records },
      null,
      2,
    ),
  );
  app.exit(0);
}

setTimeout(() => {
  console.error("host-liveness timed out");
  app.exit(1);
}, 140_000);

void run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
