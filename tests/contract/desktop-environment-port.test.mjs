import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

async function desktopFixture(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-environment-port-"));
  let loaded;
  const originals = new Map(
    ["window", "location", "postMessage"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const receivers = new Set();
  const target = {
    addEventListener: (_, receive) => receivers.add(receive),
    removeEventListener: (_, receive) => receivers.delete(receive),
  };
  globalThis.window = target;
  globalThis.location = { href: options.location ?? "app://bundle/index.html" };
  globalThis.postMessage = (data, _, ports = []) => {
    for (const receive of receivers) receive({ source: target, data, ports });
  };
  t.after(async () => {
    await loaded?.flushMainLog();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    rmSync(directory, { recursive: true, force: true });
  });
  loaded = await importTestBundle("desktop-environment-port", {
    stdin: {
      contents: `export { installDesktopIpc } from "./src/main/ipc";
        export { flushMainLog } from "./src/main/logger";
        export { requestEnvironmentPort } from "./src/renderer/lib/environment-port";
        import "./src/preload/preload";
        export { boundary } from "electron";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    tsconfig: "tsconfig.renderer.json",
    plugins: [
      {
        name: "electron-environment-port",
        setup(build) {
          build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "port-fixture" }));
          build.onLoad({ filter: /.*/, namespace: "port-fixture" }, () => ({
            contents: `export const boundary = {
              handlers: new Map(), listeners: new Map(), rendererListeners: new Map(), bridge: null, event: null,
            };
            export const ipcMain = {
              handle(name, handler) { boundary.handlers.set(name, handler); },
              on(name, handler) { boundary.listeners.set(name, handler); },
            };
            export const ipcRenderer = {
              on(name, listener) {
                const listeners = boundary.rendererListeners.get(name) ?? new Set();
                listeners.add(listener);
                boundary.rendererListeners.set(name, listeners);
              },
              removeListener(name, listener) { boundary.rendererListeners.get(name)?.delete(listener); },
              send(name, ...args) { boundary.listeners.get(name)?.(boundary.event, ...args); },
              async invoke(name, ...args) {
                const handler = boundary.handlers.get(name);
                if (!handler) throw new Error("No IPC handler for " + name);
                try { return structuredClone(await handler(boundary.event, ...structuredClone(args))); }
                catch (error) { throw new Error("Error invoking remote method '" + name + "': " + error); }
              },
            };
            export const contextBridge = { exposeInMainWorld(name, bridge) { boundary.bridge = bridge; } };
            export const app = { isPackaged: true, getPath: () => ${JSON.stringify(directory)}, getVersion: () => "1.0" };
            export const BrowserWindow = {}; export const dialog = {}; export const nativeTheme = {};
            export const Notification = {}; export const shell = {}; export const protocol = {}; export const Menu = {};
            export const clipboard = {}; export const webUtils = {};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const mainFrame = {};
  const sender = {
    mainFrame,
    postMessage(name, payload, ports) {
      for (const receive of loaded.boundary.rendererListeners.get(name) ?? []) receive({ ports }, payload);
    },
  };
  const mainWindow = { isDestroyed: () => false, webContents: sender };
  loaded.boundary.event = { sender, senderFrame: mainFrame };
  loaded.installDesktopIpc({ getMainWindow: () => mainWindow, getHostManager: () => null, ...options });
  target.piBridge = loaded.boundary.bridge;
  return { ...loaded, target, sender, mainWindow };
}

async function connectionOutcome(t, fixture, environmentId) {
  const controller = new globalThis.AbortController();
  t.after(() => controller.abort());
  let outcome = "pending";
  fixture.requestEnvironmentPort(environmentId, controller.signal).then(
    (delivered) => {
      outcome = delivered;
    },
    (error) => {
      outcome = error;
    },
  );
  await new Promise(setImmediate);
  return outcome;
}

test("a desktop remote attachment failure reaches the caller immediately with its real error", async (t) => {
  const fixture = await desktopFixture(t, {
    environmentManager: {
      attachRendererEnvironmentPort() {
        throw new Error("Environment is not connected");
      },
    },
  });
  const outcome = await connectionOutcome(t, fixture, "remote-offline");
  assert.ok(outcome instanceof Error, "the port request rejects without waiting for the fallback timeout");
  assert.equal(outcome.message, "Environment is not connected");
});

test("a desktop primary request fails immediately when the Host manager is unavailable", async (t) => {
  const fixture = await desktopFixture(t);
  const outcome = await connectionOutcome(t, fixture, "primary");
  assert.ok(outcome instanceof Error, "the primary request rejects without waiting for the fallback timeout");
  assert.equal(outcome.message, "Agent Host is unavailable");
});

test("a desktop primary request refuses a Host that is not serving instead of delivering a dead port", async (t) => {
  const fixture = await desktopFixture(t, {
    getHostManager: () => ({
      isServing: () => false,
      createRendererChannel() {
        return { port1: { close() {} } };
      },
      getGeneration: () => 1,
    }),
  });
  const outcome = await connectionOutcome(t, fixture, "primary");
  assert.ok(outcome instanceof Error, "a non-serving Host must not deliver a successful connection");
  assert.equal(outcome.message, "Agent Host is not ready");
});

test("the alternate primary environment-port entry also refuses a Host that is not serving", async (t) => {
  const fixture = await desktopFixture(t, {
    getHostManager: () => ({ isServing: () => false }),
    environmentManager: {
      attachRendererEnvironmentPort(environmentId, recipient) {
        recipient.postMessage("desktop:host-port", { environmentId, generation: 1 }, [messagePort()]);
      },
    },
  });
  await assert.rejects(fixture.boundary.bridge.requestEnvironmentPort("primary"), {
    message: "Agent Host is not ready",
  });
});

test("a failed primary port transfer preserves its error and closes the undelivered port", async (t) => {
  let closed = false;
  const fixture = await desktopFixture(t, {
    getHostManager: () => ({
      isServing: () => true,
      createRendererChannel: () => ({
        port1: {
          close: () => {
            closed = true;
          },
        },
      }),
      getGeneration: () => 4,
    }),
  });
  fixture.sender.postMessage = () => {
    throw new Error("Renderer port transfer failed");
  };
  const outcome = await connectionOutcome(t, fixture, "primary");
  assert.ok(outcome instanceof Error);
  assert.equal(outcome.message, "Renderer port transfer failed");
  assert.equal(closed, true, "the undelivered channel is released");
});

test("environment ports still require the live main window and its main frame", async (t) => {
  const fixture = await desktopFixture(t, {
    environmentManager: {
      attachRendererEnvironmentPort(environmentId, recipient) {
        recipient.postMessage("desktop:host-port", { environmentId, generation: 3 }, [messagePort()]);
      },
    },
    getHostManager: () => ({
      isServing: () => true,
      createRendererChannel: () => ({ port1: messagePort() }),
      getGeneration: () => 3,
    }),
  });
  const sender = fixture.sender;
  const trusted = { sender, senderFrame: sender.mainFrame };
  for (const environmentId of ["primary", "remote-one"]) {
    for (const event of [
      { ...trusted, sender: { ...sender } },
      { ...trusted, senderFrame: {} },
    ]) {
      fixture.boundary.event = event;
      const outcome = await connectionOutcome(t, fixture, environmentId);
      assert.ok(outcome instanceof Error);
      assert.equal(outcome.message, "Untrusted desktop IPC sender");
    }
    fixture.boundary.event = trusted;
    fixture.mainWindow.isDestroyed = () => true;
    const outcome = await connectionOutcome(t, fixture, environmentId);
    assert.ok(outcome instanceof Error);
    assert.equal(outcome.message, "Untrusted desktop IPC sender");
    fixture.mainWindow.isDestroyed = () => false;
  }
});

function messagePort() {
  return {
    closed: false,
    close() {
      this.closed = true;
    },
    postMessage() {},
    start() {},
  };
}

test("successful primary and remote requests retain distinct ports and generation metadata", async (t) => {
  const fixture = await desktopFixture(t, {
    environmentManager: {
      attachRendererEnvironmentPort(environmentId, recipient) {
        recipient.postMessage("desktop:host-port", { environmentId, generation: 7 }, [messagePort()]);
      },
    },
    getHostManager: () => ({
      isServing: () => true,
      createRendererChannel: () => ({ port1: messagePort() }),
      getGeneration: () => 4,
    }),
  });
  const [primary, remote, secondRemote] = await Promise.all([
    fixture.requestEnvironmentPort("primary", undefined, 4),
    fixture.requestEnvironmentPort("remote-one", undefined, 7),
    fixture.requestEnvironmentPort("remote-one", undefined, 7),
  ]);
  assert.equal(primary.generation, 4);
  assert.equal(remote.generation, 7);
  assert.equal(secondRemote.generation, 7);
  assert.notEqual(primary.port, remote.port);
  assert.notEqual(remote.port, secondRemote.port);
});

test("synchronous desktop delivery clears cancellation and timeout work before an independent primary probe", async (t) => {
  const ports = [];
  const fixture = await desktopFixture(t, {
    getHostManager: () => ({
      isServing: () => true,
      createRendererChannel() {
        const port1 = messagePort();
        ports.push(port1);
        return { port1 };
      },
      getGeneration: () => 4,
    }),
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new globalThis.AbortController();
  const delivered = await fixture.requestEnvironmentPort("primary", controller.signal, 4);
  controller.abort();
  t.mock.timers.tick(15_000);
  assert.equal(await fixture.boundary.bridge.requestHostPort(), undefined);
  assert.equal(delivered.port, ports[0]);
  assert.equal(delivered.generation, 4);
  assert.equal(delivered.port.closed, false);
  assert.notEqual(ports[1], delivered.port);
  assert.equal(ports[1].closed, false);
});

test("a main-process error after synchronous delivery cannot replace that port or poison a concurrent request", async (t) => {
  let failAfterDelivery = true;
  const fixture = await desktopFixture(t, {
    environmentManager: {
      attachRendererEnvironmentPort(environmentId, recipient) {
        recipient.postMessage("desktop:host-port", { environmentId, generation: 7 }, [messagePort()]);
        if (failAfterDelivery) {
          failAfterDelivery = false;
          throw new Error("Old delivery acknowledgement failed");
        }
      },
    },
  });
  const first = fixture.requestEnvironmentPort("remote-one", undefined, 7);
  const second = fixture.requestEnvironmentPort("remote-one", undefined, 7);
  const [original, current] = await Promise.all([first, second]);
  await new Promise(setImmediate);
  assert.notEqual(original.port, current.port);
  assert.equal(original.port.closed, false);
  assert.equal(current.port.closed, false);
  assert.equal(original.generation, 7);
  assert.equal(current.generation, 7);
});

test("cancelling before a failed invoke settles does not reject a synchronous reconnection to the same environment", async (t) => {
  let offline = true;
  const fixture = await desktopFixture(t, {
    environmentManager: {
      attachRendererEnvironmentPort(environmentId, recipient) {
        if (offline) throw new Error("Environment is not connected");
        recipient.postMessage("desktop:host-port", { environmentId, generation: 2 }, [messagePort()]);
      },
    },
  });
  const controller = new globalThis.AbortController();
  const cancelled = fixture.requestEnvironmentPort("remote-one", controller.signal, 1);
  const cancellation = assert.rejects(cancelled, /Environment connection was cancelled/u);
  controller.abort();
  offline = false;
  const reconnect = fixture.requestEnvironmentPort("remote-one", undefined, 2);
  await cancellation;
  const delivered = await reconnect;
  await new Promise(setImmediate);
  assert.equal(delivered.generation, 2);
  assert.equal(delivered.port.closed, false);
});

test("stale synchronous desktop delivery is closed while the requested generation remains connectable", async (t) => {
  const ports = [];
  let generation = 1;
  const fixture = await desktopFixture(t, {
    environmentManager: {
      attachRendererEnvironmentPort(environmentId, recipient) {
        const port = messagePort();
        ports.push(port);
        recipient.postMessage("desktop:host-port", { environmentId, generation }, [port]);
      },
    },
  });
  const pending = fixture.requestEnvironmentPort("remote-one", undefined, 2);
  assert.equal(ports[0].closed, true);
  generation = 2;
  assert.equal(await fixture.boundary.bridge.requestEnvironmentPort("remote-one"), undefined);
  const delivered = await pending;
  assert.equal(delivered.port, ports[1]);
  assert.equal(delivered.generation, 2);
  assert.equal(delivered.port.closed, false);
});

test("preview pages do not receive the desktop environment-port bridge", async (t) => {
  const fixture = await desktopFixture(t, { location: "app://preview/untrusted/index.html" });
  assert.equal(fixture.boundary.bridge, null);
  const outcome = await connectionOutcome(t, fixture, "remote-one");
  assert.ok(outcome instanceof Error);
  assert.equal(outcome.message, "Environment MessagePort is unavailable");
});

test("an unavailable environment manager fails immediately rather than leaving a remote request waiting", async (t) => {
  const fixture = await desktopFixture(t);
  const outcome = await connectionOutcome(t, fixture, "remote-one");
  assert.ok(outcome instanceof Error);
  assert.equal(outcome.message, "Environment manager is unavailable");
});

test("desktop port request promises reject with the original error instead of resolving an error payload", async (t) => {
  const fixture = await desktopFixture(t);
  await assert.rejects(fixture.boundary.bridge.requestHostPort(), { message: "Agent Host is unavailable" });
  await assert.rejects(fixture.boundary.bridge.requestEnvironmentPort("remote-one"), {
    message: "Environment manager is unavailable",
  });
});

test("successful legacy desktop probes may ignore the new void promises", async (t) => {
  const fixture = await desktopFixture(t, {
    getHostManager: () => ({
      isServing: () => true,
      createRendererChannel: () => ({ port1: messagePort() }),
      getGeneration: () => 4,
    }),
    environmentManager: {
      attachRendererEnvironmentPort(environmentId, recipient) {
        recipient.postMessage("desktop:host-port", { environmentId, generation: 7 }, [messagePort()]);
      },
    },
  });
  fixture.boundary.bridge.requestHostPort();
  fixture.boundary.bridge.requestEnvironmentPort("remote-one");
  await new Promise(setImmediate);
});
