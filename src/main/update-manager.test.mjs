import assert from "node:assert/strict";
import test from "node:test";
import { createManualScheduler } from "#test-timing";

import { createUpdateManager, redactUpdateError } from "./update-manager.ts";

class FakeUpdateAdapter {
  constructor() {
    this.listeners = new Map();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.cancelDownloadCalls = 0;
    this.quitCalls = [];
    this.checkImplementation = async () => undefined;
    this.downloadImplementation = async () => undefined;
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  emit(event, ...args) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  checkForUpdates() {
    this.checkCalls++;
    return this.checkImplementation();
  }

  downloadUpdate() {
    this.downloadCalls++;
    return this.downloadImplementation();
  }

  cancelDownload() {
    this.cancelDownloadCalls++;
  }

  quitAndInstall(...args) {
    this.quitCalls.push(args);
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function updateInfo(overrides = {}) {
  return {
    version: "0.2.0",
    files: [],
    path: "Dexon.zip",
    sha512: "test-sha",
    releaseDate: "2026-07-17T12:00:00Z",
    ...overrides,
  };
}

function downloadedInfo(overrides = {}) {
  return { ...updateInfo(overrides), downloadedFile: "/private/var/folders/test/update.zip" };
}

function packagedManager(adapter, options = {}) {
  return createUpdateManager({
    adapter,
    currentVersion: "0.1.0",
    isPackaged: true,
    platform: "darwin",
    ...options,
  });
}

test("development and unsupported platforms remain disabled by default", async () => {
  const previous = process.env.PI_DESKTOP_TEST_UPDATER;
  delete process.env.PI_DESKTOP_TEST_UPDATER;
  try {
    const adapter = new FakeUpdateAdapter();
    const development = createUpdateManager({
      adapter,
      currentVersion: "0.1.0",
      isPackaged: false,
      platform: "darwin",
    });
    const linux = createUpdateManager({
      adapter,
      currentVersion: "0.1.0",
      isPackaged: true,
      platform: "linux",
    });

    assert.equal(development.getState().phase, "disabled");
    assert.equal(linux.getState().phase, "disabled");
    await assert.rejects(development.checkForUpdates(), { code: "UPDATE_UNSUPPORTED" });
    await assert.rejects(linux.downloadUpdate(), { code: "UPDATE_UNSUPPORTED" });
    assert.equal(adapter.checkCalls, 0);
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_TEST_UPDATER;
    else process.env.PI_DESKTOP_TEST_UPDATER = previous;
  }
});

test("explicit test mode permits a development updater only on supported platforms", () => {
  const previous = process.env.PI_DESKTOP_TEST_UPDATER;
  process.env.PI_DESKTOP_TEST_UPDATER = "1";
  try {
    const manager = createUpdateManager({
      adapter: new FakeUpdateAdapter(),
      currentVersion: "0.1.0",
      isPackaged: false,
      platform: "win32",
    });
    assert.equal(manager.getState().phase, "idle");
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_TEST_UPDATER;
    else process.env.PI_DESKTOP_TEST_UPDATER = previous;
  }
});

test("adapter events drive a subscribed, sanitized update state", async () => {
  const adapter = new FakeUpdateAdapter();
  const manager = packagedManager(adapter, { now: () => new Date("2026-07-17T13:00:00Z") });
  const phases = [];
  const unsubscribe = manager.subscribe((state) => phases.push(state.phase));

  adapter.checkImplementation = async () => {
    adapter.emit("checking-for-update");
    adapter.emit(
      "update-available",
      updateInfo({
        releaseName: "<b>Stable release</b>",
        releaseNotes: "&lt;script&gt;bad()&lt;/script&gt;<strong>Safe</strong> &amp; ready",
      }),
    );
  };

  const first = manager.checkForUpdates();
  const repeated = manager.checkForUpdates();
  assert.equal(repeated, first);
  const state = await first;

  assert.equal(adapter.checkCalls, 1);
  assert.equal(state.phase, "available");
  assert.equal(state.availableVersion, "0.2.0");
  assert.equal(state.releaseName, "Stable release");
  assert.equal(state.releaseNotes, "Safe & ready");
  assert.equal(state.releaseDate, "2026-07-17T12:00:00.000Z");
  assert.equal(state.checkedAt, "2026-07-17T13:00:00.000Z");
  assert.deepEqual(phases, ["idle", "checking", "checking", "available"]);

  unsubscribe();
  manager.dispose();
});

test("checks are reused and mutually exclusive with downloads", async () => {
  const adapter = new FakeUpdateAdapter();
  const manager = packagedManager(adapter);
  const pending = deferred();
  adapter.checkImplementation = () => pending.promise;

  const first = manager.checkForUpdates();
  const repeated = manager.checkForUpdates();
  assert.equal(first, repeated);
  assert.equal(adapter.checkCalls, 1);
  assert.equal(manager.getState().phase, "checking");
  await assert.rejects(manager.downloadUpdate(), { code: "UPDATE_BUSY" });

  adapter.emit("update-not-available", updateInfo());
  pending.resolve();
  assert.equal((await first).phase, "up-to-date");
});

test("download progress, installation guards, and preparation are enforced", async () => {
  const adapter = new FakeUpdateAdapter();
  let preparations = 0;
  const manager = packagedManager(adapter, {
    prepareToInstall: async () => {
      preparations++;
    },
  });

  adapter.checkImplementation = async () => adapter.emit("update-available", updateInfo());
  await manager.checkForUpdates();

  const pending = deferred();
  adapter.downloadImplementation = () => pending.promise;
  const first = manager.downloadUpdate();
  const repeated = manager.downloadUpdate();
  assert.equal(first, repeated);
  assert.equal(adapter.downloadCalls, 1);
  await assert.rejects(manager.checkForUpdates(), { code: "UPDATE_BUSY" });

  adapter.emit("download-progress", {
    percent: 37.5,
    bytesPerSecond: 2_048,
    transferred: 3_000,
    total: 8_000,
    delta: 500,
  });
  assert.deepEqual(
    {
      phase: manager.getState().phase,
      percent: manager.getState().percent,
      transferred: manager.getState().transferred,
      total: manager.getState().total,
    },
    { phase: "downloading", percent: 37.5, transferred: 3_000, total: 8_000 },
  );

  adapter.emit("update-downloaded", downloadedInfo());
  assert.equal(manager.getState().phase, "downloading");
  await assert.rejects(manager.installUpdate(), { code: "UPDATE_BUSY" });
  pending.resolve();
  assert.equal((await first).phase, "downloaded");

  manager.setRunningSessionCount(2);
  assert.equal(manager.getState().installBlockedByActiveSessions, true);
  await assert.rejects(manager.installUpdate(), { code: "UPDATE_BUSY" });
  assert.equal(manager.getState().phase, "downloaded");
  assert.equal(adapter.quitCalls.length, 0);

  manager.setRunningSessionCount(0);
  assert.equal(manager.getState().installBlockedByActiveSessions, false);
  await manager.installUpdate();
  assert.equal(preparations, 1);
  assert.deepEqual(adapter.quitCalls, [[false, true]]);
  assert.equal(manager.getState().phase, "installing");
});

test("download progress extends the deadline and a later stall permits retry", async (t) => {
  const adapter = new FakeUpdateAdapter();
  const clock = createManualScheduler();
  const logs = [];
  const manager = packagedManager(adapter, {
    downloadWatchdogMs: 100,
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout,
    log: (level, message) => logs.push(`${level}:${message}`),
  });
  t.after(() => manager.dispose());
  adapter.checkImplementation = async () => adapter.emit("update-available", updateInfo());
  adapter.downloadImplementation = () => new Promise(() => undefined);

  await manager.checkForUpdates();
  const stalled = manager.downloadUpdate();
  await clock.advanceBy(40);
  adapter.emit("download-progress", { percent: 1, transferred: 1, total: 100 });
  await clock.advanceBy(99);
  assert.equal(
    manager.getState().phase,
    "downloading",
    "recent progress keeps the download alive past its original deadline",
  );
  assert.equal(adapter.cancelDownloadCalls, 0);
  await clock.advanceBy(1);

  const timedOut = await stalled;
  assert.equal(timedOut.phase, "error");
  assert.equal(timedOut.error?.code, "UPDATE_DOWNLOAD_FAILED");
  assert.equal(timedOut.canRetry, true);
  assert.equal(adapter.cancelDownloadCalls, 1);
  assert.ok(logs.some((line) => line.includes("no progress")));
  await manager.checkForUpdates();
  assert.equal(adapter.checkCalls, 2);
});

test("invalid state operations fail with stable errors without mutating state", async () => {
  const manager = packagedManager(new FakeUpdateAdapter());
  await assert.rejects(manager.downloadUpdate(), { code: "UPDATE_INVALID_STATE" });
  await assert.rejects(manager.installUpdate(), { code: "UPDATE_INVALID_STATE" });
  assert.equal(manager.getState().phase, "idle");
});

test("a synchronous installer failure restores the surrounding application lifecycle", async () => {
  const adapter = new FakeUpdateAdapter();
  let recoveries = 0;
  adapter.checkImplementation = async () => adapter.emit("update-available", updateInfo());
  adapter.downloadImplementation = async () => adapter.emit("update-downloaded", downloadedInfo());
  adapter.quitAndInstall = () => {
    throw new Error("installer launch failed");
  };
  const manager = packagedManager(adapter, {
    recoverFromInstallFailure: () => {
      recoveries++;
    },
  });

  await manager.checkForUpdates();
  await manager.downloadUpdate();
  await assert.rejects(manager.installUpdate(), { code: "UPDATE_UNKNOWN" });
  assert.equal(recoveries, 1);
  assert.equal(manager.getState().phase, "error");
});

test("a failed containment cleanup aborts installation and restores the application lifecycle", async () => {
  const adapter = new FakeUpdateAdapter();
  let recoveries = 0;
  adapter.checkImplementation = async () => adapter.emit("update-available", updateInfo());
  adapter.downloadImplementation = async () => adapter.emit("update-downloaded", downloadedInfo());
  const manager = packagedManager(adapter, {
    prepareToInstall: async () => {
      throw new Error("Managed process cleanup could not be safely confirmed");
    },
    recoverFromInstallFailure: () => {
      recoveries++;
    },
  });

  await manager.checkForUpdates();
  await manager.downloadUpdate();
  await assert.rejects(manager.installUpdate(), { code: "UPDATE_UNKNOWN" });
  assert.equal(adapter.quitCalls.length, 0, "installer started despite uncertain containment");
  assert.equal(recoveries, 1);
  assert.equal(manager.getState().phase, "error");
  assert.equal(manager.getState().canRetry, true);
});

test("an installer error event restores the surrounding application lifecycle", async () => {
  const adapter = new FakeUpdateAdapter();
  let recoveries = 0;
  adapter.checkImplementation = async () => adapter.emit("update-available", updateInfo());
  adapter.downloadImplementation = async () => adapter.emit("update-downloaded", downloadedInfo());
  adapter.quitAndInstall = () => adapter.emit("error", new Error("installer handoff failed"));
  const manager = packagedManager(adapter, {
    recoverFromInstallFailure: () => {
      recoveries++;
    },
  });

  await manager.checkForUpdates();
  await manager.downloadUpdate();
  await manager.installUpdate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recoveries, 1);
  assert.equal(manager.getState().phase, "error");
});

test("network and signature failures are normalized while logs are redacted", async () => {
  const adapter = new FakeUpdateAdapter();
  const logs = [];
  const manager = packagedManager(adapter, {
    log: (level, message) => logs.push(`${level}:${message}`),
  });
  adapter.checkImplementation = async () => {
    throw new Error(
      "ECONNRESET Authorization: Bearer secret-token-123 at /Users/alice/Library/Caches/updater/file.zip?token=abc123",
    );
  };

  const offline = await manager.checkForUpdates();
  assert.equal(offline.phase, "error");
  assert.equal(offline.error?.code, "UPDATE_OFFLINE");
  assert.equal(offline.canRetry, true);
  const output = logs.join("\n");
  assert.doesNotMatch(output, /secret-token-123|alice|abc123|Library\/Caches/);
  assert.match(output, /UPDATE_OFFLINE/);

  adapter.checkImplementation = async () => {
    adapter.emit("error", new Error("code signature is not trusted"));
    throw new Error("ECONNRESET after updater error event");
  };
  const beforeSignatureLogs = logs.filter((line) => line.includes("updater UPDATE_")).length;
  const signature = await manager.checkForUpdates();
  assert.equal(signature.error?.code, "UPDATE_SIGNATURE_INVALID");
  assert.equal(signature.canRetry, false);
  assert.equal(logs.filter((line) => line.includes("updater UPDATE_")).length, beforeSignatureLogs + 1);

  adapter.checkImplementation = async () => {
    const error = new Error("getaddrinfo failed");
    error.code = "ENOTFOUND";
    throw error;
  };
  const dnsFailure = await manager.checkForUpdates();
  assert.equal(dnsFailure.error?.code, "UPDATE_OFFLINE");

  adapter.checkImplementation = async () => {
    const error = new Error("net request failed");
    error.code = "ERR_INTERNET_DISCONNECTED";
    throw error;
  };
  const chromiumOffline = await manager.checkForUpdates();
  assert.equal(chromiumOffline.error?.code, "UPDATE_OFFLINE");

  adapter.checkImplementation = async () => {
    throw new Error("No published versions on GitHub");
  };
  const unpublished = await manager.checkForUpdates();
  assert.equal(unpublished.error?.code, "UPDATE_NOT_PUBLISHED");
});

test("redaction handles token, email, Windows home, and cache paths", () => {
  const redacted = redactUpdateError(
    "token=topsecret user@example.com C:\\Users\\Alice\\AppData\\cache /private/var/folders/aa/file",
  );
  assert.equal(redacted.includes("topsecret"), false);
  assert.equal(redacted.includes("user@example.com"), false);
  assert.equal(redacted.includes("Alice"), false);
  assert.equal(redacted.includes("/private/var/folders"), false);
});

for (const [random, interval] of [
  [0, 540],
  [0.5, 600],
  [1, 660],
]) {
  test(`automatic checks respect elapsed time and stop after disposal (jitter ${random})`, async (t) => {
    const adapter = new FakeUpdateAdapter();
    const clock = createManualScheduler();
    adapter.checkImplementation = async () => adapter.emit("update-not-available", updateInfo());
    const manager = packagedManager(adapter, {
      initialCheckDelayMs: 60,
      checkIntervalMs: 600,
      jitterRatio: 0.1,
      random: () => random,
      setTimer: clock.setTimeout,
      clearTimer: clock.clearTimeout,
    });
    t.after(() => manager.dispose());
    manager.startAutomaticChecks();
    await clock.advanceBy(59);
    assert.equal(adapter.checkCalls, 0);
    await clock.advanceBy(1);
    assert.equal(adapter.checkCalls, 1);
    await clock.advanceBy(interval - 1);
    assert.equal(adapter.checkCalls, 1);
    await clock.advanceBy(1);
    assert.equal(adapter.checkCalls, 2);
    manager.dispose();
    await clock.advanceBy(interval * 2);
    assert.equal(adapter.checkCalls, 2, "disposed managers never poll again");
    assert.equal(adapter.listenerCount(), 0);
  });
}

test("available or downloaded updates and a disabled preference pause background checks", async (t) => {
  const adapter = new FakeUpdateAdapter();
  const clock = createManualScheduler();
  adapter.checkImplementation = async () => adapter.emit("update-available", updateInfo());
  adapter.downloadImplementation = async () => adapter.emit("update-downloaded", downloadedInfo());
  const manager = packagedManager(adapter, {
    initialCheckDelayMs: 60,
    checkIntervalMs: 600,
    jitterRatio: 0,
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout,
  });
  t.after(() => manager.dispose());
  manager.startAutomaticChecks();
  await clock.advanceBy(60);
  assert.equal(adapter.checkCalls, 1);
  assert.equal(manager.getState().phase, "available");
  await clock.advanceBy(1200);
  assert.equal(adapter.checkCalls, 1, "an offered update is not overwritten by polling");
  await manager.downloadUpdate();
  await clock.advanceBy(1200);
  assert.equal(manager.getState().phase, "downloaded");
  assert.equal(adapter.checkCalls, 1);
  manager.setAutomaticChecksEnabled(false);
  adapter.emit("update-not-available", updateInfo());
  await clock.advanceBy(1200);
  assert.equal(adapter.checkCalls, 1, "the disabled preference pauses checks even in idle state");
  adapter.checkImplementation = async () => adapter.emit("update-not-available", updateInfo());
  manager.setAutomaticChecksEnabled(true);
  await clock.advanceBy(59);
  assert.equal(adapter.checkCalls, 1);
  await clock.advanceBy(1);
  assert.equal(adapter.checkCalls, 2, "enabling checks starts a new initial delay");
});
