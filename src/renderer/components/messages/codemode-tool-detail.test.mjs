import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { codemodeToolDetail } = await importTestBundle("codemode-tool-detail", {
  entryPoints: ["src/renderer/components/messages/codemode-tool-detail.ts"],
  tsconfig: "tsconfig.renderer.json",
});
const block = { type: "toolCall", toolCallId: "script", toolName: "codemode", input: { code: "text(42);" } };
const t = (_key, fallback) => fallback;
const result = (text, details = { calls: [] }, isError = false) => ({
  role: "toolResult",
  toolCallId: "script",
  isError,
  details,
  content: [{ type: "text", text }],
});

test("a one-line completion header is removed without losing real output", () => {
  const view = codemodeToolDetail({ block, result: result("Script completed in 0.2 seconds.\n42\nhello"), t });
  assert.equal(view.output, "42\nhello");
  assert.equal(view.lifecycle, "done");
});

test("running summaries count completed steps without inventing a total", () => {
  const view = codemodeToolDetail({
    block,
    t,
    liveUpdate: {
      toolCallId: "script",
      startedAt: 100,
      partialResult: {
        details: {
          calls: [
            { id: "one", name: "read", args: '{"path":"first.txt"}', status: "ok", durationMs: 100 },
            { id: "two", name: "read", args: '{"path":"second.txt"}', status: "running" },
          ],
        },
      },
    },
  });
  assert.equal(view.summary, "Running: Read second.txt · 1 steps completed");
  assert.deepEqual(view.counts, { ok: 1, error: 0, cancelled: 0, running: 1 });
  assert.equal(view.steps[0].widthRatio, 1);
});

test("failed scripts preserve stdout and anchor their one error to the failed tool", () => {
  const view = codemodeToolDetail({
    block,
    t,
    result: result(
      "Script failed.\nWall time 30 seconds\nOutput:\nprinted before failure\nScript error:\nTimeout after 30000ms while awaiting tools.bash",
      {
        calls: [
          {
            id: "one",
            name: "bash",
            args: '{"command":"npm run build"}',
            status: "error",
            durationMs: 30000,
            error: "Timeout after 30000ms while awaiting tools.bash",
          },
        ],
      },
      true,
    ),
  });
  assert.equal(view.output, "printed before failure");
  assert.equal(view.errorStepId, "one");
  assert.equal(view.errorDetail, "Timeout after 30000ms while awaiting tools.bash");
  assert.equal(view.summary, "Timed out after 30s · Step 1 · Terminal did not return");
  assert.equal(view.lifecycle, "error");
});

test("completed summaries keep step and image counts while cost stays separate", () => {
  const saved = result("Script completed.\nreal output", {
    calls: [
      { id: "one", name: "models.generateImages", args: "{}", status: "ok", durationMs: 1000, cost: 0.01 },
      { id: "two", name: "models.classify", args: "{}", status: "ok", durationMs: 500, cost: 0.02 },
    ],
  });
  saved.content.push({ type: "image", data: "AA==", mimeType: "image/png" });
  const view = codemodeToolDetail({ block, t, result: saved });
  assert.equal(view.summary, "2 steps · 1 images");
  assert.equal(view.images[0].src, "data:image/png;base64,AA==");
  assert.equal(view.totalCost, 0.03);
  assert.equal(view.steps[1].widthRatio, 0.5);
});

test("tool targets resolve outside the working folder and malformed arguments stay safe", () => {
  const view = codemodeToolDetail({
    block,
    t,
    cwd: "C:\\project\\src",
    result: result("", {
      calls: [
        { id: "one", name: "read", args: '{"path":"../package.json"}', status: "ok" },
        { id: "two", name: "browser_navigate", args: '{"tabId":"tab-4","url":"https://example.com"}', status: "ok" },
        { id: "three", name: "edit", args: "not JSON", status: "ok" },
      ],
    }),
  });
  assert.equal(view.steps[0].filePath, "C:/project/package.json");
  assert.equal(view.steps[1].tabId, "tab-4");
  assert.equal(view.steps[2].filePath, undefined);
});

test("final cancellation settles unfinished steps without showing a running step", () => {
  const view = codemodeToolDetail({
    block,
    t,
    result: result(
      "Script failed\nScript error:\nAbortError: Script cancelled",
      {
        calls: [
          { id: "one", name: "read", args: "{}", status: "ok" },
          { id: "two", name: "bash", args: "{}", status: "running" },
        ],
      },
      true,
    ),
  });
  assert.equal(view.lifecycle, "cancelled");
  assert.deepEqual(view.counts, { ok: 1, error: 0, cancelled: 1, running: 0 });
  assert.equal(view.summary, "1 completed · 1 cancelled");
});

test("image-first results still remove the wrapper from the first text block", () => {
  const saved = result("Script completed\nWall time 1 seconds\nOutput:\nkept");
  saved.content.unshift({ type: "image", data: "AA==", mimeType: "image/png" });
  const view = codemodeToolDetail({ block, result: saved, t });
  assert.equal(view.output, "kept");
  assert.equal(view.images.length, 1);
});
