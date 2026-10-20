import { configureSmokeEnvironment } from "./environment";
import { writeNativeCompletion } from "./native-completion";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { AgentSessionWrapper } from "../agent-host/rpc-manager";
import { EXCLUDED_SDK_TOOL_NAMES } from "../agent-host/agent-session/excluded-tools";

configureSmokeEnvironment();

const directory = path.dirname(fileURLToPath(import.meta.url));
const outputValue = process.env.DEXON_RENDERER_OUT;
assert.ok(outputValue, "Interactive tools require an evidence directory");
const output = outputValue;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-tool-window-"));
app.setPath("userData", path.join(temp, "profile"));
let window: BrowserWindow | undefined;
let wrapper: AgentSessionWrapper | undefined;
let disposeSdk: (() => void) | undefined;
const watchdog = setTimeout(() => {
  console.error("Interactive tool window timed out");
  app.exit(1);
}, 80000);

async function run(): Promise<void> {
  await app.whenReady();
  window = new BrowserWindow({
    width: 1400,
    height: 950,
    show: false,
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/.test(details.url) }),
  );
  const cwd = path.join(temp, "project"),
    agentDir = path.join(temp, "agent"),
    sessionDir = path.join(temp, "sessions");
  [cwd, agentDir, sessionDir].forEach((dir) => fs.mkdirSync(dir));
  let continued = 0;
  let answer: string | undefined;
  let signalReady!: () => void, signalDone!: () => void;
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const done = new Promise<void>((resolve) => {
    signalDone = resolve;
  });
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: "window-fixture",
          factory(pi) {
            pi.registerCommand("tool-window", {
              handler: async (_args, ctx) => {
                answer = await ctx.ui.input("Read the context, then return to this answer");
                continued++;
              },
            });
          },
        },
      ],
    },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.create(cwd, sessionDir),
    excludeTools: [...EXCLUDED_SDK_TOOL_NAMES],
  });
  disposeSdk = () => session.dispose();
  wrapper = new AgentSessionWrapper(session, undefined, () => {});
  wrapper.start();
  wrapper.onEvent((event) => {
    if (event.type === "extension_ui_snapshot") {
      window?.webContents.send("tool-harness-snapshot", event.snapshot);
      if (wrapper!.getInteractiveSnapshot().requests.length) signalReady();
    }
    if (event.type === "prompt_done") signalDone();
  });
  ipcMain.handle("tool-harness-command", (_event, command: Record<string, unknown>) => wrapper!.send(command));
  ipcMain.handle("tool-harness-snapshot", () => wrapper!.getInteractiveSnapshot());
  ipcMain.handle("tool-harness-start", async () => {
    await wrapper!.send({ type: "prompt", message: "/tool-window" });
    await ready;
  });
  ipcMain.handle("tool-harness-settled", () => done);
  await window.loadFile(path.join(directory, "index.html"));
  window.showInactive();
  const js = <T = Record<string, unknown>>(code: string): Promise<T> =>
    window!.webContents.executeJavaScript(code, true) as Promise<T>;
  await js("window.fixture.frame()");
  const layouts: Record<string, unknown>[] = [];
  for (const width of [360, 768, 1280])
    for (const theme of ["light", "dark"])
      for (const font of ["small", "standard", "large", "extra-large"]) {
        window.setContentSize(width + 48, 950);
        const settings = { width, theme, font, mode: "preview", long: true };
        const result = await js(`window.fixture.configure(${JSON.stringify(settings)})`);
        assert.deepEqual(result.overflow, [], JSON.stringify(settings));
        assert.equal(result.primaryVisible, true);
        assert.equal(result.previewExecuted, false);
        assert.equal(result.cardWidth, width);
        assert.equal(result.bodyScroll, true);
        const editor = await js(`window.fixture.configure(${JSON.stringify({ ...settings, mode: "editor" })})`);
        assert.deepEqual(editor.overflow, []);
        assert.equal(editor.primaryVisible, true);
        layouts.push({
          ...settings,
          cardWidth: result.cardWidth,
          overflow: result.overflow,
          primaryVisible: result.primaryVisible,
          editorOverflow: editor.overflow,
        });
      }
  window.setContentSize(408, 600);
  const shortViewport = await js("window.fixture.configure({width:360,font:'extra-large',mode:'preview',long:true})");
  assert.equal(shortViewport.primaryVisible, true, "main action must remain reachable at the desktop minimum height");
  assert.deepEqual(shortViewport.overflow, []);
  assert.equal(shortViewport.composerVisible, true, "composer must remain reachable at the desktop minimum height");
  window.setContentSize(816, 950);
  for (const theme of ["light", "dark"])
    for (const mode of ["single", "multi", "preview", "collapsed", "abandon", "failed"]) {
      await js(`window.fixture.configure(${JSON.stringify({ theme, mode, width: 768 })})`);
      const screenshot = await window.webContents.capturePage();
      fs.writeFileSync(path.join(output, `${theme}-${mode}.png`), screenshot.toPNG());
      fs.writeFileSync(path.join(output, `${theme}-${mode}-small.png`), screenshot.resize({ width: 510 }).toPNG());
    }
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const reduced = await js("window.fixture.configure({mode:'single'})");
  assert.equal(reduced.reduced, true);
  const motion = reduced.motion as Array<{ animation: string; transition: string }>;
  assert.ok(
    motion.every(
      (m) => m.animation === "none" && m.transition.split(",").every((duration) => parseFloat(duration) === 0),
    ),
  );
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  window.webContents.debugger.detach();

  // Actual isolated SDK request through sandboxed Electron IPC and the production React card.
  await js("window.fixture.connect()");
  await js("window.fixture.start()");
  await js("window.fixture.edit('window answer survives reload')");
  await js("window.fixture.click('收起并保留答案')");
  assert.equal(continued, 0);
  assert.equal(wrapper.getInteractiveSnapshot().requests.length, 1);
  const selectedContext = await js<string>(
    `(() => {const range=document.createRange();range.selectNodeContents(document.getElementById('context'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();})()`,
  );
  assert.match(selectedContext, /Conversation context/);
  const reload = once(window.webContents, "did-finish-load");
  window.reload();
  await reload;
  await js("window.fixture.connect()");
  await js("document.querySelector('.tool-resume').click();window.fixture.frame()");
  const restored = await js("window.fixture.inspect()");
  const state = restored.state as { entries: Array<{ draft: { value: string } }> };
  assert.equal(state.entries[0].draft.value, "window answer survives reload");
  await js("window.fixture.click('发送回答')");
  await js("window.fixture.settle()");
  assert.equal(answer, "window answer survives reload");
  assert.equal(continued, 1);
  assert.equal(wrapper.getInteractiveSnapshot().requests.length, 0);
  fs.writeFileSync(
    path.join(output, "verification.json"),
    JSON.stringify(
      {
        layouts,
        shortViewport: { height: 600, width: 360, primaryVisible: shortViewport.primaryVisible },
        screenshots: 12,
        reducedMotion: true,
        sdkWindowLifecycle: { continued, answer, pending: 0 },
        platform: process.platform,
      },
      null,
      2,
    ),
  );
  console.log(
    "[interactive-tools] 24 layouts + long editors, 12 screenshots, reduced motion and real SDK/Electron resume lifecycle passed",
  );
}

void run()
  .then(async () => {
    await wrapper?.dispose();
    disposeSdk?.();
    window?.destroy();
    clearTimeout(watchdog);
    fs.rmSync(temp, { recursive: true, force: true });
    writeNativeCompletion("interactive-tools");
    app.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await wrapper?.dispose();
    disposeSdk?.();
    window?.destroy();
    clearTimeout(watchdog);
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(1);
  });
