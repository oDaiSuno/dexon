import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

/**
 * Phase 4 preview capture harness. Loads the static preview assembly in a
 * hidden Electron window, drives the real components through
 * window.preview.configure and captures the eight confirmation screens plus
 * supporting evidence. A temp userData profile keeps the run fully isolated;
 * all external requests are cancelled.
 */

const outputDir = process.env.UI_PREVIEW_OUT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "previews");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-ui-preview-"));
app.setPath("userData", path.join(temp, "profile"));

let window: BrowserWindow | undefined;
const watchdog = setTimeout(() => {
  console.error("ui-preview capture timed out");
  app.exit(1);
}, 180_000);

interface Shot {
  name: string;
  screen: string;
  theme: "light" | "dark";
  lang: "zh" | "en";
  width: number;
  height: number;
  state?: { search?: boolean; menu?: boolean };
  /** Real Tab key presses before capture (keyboard focus evidence). */
  keyboardTabs?: number;
  evidence?: boolean;
}

const BASE_SIZE = { width: 1280, height: 860 };

const SHOTS: Shot[] = [
  { name: "01-chat-expanded-light", screen: "chat-expanded", theme: "light", lang: "zh", ...BASE_SIZE },
  { name: "02-chat-expanded-dark", screen: "chat-expanded", theme: "dark", lang: "zh", ...BASE_SIZE },
  { name: "03-chat-rail-light", screen: "chat-rail", theme: "light", lang: "zh", ...BASE_SIZE },
  { name: "04-chat-rail-dark", screen: "chat-rail", theme: "dark", lang: "zh", ...BASE_SIZE },
  { name: "05-plugins-light", screen: "plugins", theme: "light", lang: "zh", ...BASE_SIZE },
  { name: "06-plugins-dark", screen: "plugins", theme: "dark", lang: "zh", ...BASE_SIZE },
  { name: "07-skills-light", screen: "skills", theme: "light", lang: "zh", ...BASE_SIZE },
  { name: "08-skills-dark", screen: "skills", theme: "dark", lang: "zh", ...BASE_SIZE },
  // Evidence shots for the remaining acceptance checks (not part of the 8).
  {
    name: "evidence-search-open-light",
    screen: "chat-expanded",
    theme: "light",
    lang: "zh",
    ...BASE_SIZE,
    state: { search: true },
    evidence: true,
  },
  {
    name: "evidence-space-menu-open-light",
    screen: "chat-expanded",
    theme: "light",
    lang: "zh",
    ...BASE_SIZE,
    state: { menu: true },
    evidence: true,
  },
  {
    name: "evidence-focus-space-menu-light",
    screen: "chat-expanded",
    theme: "light",
    lang: "zh",
    ...BASE_SIZE,
    keyboardTabs: 2,
    evidence: true,
  },
  {
    name: "evidence-lang-en-chat-expanded",
    screen: "chat-expanded",
    theme: "light",
    lang: "en",
    ...BASE_SIZE,
    evidence: true,
  },
  {
    name: "evidence-900px-chat-expanded-dark",
    screen: "chat-expanded",
    theme: "dark",
    lang: "zh",
    width: 900,
    height: 760,
    evidence: true,
  },
  {
    name: "evidence-640px-chat-expanded-light",
    screen: "chat-expanded",
    theme: "light",
    lang: "zh",
    width: 640,
    height: 760,
    evidence: true,
  },
];

const js = <T = unknown>(code: string): Promise<T> => window!.webContents.executeJavaScript(code, true) as Promise<T>;

async function capture(shot: Shot): Promise<{ file: string }> {
  window!.setContentSize(shot.width, shot.height);
  const result = await js<{ ok: boolean }>(
    `window.preview.configure(${JSON.stringify({ screen: shot.screen, theme: shot.theme, lang: shot.lang, state: shot.state, freeze: true })})`,
  );
  if (!result?.ok) throw new Error(`configure failed for ${shot.name}`);
  if (shot.state?.search) {
    // The evidence shot must actually show the expanded, focused search box.
    const probe = await js<{ present: boolean; focused: boolean }>(
      `(() => { const input = document.querySelector('.app-nav input[type="search"]');
        return { present: !!input, focused: document.activeElement === input }; })()`,
    );
    if (!probe.present || !probe.focused) {
      throw new Error(`search-open state not achieved for ${shot.name}: ${JSON.stringify(probe)}`);
    }
  }
  // Real keyboard events trigger Chromium's :focus-visible heuristic, which
  // programmatic focus() does not — the focus evidence needs the visible ring.
  if (shot.keyboardTabs) {
    window!.webContents.focus();
    for (let i = 0; i < shot.keyboardTabs; i += 1) {
      window!.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
      window!.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    const focused = await js<string>(
      "document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? 'none'",
    );
    console.error(`[focus] after ${shot.keyboardTabs} tabs: ${focused}`);
  }
  const image = await window!.webContents.capturePage();
  const file = path.join(outputDir, `${shot.name}.png`);
  fs.writeFileSync(file, image.toPNG());
  return { file };
}

async function reducedMotionEvidence(): Promise<{
  checked: number;
  smilNodes: number;
  offenders: Array<Record<string, string>>;
  pass: boolean;
}> {
  window!.webContents.debugger.attach("1.3");
  try {
    await window!.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await js(`window.preview.configure({ screen: "chat-expanded", theme: "light", lang: "zh" })`);
    const motion = await js<{
      values: Array<{ kind: string; duration?: string; name?: string; property?: string }>;
      smilNodes: number;
    }>("window.preview.measureMotion()");
    // CSS durations near zero do not control SVG (SMIL) animations (review R2):
    // a complete fallback must also report zero animated svg nodes.
    const offenders = [
      ...motion.values.filter(
        (item) =>
          (item.kind === "animation" && item.duration && parseFloat(item.duration) > 0.001) ||
          (item.kind === "transition" && item.duration && parseFloat(item.duration) > 0.001),
      ),
      ...(motion.smilNodes > 0 ? [{ kind: "smil", duration: `${motion.smilNodes} animated svg nodes` }] : []),
    ];
    await window!.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
    return {
      checked: motion.values.length,
      smilNodes: motion.smilNodes,
      offenders,
      pass: offenders.length === 0,
    };
  } finally {
    window!.webContents.debugger.detach();
  }
}

async function run(): Promise<void> {
  await app.whenReady();
  window = new BrowserWindow({
    width: BASE_SIZE.width,
    height: BASE_SIZE.height,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("console-message", (_event, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer:${level}] ${source}:${line} ${message}`);
  });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/.test(details.url) }),
  );
  await window.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html"));

  fs.mkdirSync(outputDir, { recursive: true });
  const records: Array<Record<string, unknown>> = [];
  for (const shot of SHOTS) {
    const { file } = await capture(shot);
    records.push({ ...shot, file, evidence: Boolean(shot.evidence) });
  }

  // Review R1: the nav controls must render with the production typeface, so
  // the preview inherits the real preflight/font configuration.
  const typography = await js<{ body: string; button: string | null; fontFaces: string[] }>(
    "window.preview.probeTypography()",
  );
  const facesOk = ["Inter/100 900", "Geist Mono/100 900"].every((expected) => typography.fontFaces.includes(expected));
  const typographyPass = Boolean(
    typography.button && typography.button === typography.body && typography.body.includes("Inter") && facesOk,
  );
  if (!typographyPass) {
    console.error(
      `typography mismatch: body=${typography.body} button=${typography.button} faces=${typography.fontFaces.join(", ")}`,
    );
    clearTimeout(watchdog);
    app.exit(1);
    return;
  }

  const motion = await reducedMotionEvidence();

  const evidence = {
    capturedAt: new Date().toISOString(),
    environment: {
      platform: `${process.platform} ${process.arch}`,
      electron: process.versions.electron,
      node: process.versions.node,
      windowSize: BASE_SIZE,
    },
    shots: records,
    reducedMotion: motion,
    typography,
  };
  fs.writeFileSync(path.join(outputDir, "evidence.json"), JSON.stringify(evidence, null, 2));

  const baseShots = records.filter((record) => !record.evidence);
  const emptyBase = baseShots.filter((record) => fs.statSync(String(record.file)).size === 0);
  if (baseShots.length !== 8 || emptyBase.length > 0 || !motion.pass) {
    console.error("capture verification failed:", {
      baseShots: baseShots.length,
      empty: emptyBase.map((record) => record.name),
      motion,
    });
    clearTimeout(watchdog);
    app.exit(1);
    return;
  }
  console.log(`captured ${baseShots.length} base screens + ${records.length - baseShots.length} evidence shots`);
  clearTimeout(watchdog);
  app.exit(0);
}

process.on("unhandledRejection", (error) => {
  console.error(error);
  app.exit(1);
});

void run();
