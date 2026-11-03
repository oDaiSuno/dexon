import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";

configureSmokeEnvironment();
const directory = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.DEXON_RENDERER_OUT;
const records = [];
const failures = [];
let window;
const js = (code) => window.webContents.executeJavaScript(code, true);
const watchdog = setTimeout(() => app.exit(1), 120_000);

async function waitFor(code) {
  await js(
    `new Promise((resolve,reject)=>{const end=Date.now()+12000;const check=()=>{let ok=false;try{ok=!!(${code})}catch{};if(ok)resolve();else if(Date.now()>end)reject(new Error('Page condition: '+${JSON.stringify(code)}));else setTimeout(check,25)};check()})`,
  );
}

async function click(role, name) {
  const at = await js(
    `(() => {const element=window.sshProof.find(${JSON.stringify(role)},${JSON.stringify(name)});const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
  );
  await waitFor(
    `window.sshProof.find(${JSON.stringify(role)},${JSON.stringify(name)}).contains(document.elementFromPoint(${at.x},${at.y}))`,
  );
  window.webContents.sendInputEvent({ type: "mouseMove", ...at });
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...at });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...at });
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
}

async function press(keyCode) {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode });
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
}

async function capture(name, observation, pass = true) {
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  fs.writeFileSync(path.join(output, `${name}-small.png`), image.resize({ width: 640 }).toPNG());
  records.push({ name, pass, observation, screenshot: `${name}.png` });
}

async function scene01() {
  await waitFor("window.sshProof?.ready()");
  await js("document.fonts.ready");
  await js("window.sshProof.start()");
  await waitFor("window.sshProof.exists('button','Show file panel')");
  await js("window.sshProof.triggerSwitcher()");
  await waitFor("window.sshProof.exists('menuitem','Connect remote server (SSH)…')");
  assert.ok(
    await js("window.sshProof.exists('searchbox','Search or open a project…')"),
    "project switcher search is open",
  );
  await click("menuitem", "Connect remote server (SSH)…");
  await waitFor("window.sshProof.hasText('Step 1 of 2: choose or enter a remote server')");
  await waitFor("window.sshProof.exists('menuitem','Browse folders on prod-vps')");
  assert.ok(
    await js("window.sshProof.exists('textbox','SSH server address or command')"),
    "server address input is shown",
  );
  assert.ok(
    await js("window.sshProof.find('menuitem','Browse folders on prod-vps') instanceof window.HTMLElement"),
    "configured prod-vps server appears in step one",
  );
  await js("window.sshProof.typeIn('textbox','SSH server address or command','ssh -p 2222 ubuntu@47.98.12.34')");
  await waitFor(
    "window.sshProof.hasText('Recognized the terminal command: user ubuntu · host 47.98.12.34 · port 2222')",
  );
  await js("window.sshProof.typeIn('textbox','SSH server address or command','')");
  await waitFor("!window.sshProof.hasText('Recognized the terminal command')");
  await click("menuitem", "Browse folders on prod-vps");
  await waitFor("window.sshProof.exists('searchbox','Filter this directory…')");
  assert.ok(await js("window.sshProof.exists('button','Open /home/ubuntu/work')"), "root open button is shown");
  assert.deepEqual(
    await js("window.sshProof.names('menuitemradio')"),
    ["app", "billing", "datasets"],
    "Git repositories are pinned before plain folders",
  );
  await click("menuitemradio", "app");
  await waitFor("window.sshProof.exists('button','Open /home/ubuntu/work/app')");
  await click("button", "Open /home/ubuntu/work/app");
  await waitFor("window.sshProof.hasText('Investigate prod')");
  assert.ok(
    await js("window.sshProof.exists('navigation','Main navigation')"),
    "workspace opened and navigation present",
  );
  await capture("01-onboarding-connect-and-browse", {
    workspaceOpened: await js("window.sshProof.exists('navigation','Main navigation')"),
  });
}

async function scene02() {
  assert.ok(
    await js("!!window.sshProof.find('button','app @prod-vps')"),
    "sidebar remote project row shows app @prod-vps label",
  );
  assert.ok(await js("window.sshProof.hasText('@prod-vps')"), "sidebar displays the prod-vps host badge");
  assert.ok(await js("window.sshProof.hasText('app@prod-vps')"), "pulse well shows app@prod-vps prefix");
  await click("button", "Actions for app @prod-vps");
  await waitFor("window.sshProof.exists('menuitem','Copy full SSH address')");
  assert.ok(
    await js("window.sshProof.exists('menuitem','Copy full SSH address')"),
    "remote project menu offers Copy full SSH address",
  );
  assert.ok(
    await js("window.sshProof.exists('menuitem','Re-sync remote AGENTS.md and skills')"),
    "remote project menu offers Re-sync remote AGENTS.md and skills",
  );
  await press("Escape");
  await waitFor("!window.sshProof.exists('menuitem','Copy full SSH address')");
  await capture("02-sidebar-and-pulse-well", {
    sidebarBadge: await js("window.sshProof.hasText('@prod-vps')"),
    pulseWellPrefix: await js("window.sshProof.hasText('app@prod-vps')"),
  });
}

async function scene03() {
  await js("window.sshProof.openSession('ssh-ops')");
  await waitFor("window.sshProof.exists('status','Safe read-only browsing')");
  const bannerHeight = await js("window.sshProof.height('status','Safe read-only browsing')");
  assert.equal(bannerHeight, 36, "read-only banner is 36px tall");
  assert.ok(await js("window.sshProof.exists('button','SSH connected · 22ms')"), "connection pill is visible");
  await click("button", "SSH connected · 22ms");
  await waitFor("window.sshProof.exists('dialog','Dual-space environment and rule lens')");
  assert.ok(await js("window.sshProof.hasText('~/.pi/agent/AGENTS.md')"), "rule lens shows local AGENTS.md");
  assert.ok(await js("window.sshProof.hasText('auth.json')"), "rule lens shows auth.json is blocked");
  assert.ok(await js("window.sshProof.hasText('/home/ubuntu/work/app/AGENTS.md')"), "rule lens shows remote AGENTS.md");
  assert.ok(
    await js("window.sshProof.exists('button','Trust this remote repository')"),
    "trust action present in lens",
  );
  await capture("03-trust-banner-and-rule-lens", { bannerHeight, lensOpen: true });
  await press("Escape");
  await waitFor("!window.sshProof.exists('dialog','Dual-space environment and rule lens')");
  await js("window.sshProof.emitTrustPrompt()");
  await waitFor("window.sshProof.exists('alert','process_start paused')");
  assert.ok(
    await js("window.sshProof.exists('alert','process_start paused')"),
    "process_start trust prompt appears on demand",
  );
  await click("button", "Trust this remote repository and continue ↵");
  await waitFor("!window.sshProof.exists('alert','process_start paused')");
  await waitFor("!window.sshProof.exists('status','Safe read-only browsing')");
  assert.ok(await js("window.sshProof.exists('button','SSH connected · 22ms')"), "trust granted and the pill remains");
  await capture("03-trust-banner-and-rule-lens-prompt-approved", { promptApproved: true });
}

async function scene04() {
  await js("window.sshProof.openProcesses()");
  await js("window.sshProof.setProcess('mapping')");
  await waitFor("window.sshProof.hasText('Remote :3000 → opening local tunnel…')");
  assert.ok(await js("window.sshProof.hasText('Remote :3000 → opening local tunnel…')"), "mapping capsule is shown");
  assert.ok(!(await js("window.sshProof.exists('button',{pattern:'Preview'})")), "a mapping port cannot be previewed");
  await js("window.sshProof.setProcess('available')");
  await waitFor("window.sshProof.exists('button','Remote :3000 ⇄ local 127.0.0.1:54321 · Preview ↗')");
  assert.ok(
    await js("window.sshProof.exists('button','Remote :3000 ⇄ local 127.0.0.1:54321 · Preview ↗')"),
    "available capsule has a Preview button",
  );
  await click("button", "Remote :3000 ⇄ local 127.0.0.1:54321 · Preview ↗");
  await waitFor("window.sshProof.hasText('SSH tunnel · prod-vps:3000')");
  assert.ok(
    await js("window.sshProof.hasText('SSH tunnel · prod-vps:3000')"),
    "browser tab opens with SSH tunnel badge",
  );
  await click("button", "Explorer");
  await waitFor("window.sshProof.exists('button','Expand folder src')");
  for (const folder of ["src", "db"]) {
    await waitFor(`window.sshProof.exists('button','Expand folder ${folder}')`);
    await click("button", `Expand folder ${folder}`);
  }
  await waitFor("window.sshProof.exists('button','Open file pool.ts')");
  await click("button", "Open file pool.ts");
  await waitFor("window.sshProof.hasText('export const poolSize = 14;')");
  assert.ok(await js("window.sshProof.hasText('Live · prod-vps')"), "file viewer shows Live prod-vps indicator");
  await js("window.sshProof.emitDisconnect()");
  await waitFor("window.sshProof.hasText('Offline snapshot (read-only)')");
  assert.ok(
    await js("window.sshProof.hasText('Offline snapshot (read-only)')"),
    "file viewer falls back to Offline snapshot preserving content",
  );
  assert.ok(
    await js("window.sshProof.hasText('export const poolSize = 14;')"),
    "content is preserved after disconnect",
  );
  await waitFor("window.sshProof.disconnectNotices() === 1");
  await js("window.sshProof.openSession('local-ops')");
  await waitFor("window.sshProof.disconnectNotices() === 0");
  await capture("04-ports-viewer-and-disconnect-isolation", { isolationConfirmed: true });
}

async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    width: 1280,
    height: 760,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") failures.push(event.message);
  });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/.test(details.url) }),
  );
  await window.loadFile(path.join(directory, "index.html"));
  window.focus();
  window.webContents.focus();
  await scene01();
  await scene02();
  await scene03();
  await scene04();
  assert.deepEqual(await js("window.sshProof.unexpected()"), []);
  assert.deepEqual(failures, []);
}

async function main() {
  let exitCode = 0;
  try {
    await run();
    console.log(`SSH workspace: ${records.length} native scenes passed`);
  } catch (error) {
    exitCode = 1;
    failures.push(error.stack ?? String(error));
    console.error(error);
    if (window && !window.isDestroyed()) {
      await capture("failure", await js("document.body.innerText").catch(() => null), false).catch(() => {});
    }
  } finally {
    if (window && !window.isDestroyed()) {
      await js("window.sshProof?.close()").catch((error) => {
        failures.push(String(error));
        exitCode = 1;
      });
      window.destroy();
    }
    fs.writeFileSync(
      process.env.DEXON_ELECTRON_RESULT,
      JSON.stringify(
        {
          completed: exitCode === 0,
          pass: exitCode === 0,
          pid: process.pid,
          capturedAt: new Date().toISOString(),
          environment: {
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            chromium: process.versions.chrome,
          },
          records,
          failures,
        },
        null,
        2,
      ),
    );
    clearTimeout(watchdog);
    app.exit(exitCode);
  }
}

void main();
