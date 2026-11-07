import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import {
  remoteSettingsScenes as requiredScenes,
  remoteSettingsLabels as labels,
  remoteSettingsServer as server,
  seedRemoteSettingsNative,
  startRemoteSettingsDaemon,
} from "../fixtures/remote-settings-native.mjs";
import { createRemoteSettingsDriver } from "./remote-settings-page.mjs";
import { verifyRemoteSettingsMinimumWindow } from "./remote-settings-minimum-window.mjs";
import {
  verifyNativeServerForms,
  verifyNativeLifecyclePolicies,
  verifyNativeServerEdit,
  verifyNativeRemoval,
} from "./remote-settings-form-scenes.mjs";

configureSmokeEnvironment();
app.commandLine.appendSwitch("lang", "en-US");
const fixture = await seedRemoteSettingsNative();
const output = process.env.DEXON_REMOTE_SETTINGS_OUT;
if (!output || !path.isAbsolute(output)) throw new Error("Remote settings requires an absolute evidence directory");
const entry = path.join(process.cwd(), "out/main/main.js");
const records = [];
const failures = [];
const consoleErrors = [];
const settingsScope = { role: "region", name: "Settings" };
const pickerScope = { role: "dialog", name: labels.picker };
const addScope = { role: "dialog", name: labels.addDialog };
const button = (name, scope) => ({ role: "button", name, scope });
const card = (name = server.editedLabel) => ({ role: "article", name });
let window;
let driver;
let daemon;
let remoteView;
let baseline;
let daemonCleaned = false;
let currentScene = requiredScenes[0];
const startedAt = Date.now();
const loadedWindow = new Promise((resolve, reject) => {
  app.once("browser-window-created", (_event, created) => {
    window = created;
    window.webContents.setBackgroundThrottling(false);
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") consoleErrors.push(event.message);
    });
    window.webContents.once("did-finish-load", resolve);
    window.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) reject(new Error(`Production renderer failed: ${description}`));
    });
  });
});
const watchdog = setTimeout(() => {
  failures.push("Production remote settings exceeded its 210s deadline");
  void cleanup()
    .catch((error) => failures.push(`Watchdog cleanup failed: ${error}`))
    .finally(() => {
      writeCompletion("watchdog");
      app.exit(1);
    });
}, 210000);

async function cleanup() {
  if (daemon) {
    await daemon.dispose();
    daemonCleaned = true;
  }
}

async function scene(name, check) {
  currentScene = name;
  console.log(`production-remote-settings: ${name}`);
  const observation = await check();
  records.push({ name, pass: true, observation, screenshot: await driver.screenshot(name) });
}

async function workspace() {
  const ui = await driver.bridge("getUiState");
  return {
    projectSpaces: ui.projectSpaces ?? null,
    openProjects: ui.openProjects ?? null,
    lastSpaceCwd: ui.lastSpaceCwd ?? null,
  };
}

async function unchanged(description, expected = baseline) {
  assert.deepEqual(await workspace(), expected, description);
}

async function closeDialog(scope) {
  await driver.key("Escape");
  await driver.waitFor(async () => !(await driver.exists(scope)), `${scope.name} closed`);
}

async function addRemote() {
  const view = await driver.bridge("environmentCommand", {
    type: "add",
    draft: { label: server.label, target: { kind: "websocket", url: daemon.endpoint }, authToken: daemon.authToken },
    connect: true,
  });
  await driver.waitFor(
    async () => {
      remoteView = (await driver.bridge("listEnvironments")).environments.find((item) => item.id === view.id);
      return remoteView?.status.phase === "connected";
    },
    "the independent production daemon connected through preload",
    20000,
  );
  return remoteView;
}

async function openPicker() {
  await driver.settings();
  await driver.click({ role: "tab", name: "Servers" });
  await driver.click(button("Open project", card(remoteView.label)));
  await driver.waitFor(() => driver.exists(pickerScope), "the real remote folder picker");
  await driver.waitFor(
    async () => (await driver.page("text", { scope: pickerScope })).includes("workspace"),
    "the daemon home folder listing",
  );
}

async function openPath(value) {
  await driver.fill(labels.path, value, pickerScope);
  await driver.click(button(labels.go, pickerScope));
}

async function assertError(value, pattern) {
  await openPath(value);
  await driver.waitFor(
    async () => pattern.test(await driver.page("text", { scope: pickerScope })),
    "the public folder error",
  );
  const confirm = (await driver.page("elements", button(labels.confirm, pickerScope)))[0];
  assert.ok(confirm?.disabled, "a failed path cannot be confirmed");
  await unchanged("A failed remote path preserves the persisted focus and mounted projects");
  return { path: value, visibleError: await driver.page("text", { scope: pickerScope }) };
}

async function browseColumns() {
  await driver.click(button("Select folder workspace", pickerScope));
  await driver.waitFor(
    async () => (await driver.page("text", { scope: pickerScope })).includes("project"),
    "workspace children from the actual daemon",
  );
  const columns = await driver.page("columns", { scope: pickerScope });
  assert.equal(columns.length, 2, "the folder picker displays two folder columns");
  assert.ok(columns[0].rect.right <= columns[1].rect.x + 1, "the parent and child columns are side by side");
  assert.ok(
    columns.some((column) => column.text.includes("project") && column.text.includes("main")),
    "the project row displays its actual main branch",
  );
  await unchanged("Browsing remote columns does not change the persisted workspace");
  return columns;
}

async function run() {
  await loadedWindow;
  driver = createRemoteSettingsDriver({ window, output });
  await scene(requiredScenes[0], async () => {
    await driver.ready();
    await driver.waitFor(() => driver.exists(button("Settings")), "the healthy production app");
    assert.doesNotMatch(await driver.page("text"), /UI crashed|Cannot connect to Agent Host/u);
    window.webContents.closeDevTools();
    window.setContentSize(1280, 900);
    daemon = await startRemoteSettingsDaemon({
      root: process.cwd(),
      node: process.env.DEXON_REMOTE_SETTINGS_NODE,
      output,
    });
    assert.ok(daemon.isAlive(), "the standalone daemon is a separate live process");
    assert.notEqual(daemon.pid, process.pid);
    assert.equal(
      (await driver.bridge("listEnvironments")).environments.filter((view) => view.id !== "primary").length,
      0,
    );
    const renderer = { url: window.webContents.getURL(), entry: path.join(process.cwd(), "out/renderer/index.html") };
    const preload = path.join(process.cwd(), "out/preload/preload.js");
    assert.equal(renderer.url, "app://bundle/index.html", "the production protocol serves the built renderer");
    assert.ok(fs.statSync(renderer.entry).isFile());
    assert.ok(fs.statSync(preload).isFile(), "the built preload exposes the real environment IPC methods");
    return {
      entry,
      preload,
      renderer,
      independentDaemon: { pid: daemon.pid, entry: daemon.entry, args: daemon.args, endpoint: daemon.endpoint },
      viewport: window.getContentSize(),
    };
  });
  await scene(requiredScenes[1], async () => {
    await driver.settings();
    assert.deepEqual(
      (await driver.page("tabs")).map((tab) => tab.name),
      labels.tabs,
      "Settings has exactly six categories in the agreed order",
    );
    await driver.click({ role: "tab", name: "General" });
    assert.doesNotMatch(
      await driver.page("text", { scope: settingsScope }),
      /Development environments|Add environment|Remote environments|SSH alias|Environment connections/u,
    );
    for (const name of labels.tabs.slice(1)) {
      await driver.key("Down");
      await driver.waitFor(
        async () => (await driver.page("focus")).name === name,
        `${name} selected by native arrow input`,
      );
      assert.equal(await driver.page("attribute", { role: "tab", name, attribute: "aria-selected" }), "true");
    }
    await driver.theme("light");
    return { categories: labels.tabs, nativeKeyboardOrder: true, legacyGeneralEnvironmentControls: false };
  });
  await scene(requiredScenes[2], async () => {
    await driver.waitFor(
      async () => (await driver.page("text", { scope: settingsScope })).includes("No remote servers added yet"),
      "the Servers zero state",
    );
    assert.equal((await driver.page("elements", { role: "article", scope: settingsScope })).length, 0);
    const screens = [await driver.screenshot("servers-empty-light")];
    await driver.theme("dark");
    screens.push(await driver.screenshot("servers-empty-dark"));
    await driver.theme("light");
    return { noRemoteCards: true, screens };
  });
  await scene(requiredScenes[3], () =>
    verifyNativeServerForms({ driver, labels, server, fixture, settingsScope, addScope }),
  );
  await scene(requiredScenes[4], async () => {
    const result = await verifyNativeServerEdit({
      driver,
      labels,
      server,
      view: await addRemote(),
      nodeVersion: process.env.DEXON_REMOTE_SETTINGS_NODE_VERSION,
    });
    remoteView = result.view;
    return result.observation;
  });
  await scene(requiredScenes[5], async () => {
    const text = await driver.page("text", { scope: card() });
    assert.ok(text.includes(daemon.endpoint));
    assert.ok(text.includes(`${process.platform} ${process.arch}`));
    assert.ok(text.includes(`Node.js ${process.env.DEXON_REMOTE_SETTINGS_NODE_VERSION}`));
    assert.match(text, /Online/u);
    assert.ok(text.includes(labels.externalDaemon));
    assert.equal(remoteView.runtime.ownership, "external");
    assert.match(text, /Started/u);
    assert.match(text, /0 mounted project spaces/u);
    assert.equal(remoteView.descriptor.platform.home, daemon.home);
    assert.equal(remoteView.descriptor.environmentId, daemon.environmentId);
    assert.equal(remoteView.runtime.payloadVersion, "development");
    assert.ok(remoteView.runtime.startedAt >= startedAt && remoteView.runtime.startedAt <= Date.now());
    baseline = await workspace();
    return {
      environmentId: remoteView.id,
      descriptor: remoteView.descriptor,
      runtime: remoteView.runtime,
      persistedBeforeBrowse: baseline,
    };
  });
  await scene(requiredScenes[6], async () => {
    await openPicker();
    const initialPath = await driver.page("value", { role: "field", name: labels.path, scope: pickerScope });
    assert.ok(
      initialPath === "~" || initialPath === daemon.home,
      "the picker initially browses the selected remote home",
    );
    await unchanged("Opening the remote home does not change persisted focus");
    return { initialPath, columns: await browseColumns() };
  });
  await scene(requiredScenes[7], async () => {
    const errors = [await assertError(daemon.missing, /not found|does not exist|could not be found/iu)];
    errors.push(await assertError(daemon.file, /not a (?:folder|directory)/iu));
    if (daemon.denied) errors.push(await assertError(daemon.denied, /permission|access denied|cannot access/iu));
    await openPath(daemon.empty);
    await driver.waitFor(
      async () => /empty|no (?:sub)?folders/iu.test(await driver.page("text", { scope: pickerScope })),
      "the real empty directory",
    );
    await unchanged("An empty remote directory is still browsing, not a workspace change");
    return { errors, emptyFolder: daemon.empty, permissionDeniedCovered: Boolean(daemon.denied) };
  });
  await scene(requiredScenes[8], async () => {
    await driver.click(button("Cancel", pickerScope));
    await driver.waitFor(async () => !(await driver.exists(pickerScope)), "the picker cancelled");
    await unchanged("Cancel does not mount or focus a remote project");
    assert.ok(!(await workspace()).projectSpaces?.spaces.some((space) => space.environmentId === remoteView.id));
    return { persistedAfterCancel: await workspace(), mounted: false };
  });
  await scene(requiredScenes[9], async () => {
    await openPicker();
    await openPath(daemon.project);
    await driver.waitFor(async () => {
      const confirm = (await driver.page("elements", button(labels.confirm, pickerScope)))[0];
      return confirm && !confirm.disabled;
    }, "a valid project can be confirmed");
    await unchanged("A selected valid project has no effect before confirmation");
    await driver.click(button(labels.confirm, pickerScope));
    await driver.waitFor(async () => {
      const state = await workspace();
      return (
        state.projectSpaces?.spaces.some(
          (space) => space.environmentId === remoteView.id && space.path === daemon.project,
        ) &&
        state.projectSpaces.lastFocusedSpace?.environmentId === remoteView.id &&
        state.projectSpaces.lastFocusedSpace.path === daemon.project
      );
    }, "the confirmed remote project mounted and focused through the real bridge");
    await driver.waitFor(async () => !(await driver.exists(pickerScope)), "the confirmed picker closed");
    const after = await workspace();
    assert.equal(after.projectSpaces.spaces.length, (baseline.projectSpaces?.spaces.length ?? 0) + 1);
    for (const previous of baseline.projectSpaces?.spaces ?? [])
      assert.ok(
        after.projectSpaces.spaces.some(
          (space) => space.environmentId === previous.environmentId && space.path === previous.path,
        ),
      );
    baseline = after;
    return {
      confirmed: { environmentId: remoteView.id, path: daemon.project },
      persistedAfterConfirmation: after,
      sidebarRestylingRequired: false,
    };
  });
  await scene(requiredScenes[10], async () => {
    const observation = await verifyNativeLifecyclePolicies({ driver, labels });
    baseline = await workspace();
    return observation;
  });
  await scene(requiredScenes[11], async () => {
    const screens = [];
    for (const theme of ["light", "dark"]) {
      await driver.theme(theme);
      screens.push(await driver.screenshot(`servers-connected-${theme}`));
      await driver.click(button(labels.add, settingsScope));
      await driver.waitFor(() => driver.exists(addScope), "the Add dialog for screenshots");
      await driver.waitFor(
        async () => (await driver.page("text", { scope: addScope })).includes(server.sshAlias),
        "SSH discovery for screenshots",
      );
      screens.push(await driver.screenshot(`add-ssh-discovery-${theme}`));
      await driver.click(button(labels.manual, addScope));
      await driver.click(button(labels.advanced, addScope));
      screens.push(await driver.screenshot(`add-advanced-${theme}`));
      await closeDialog(addScope);
      await openPicker();
      await browseColumns();
      screens.push(await driver.screenshot(`picker-columns-${theme}`));
      await assertError(daemon.missing, /not found|does not exist|could not be found/iu);
      screens.push(await driver.screenshot(`picker-error-${theme}`));
      await driver.click(button("Cancel", pickerScope));
      await unchanged("Cancelling visual-only browsing preserves the confirmed remote project");
    }
    const minimumWindow = await verifyRemoteSettingsMinimumWindow({
      window,
      driver,
      labels,
      pickerScope,
      openPicker,
      browseColumns,
      unchanged,
    });
    return { screens, lowResolutionWidth: 640, minimumWindow };
  });
  await scene(requiredScenes[12], () =>
    verifyNativeRemoval({ driver, labels, view: remoteView, daemon, workspace, closeDialog }),
  );
  assert.deepEqual(consoleErrors, [], "production renderer emitted no errors");
}

function writeCompletion(shutdown) {
  const pass =
    failures.length === 0 &&
    consoleErrors.length === 0 &&
    daemonCleaned &&
    requiredScenes.every((name) => records.some((record) => record.name === name && record.pass));
  fs.writeFileSync(
    process.env.DEXON_ELECTRON_RESULT,
    JSON.stringify(
      {
        completed: true,
        pid: process.pid,
        check: "production-remote-settings",
        pass,
        entry,
        evidenceDirectory: output,
        shutdown,
        platform: process.platform,
        arch: process.arch,
        daemon: { pid: daemon?.pid, cleaned: daemonCleaned },
        records,
        failures,
        consoleErrors,
        blockedScenes: requiredScenes.filter((name) => !records.some((record) => record.name === name)),
      },
      null,
      2,
    ),
  );
  clearTimeout(watchdog);
}
app.once("will-quit", () => writeCompletion("will-quit"));

void run()
  .catch(async (error) => {
    failures.push(error.stack ?? String(error));
    console.error(`Production remote settings failed at ${currentScene}:`, error);
    const diagnostics = await Promise.allSettled([
      driver?.page("diagnostics").then((state) => {
        fs.writeFileSync(
          path.join(output, "failure-page.json"),
          JSON.stringify({ scene: currentScene, ...state }, null, 2),
        );
        return "failure-page.json";
      }),
      driver?.screenshot(`${currentScene}-failed`, false),
    ]);
    for (const result of diagnostics) if (result.status === "rejected") failures.push(String(result.reason));
    records.push({
      name: currentScene,
      pass: false,
      error: error.message,
      failurePage: diagnostics[0].status === "fulfilled" ? (diagnostics[0].value ?? null) : null,
      screenshot: diagnostics[1].status === "fulfilled" ? diagnostics[1].value : null,
    });
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      failures.push(`Daemon cleanup failed: ${error}`);
    }
    const quitDeadline = setTimeout(() => {
      failures.push("Production Electron did not quit within 8s after cleanup");
      writeCompletion("quit-deadline");
      app.exit(1);
    }, 8000);
    app.once("will-quit", () => clearTimeout(quitDeadline));
    app.quit();
  });

const loadMain = createRequire(path.join(process.cwd(), "package.json"));
const registerProtocol = app.setAsDefaultProtocolClient;
app.setAsDefaultProtocolClient = () => false;
try {
  loadMain(entry);
} catch (error) {
  failures.push(error.stack ?? String(error));
  records.push({ name: currentScene, pass: false, error: String(error) });
  writeCompletion("main-load-failed");
  app.exit(1);
} finally {
  app.setAsDefaultProtocolClient = registerProtocol;
}
