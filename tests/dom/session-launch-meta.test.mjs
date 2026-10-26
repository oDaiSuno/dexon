import assert from "node:assert/strict";
import test, { after } from "node:test";
import { button, click, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const api = await loadRenderer(
  "session-launch-meta",
  'export {SessionToolRow} from "./src/renderer/components/messages/session-tool-row.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);

function newSessionCall(input) {
  return { type: "toolCall", id: "call-new", toolName: "session_new", input: { message: "整理配色", ...input } };
}

function newSessionResult(details) {
  return {
    role: "toolResult",
    toolCallId: "call-new",
    toolName: "session_new",
    content: [{ type: "text", text: JSON.stringify({ sessionId: "child-1", status: "running" }) }],
    isError: false,
    details,
  };
}

async function openBrief(t, block, result) {
  const view = await mount(t, api.SessionToolRow, { block, result, duration: 400 });
  await click(button(view.container, "新建会话"));
  return view.container.querySelector(".chat-session-brief");
}

test("when the new session ran on defaults, the task card names its model, thinking level and the current directory", async (t) => {
  const brief = await openBrief(
    t,
    newSessionCall({}),
    newSessionResult({
      targetSessionId: "child-1",
      launch: {
        model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
        thinkingLevel: "low",
        cwd: "/work/app",
      },
    }),
  );
  assert.ok(brief, "the task card opens");
  assert.match(brief.textContent, /交给它的任务/);
  assert.match(brief.textContent, /claude-sonnet-4-5 · 思考 低 · 当前目录/);
});

test("when the tool call chose another directory, the task card names that directory instead", async (t) => {
  const brief = await openBrief(
    t,
    newSessionCall({ cwd: "/work/app-worktrees/fix-colors" }),
    newSessionResult({
      targetSessionId: "child-1",
      launch: {
        model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
        thinkingLevel: "high",
        cwd: "/work/app-worktrees/fix-colors",
      },
    }),
  );
  assert.match(brief.textContent, /claude-sonnet-4-5 · 思考 高 · fix-colors/);
});

test("an older record without the launch report shows the task but no model line", async (t) => {
  const brief = await openBrief(t, newSessionCall({}), newSessionResult({ targetSessionId: "child-1" }));
  assert.match(brief.textContent, /整理配色/);
  assert.doesNotMatch(brief.textContent, /思考|当前目录/);
});
