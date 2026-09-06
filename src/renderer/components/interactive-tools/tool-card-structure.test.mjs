import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const root = path.resolve(import.meta.dirname, "../../../..");

test("interactive tool modules and refactored integration owners stay under 500 lines", () => {
  const directories = [
    "src/agent-host/agent-session",
    "src/renderer/hooks/agent-session",
    "src/renderer/components/chat-window",
    "src/renderer/components/interactive-tools",
    "scripts/desktop-security",
  ];
  const files = [
    "src/agent-host/rpc-manager.ts",
    "src/renderer/hooks/useAgentSession.ts",
    "src/renderer/components/ChatWindow.tsx",
    "src/renderer/lib/interactive-tool-store.ts",
    "src/shared/interactive-tools.ts",
    "src/shared/questionnaire.ts",
    "src/renderer/styles/tool-cards.css",
    "scripts/check-desktop-security.mjs",
    "scripts/test-interactive-tools-electron.mjs",
    "src/smoke/interactive-tools-harness.ts",
    "src/smoke/interactive-tools-renderer.mjs",
  ];
  for (const directory of directories)
    for (const name of readdirSync(path.join(root, directory))) files.push(`${directory}/${name}`);
  for (const file of files) assert.ok(readFileSync(path.join(root, file), "utf8").split("\n").length <= 500, file);
});

test("cards are composed above the input without replacing safety authorization", () => {
  const source = readFileSync(path.join(root, "src/renderer/components/ChatWindow.tsx"), "utf8");
  assert.ok(source.indexOf("<ToolCardDock") < source.indexOf("{chatInputElement}"));
  assert.ok(source.indexOf("<ToolCardDock") > source.indexOf("chat-input-transition-dock"));
  assert.doesNotMatch(source, /ExtensionDialog|ExtensionCustomPanel/);
  const card = readFileSync(path.join(root, "src/renderer/components/interactive-tools/tool-card-dock.tsx"), "utf8");
  assert.doesNotMatch(card, /aria-modal|BrowserAuthorization|browserRequestAuthorization|position: "absolute"/);
});
