import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import {
  remoteProjectsScenes as requiredScenes,
  remoteProjectLabels as labels,
  seedRemoteProjectsNative,
  startRemoteProjectsDaemon,
} from "../fixtures/remote-projects-native.mjs";
import { createRemoteProjectsDriver } from "./remote-projects-page.mjs";
import {
  verifyUnifiedSidebar,
  verifyRemoteMenu,
  verifyProjectSources,
  verifyPolicyAttribution,
} from "./remote-projects-navigation.mjs";
import { verifyRemoteAffordances } from "./remote-projects-affordances.mjs";
import { verifyScopedFiles } from "./remote-projects-files.mjs";
import {
  verifyOutageDraft,
  verifyOfflineAndBlocked,
  verifyZeroSessionRestart,
  verifyOneTimeMigration,
  verifyThemeStates,
} from "./remote-projects-connection.mjs";

configureSmokeEnvironment();
app.commandLine.appendSwitch("lang", "en-US");
const fixture = seedRemoteProjectsNative();
const output = process.env.DEXON_REMOTE_PROJECTS_OUT;
if (!output || !path.isAbsolute(output)) throw new Error("Remote projects requires an absolute evidence directory");
const entry = path.join(process.cwd(), "out/main/main.js");
const records = [];
const failures = [];
const consoleErrors = [];
const daemons = [];
const views = {};
let window;
let driver;
let cleaned = false;
let currentScene = requiredScenes[0];
const loaded = new Promise((resolve, reject) => {
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
  failures.push("Production remote projects exceeded its 330s deadline");
  void cleanup()
    .catch((error) => failures.push(String(error)))
    .finally(() => {
      writeCompletion("watchdog");
      app.exit(1);
    });
}, 330000);

async function cleanup() {
  const results = await Promise.allSettled(daemons.map((daemon) => daemon.dispose()));
  const errors = results.filter((result) => result.status === "rejected");
  if (errors.length)
    throw new AggregateError(
      errors.map((result) => result.reason),
      "Daemon cleanup failed",
    );
  cleaned = true;
}

async function scene(name, check) {
  currentScene = name;
  console.log(`production-remote-projects: ${name}`);
  const observation = await check();
  records.push({ name, pass: true, observation, screenshot: await driver.screenshot(name) });
}

async function addRemote(daemon, label) {
  const view = await driver.bridge("environmentCommand", {
    type: "add",
    draft: { label, target: { kind: "websocket", url: daemon.endpoint }, authToken: daemon.authToken },
    connect: true,
  });
  await driver.waitFor(
    async () => {
      const snapshot = await driver.bridge("listEnvironments");
      return snapshot.environments.some((item) => item.id === view.id && item.status.phase === "connected");
    },
    `the independent ${label} daemon connected`,
    20000,
  );
  return view;
}

async function mount(view, project) {
  await driver.settings();
  await driver.click({ role: "tab", name: "Servers" });
  await driver.click({ role: "button", name: "Open project", scope: { role: "article", name: view.label } });
  const scope = { role: "dialog", name: labels.picker };
  await driver.waitFor(() => driver.exists(scope), "the production folder picker");
  await driver.fill(labels.path, project, scope);
  await driver.click({ role: "button", name: "Go ↵", scope });
  await driver.waitFor(async () => {
    const confirm = (await driver.page("elements", { role: "button", name: labels.confirm, scope }))[0];
    return confirm && !confirm.disabled;
  }, "the remote folder can be mounted");
  await driver.click({ role: "button", name: labels.confirm, scope });
  await driver.waitFor(async () => !(await driver.exists(scope)), "the confirmed picker closed");
  await driver.waitFor(async () => {
    const state = await driver.bridge("getUiState");
    return state.projectSpaces?.spaces.some((space) => space.environmentId === view.id && space.path === project);
  }, "the native picker persisted the mounted remote project");
}

async function run() {
  await loaded;
  driver = createRemoteProjectsDriver({ window, output });
  await scene(requiredScenes[0], async () => {
    await driver.ready();
    await driver.waitFor(() => driver.exists({ role: "button", name: "Settings" }), "the healthy production app");
    assert.doesNotMatch(await driver.page("text"), /UI crashed|Cannot connect to Agent Host/u);
    window.webContents.closeDevTools();
    window.setContentSize(1344, 1000);
    for (const name of ["alpha", "beta"])
      daemons.push(
        await startRemoteProjectsDaemon({
          root: process.cwd(),
          node: process.env.DEXON_REMOTE_PROJECTS_NODE,
          output,
          name,
          label: labels[name],
        }),
      );
    assert.equal(window.webContents.getURL(), "app://bundle/index.html");
    const preload = path.join(process.cwd(), "out/preload/preload.js");
    assert.ok(fs.statSync(preload).isFile());
    assert.notEqual(daemons[0].pid, daemons[1].pid);
    assert.notEqual(daemons[0].environmentId, daemons[1].environmentId);
    for (const daemon of daemons) {
      assert.notEqual(daemon.pid, process.pid);
      assert.ok(daemon.isAlive());
      assert.match(daemon.endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/rpc$/u);
      assert.equal(
        (await daemon.rpc("sessions.list")).sessions.length,
        0,
        "Each independent daemon starts with no sessions",
      );
    }
    views.alpha = await addRemote(daemons[0], labels.alpha);
    views.beta = await addRemote(daemons[1], labels.beta);
    await mount(views.alpha, fixture.project);
    await driver.key("Escape");
    await driver.waitFor(
      async () => !(await driver.exists({ role: "region", name: "Settings" })),
      "Settings closed by native Escape",
    );
    return {
      entry,
      preload,
      renderer: window.webContents.getURL(),
      viewport: window.getContentSize(),
      daemons: daemons.map((daemon) => ({
        pid: daemon.pid,
        entry: daemon.entry,
        args: daemon.args,
        endpoint: daemon.endpoint,
        environmentId: daemon.environmentId,
      })),
      mounted: { environmentId: views.alpha.id, path: fixture.project, sessions: 0 },
      filesystemModel: fixture.filesystemModel,
    };
  });
  const context = { driver, fixture, views, daemons, mount, addRemote, output };
  await scene(requiredScenes[1], () => verifyUnifiedSidebar(context));
  await scene(requiredScenes[2], () => verifyRemoteMenu(context));
  await scene(requiredScenes[3], () => verifyProjectSources(context));
  await scene(requiredScenes[4], () => verifyPolicyAttribution(context));
  await scene(requiredScenes[5], () => verifyRemoteAffordances(context));
  await scene(requiredScenes[6], () => verifyScopedFiles(context));
  await scene(requiredScenes[7], () => verifyOutageDraft(context));
  await scene(requiredScenes[8], () => verifyOfflineAndBlocked(context));
  await scene(requiredScenes[9], () => verifyZeroSessionRestart(context));
  await scene(requiredScenes[10], () => verifyOneTimeMigration(context));
  await scene(requiredScenes[11], () => verifyThemeStates(context));
  currentScene = "renderer-error-gate";
  assert.deepEqual(consoleErrors, [], "The production renderer emitted no errors");
}

function writeCompletion(shutdown) {
  const pass =
    failures.length === 0 &&
    consoleErrors.length === 0 &&
    cleaned &&
    requiredScenes.every((name) => records.some((record) => record.name === name && record.pass));
  fs.writeFileSync(
    process.env.DEXON_ELECTRON_RESULT,
    JSON.stringify(
      {
        completed: true,
        pid: process.pid,
        check: "production-remote-projects",
        pass,
        entry,
        evidenceDirectory: output,
        shutdown,
        platform: process.platform,
        arch: process.arch,
        daemonsCleaned: cleaned,
        proofBoundary: {
          productionMainPreloadAndRenderer: true,
          osProtocolRegistrationDisabled: true,
          rendererStoreInjection: false,
          filesystemModel: fixture.filesystemModel,
          limitations: [
            "No personal home, desktop data, model credentials, LLM response, running-task survival, or live stream replay is exercised.",
            "The local folder choice is visible and a real local path is opened through native switcher search. The OS folder dialog is not automated.",
            "Historical migration uses an actual SDK-persisted transcript fixture, not injected renderer or main application state.",
            "Blob evidence covers separately rendered environment-scoped reads, not forced concurrent pending-cache requests.",
          ],
        },
        daemons: daemons.map((daemon) => ({ generations: daemon.generations })),
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
    console.error(`Production remote projects failed at ${currentScene}:`, error);
    const diagnostics = await Promise.allSettled([
      driver
        ?.page("diagnostics")
        .then((state) =>
          fs.writeFileSync(
            path.join(output, "failure-page.json"),
            JSON.stringify({ scene: currentScene, ...state }, null, 2),
          ),
        ),
      driver?.screenshot(`${currentScene}-failed`, false),
    ]);
    for (const result of diagnostics) if (result.status === "rejected") failures.push(String(result.reason));
    records.push({
      name: currentScene,
      pass: false,
      error: error.message,
      screenshot: diagnostics[1].status === "fulfilled" ? diagnostics[1].value : null,
    });
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      failures.push(String(error));
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
  writeCompletion("main-load-failed");
  app.exit(1);
} finally {
  app.setAsDefaultProtocolClient = registerProtocol;
}
