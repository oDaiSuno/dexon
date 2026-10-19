#!/usr/bin/env node
import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";
const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
await runRendererElectronCheck({
  name: "composer-editing",
  renderer: "tests/e2e/composer-editing-renderer.mjs",
  main: "tests/e2e/composer-editing.harness.mjs",
  output: path.resolve(
    outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/composer-editing-electron"),
  ),
  requiredScenes: [
    "backspace-keeps-attachment",
    "backspace-at-boundary-removes-attachment-and-undo-restores-it",
    "pasted-screenshot-is-staged-edited-and-sent",
    "inserted-attachment-and-completion-follow-undo-and-redo",
    "typed-reference-closes-on-space-and-undo-keeps-it-text",
    "remove-button-and-reveal-act-on-the-attachment",
    "skills-start-the-message-and-are-replaced-not-stacked",
    "line-breaks-spaces-and-adjacent-attachments-survive-sending",
    "copy-cut-and-paste-carry-full-paths",
    "drafts-keep-separate-content-and-history",
    "composition-enter-does-not-send",
  ],
});
