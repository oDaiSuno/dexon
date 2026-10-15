#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { createProjectBuildTemp } from "./process-utils.mjs";
import { runElectronCheck } from "./electron-test-run.mjs";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".artifacts/interactive-tools/electron");
fs.mkdirSync(output, { recursive: true });
const directory = createProjectBuildTemp(root, "dexon-interactive-build-");
try {
  await build({
    absWorkingDir: root,
    entryPoints: ["src/smoke/interactive-tools-renderer.mjs"],
    bundle: true,
    platform: "browser",
    format: "iife",
    tsconfig: "tsconfig.renderer.json",
    outfile: path.join(directory, "renderer.js"),
  });
  await build({
    absWorkingDir: root,
    entryPoints: ["src/smoke/interactive-tools-harness.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: path.join(directory, "main.mjs"),
  });
  fs.writeFileSync(
    path.join(directory, "preload.cjs"),
    `const {contextBridge, ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('toolHarness',{
 command: c=>ipcRenderer.invoke('tool-harness-command',c),snapshot:()=>ipcRenderer.invoke('tool-harness-snapshot'),
 start:()=>ipcRenderer.invoke('tool-harness-start'),settled:()=>ipcRenderer.invoke('tool-harness-settled'),
 onSnapshot:callback=>ipcRenderer.on('tool-harness-snapshot',(_e,s)=>callback(s))});`,
  );
  const fonts = path.join(root, "src/renderer/fonts");
  fs.copyFileSync(path.join(fonts, "GeistSans.woff2"), path.join(directory, "GeistSans.woff2"));
  fs.copyFileSync(path.join(fonts, "GeistMono.woff2"), path.join(directory, "GeistMono.woff2"));
  fs.writeFileSync(
    path.join(directory, "index.html"),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'"><link rel="stylesheet" href="renderer.css"><style>
 @font-face{font-family:Geist;src:url(GeistSans.woff2)}@font-face{font-family:'Geist Mono';src:url(GeistMono.woff2)}
 #canvas{margin:0 auto;padding:24px;max-width:100%;height:100vh;display:flex;flex-direction:column}.history{flex:1;min-height:80px;overflow:auto;color:var(--text-muted);padding:16px 0}.composer{padding:16px;border:1px solid var(--border);border-radius:var(--radius-composer);background:var(--bg-panel);color:var(--text-muted)}
 </style></head><body><main id="canvas" class="chat-appearance-scope"><div class="history" id="context">Conversation context remains readable and selectable while answering.<p>Review the earlier discussion, then return to the same request.</p></div><div id="cards"></div><div class="composer">Message composer</div></main><script src="renderer.js"></script></body></html>`,
  );
  await runElectronCheck({
    name: "interactive-tools",
    root,
    main: path.join(directory, "main.mjs"),
    env: { DEXON_RENDERER_OUT: output },
    evidence: path.join(output, "evidence.json"),
  });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
