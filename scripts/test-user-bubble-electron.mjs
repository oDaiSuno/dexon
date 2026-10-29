#!/usr/bin/env node
import path from "node:path";
import { runRendererElectronCheck } from "./renderer-electron-check.mjs";
const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
await runRendererElectronCheck({
  name: "user-bubble",
  renderer: "tests/e2e/user-bubble-renderer.mjs",
  main: "tests/e2e/user-bubble.harness.mjs",
  output: path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/user-bubble-electron")),
  requiredScenes: [
    "sentence-with-attachments-stays-on-one-line",
    "code-block-keeps-attachment-text-verbatim",
    "special-and-quoted-paths-show-file-names",
    "skill-and-attachment-chips-share-a-line",
    "bubble-chip-matches-composer-chip",
    "clicking-a-bubble-chip-reveals-the-file",
    "chip-with-real-thumbnail-keeps-layout",
    "message-from-another-session-names-it",
    "tool-card-links-to-the-session-it-created",
    "session-path-names-and-opens-ancestors",
    "dark-theme-bubble",
    "long-prompt-about-ten-lines-shows-in-full",
    "long-prompt-folds-on-the-first-frame-it-appears",
    "long-prompt-opens-to-the-whole-text",
    "window-width-decides-the-fold-by-rendered-lines",
    "chat-text-size-keeps-eight-lines-visible",
    "a-long-prompt-below-the-viewport-arrives-folded",
    "folding-while-reading-the-end-keeps-the-top-on-screen",
    "opening-a-long-prompt-during-a-reply-stops-following",
    "a-remounted-conversation-forgets-the-expanded-state",
    "images-and-previews-stay-outside-the-fold",
    "tabbing-to-a-clipped-attachment-opens-the-prompt",
    "keyboard-opens-and-folds-the-prompt",
    "channel-and-handoff-prompts-fold-the-same-way",
    "copying-and-editing-a-folded-prompt-keeps-the-whole-text",
    "reduced-motion-switches-the-fold-at-once",
    "resizing-a-long-prompt-reports-no-observer-errors",
    "the-fold-bar-speaks-the-app-language",
  ],
});
