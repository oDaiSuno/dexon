import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { realRendererGraphOptions } from "./renderer-real-graph.mjs";

// jsdom globals must be in place before the bundle imports.
const projectRoot = path.resolve(import.meta.dirname, "../../..");

const { UserMessageView } = await importTestBundle("src/renderer/components/user-message-skill-badge", {
  stdin: {
    contents: 'export { UserMessageView } from "./messages/UserMessage.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "user-message-skill-badge-test-entry.tsx",
    loader: "tsx",
  },
  jsx: "automatic",
  ...realRendererGraphOptions(projectRoot),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

let mounted = null;

async function renderMessage(content) {
  const element = createElement(UserMessageView, {
    message: { role: "user", content, timestamp: Date.now() },
    cwd: "/workspace/project",
  });
  await act(async () => {
    mounted = createRoot(rootEl);
    mounted.render(element);
  });
  await flush();
}

async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  await act(async () => {
    root.unmount();
  });
  rootEl.textContent = "";
}

after(async () => {
  await harness.restoreGlobals?.();
  restoreGlobals();
});

test("a message starting with /skill:name renders a blue badge plus the prose", async () => {
  await renderMessage("/skill:fast-context 帮我梳理架构");
  const badge = Array.from(rootEl.querySelectorAll("span")).find((el) => el.textContent === "fast-context");
  assert.ok(badge, "the badge names the skill");
  assert.ok(rootEl.textContent.includes("帮我梳理架构"), "the prose stays in the bubble");
  await unmount();
});

test("a bare /skill:name message renders only the badge", async () => {
  await renderMessage("/skill:groksearch");
  assert.ok(Array.from(rootEl.querySelectorAll("span")).some((el) => el.textContent === "groksearch"));
  await unmount();
});

test("pi's expanded <skill> block renders as the badge plus prose", async () => {
  await renderMessage(
    '<skill name="fast-context" location="/home/u/.pi/agent/skills/fast-context/SKILL.md">\nReferences are relative to /home/u/.pi/agent/skills/fast-context.\n\nBody.\n</skill>\n\n帮我梳理架构',
  );
  const badge = Array.from(rootEl.querySelectorAll("span")).find((el) => el.textContent === "fast-context");
  assert.ok(badge, "the expanded block shows as a badge");
  assert.ok(rootEl.textContent.includes("帮我梳理架构"), "trailing args stay in the bubble");
  assert.ok(!rootEl.textContent.includes("<skill"), "the raw XML block is hidden");
  await unmount();
});

test("mid-message /skill text is prose and gets no badge", async () => {
  await renderMessage("请先读 /skill:fast-context 说明");
  assert.ok(
    !Array.from(rootEl.querySelectorAll("span")).some((el) => el.textContent === "fast-context"),
    "no badge for a non-leading command",
  );
  assert.ok(rootEl.textContent.includes("请先读 /skill:fast-context 说明"));
  await unmount();
});
