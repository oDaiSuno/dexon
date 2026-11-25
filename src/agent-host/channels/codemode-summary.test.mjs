import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import test from "node:test";

const { summarizeCodemodeTool } = await importTestBundle("src/agent-host/channels/codemode-summary", {
  packages: "external",
  entryPoints: ["src/agent-host/channels/codemode-summary.ts"],
});

function call(name, status, extra = {}) {
  return { id: `${name}-${status}`, name, args: "{}", status, ...extra };
}

function state(calls, extra = {}) {
  return { running: false, isError: false, output: { details: { calls } }, ...extra };
}

test("a script starting with no calls shows sandbox preparation without any code", () => {
  assert.equal(summarizeCodemodeTool(state([], { running: true })), "正在运行脚本 · 准备沙箱环境…");
});

test("a running script shows finished steps and the current tool as a Chinese action", () => {
  assert.equal(
    summarizeCodemodeTool(state([call("read", "ok"), call("grep", "ok"), call("bash", "running")], { running: true })),
    "正在运行脚本 · 已完成 2 步（当前：执行命令）",
  );
});

test("a finished script shows call count and the wall time reported by the script", () => {
  assert.equal(
    summarizeCodemodeTool(
      state([], {
        output: {
          content: [
            { type: "text", text: "Script completed\nWall time 1.2 seconds\nOutput:\n" },
            { type: "text", text: "secret output" },
          ],
          details: { calls: [call("read", "ok"), call("grep", "ok"), call("bash", "ok")] },
        },
      }),
    ),
    "运行脚本完成 · 调用了 3 个工具 · 耗时 1.2s",
  );
});

test("measured timing wins over the wall time in the script header", () => {
  assert.equal(
    summarizeCodemodeTool(state([call("read", "ok")], { timing: { startedAt: 0, endedAt: 65_000 } })),
    "运行脚本完成 · 调用了 1 个工具 · 耗时 65.0s",
  );
});

test("a timed-out script names the unfinished step without including its arguments or output", () => {
  assert.equal(
    summarizeCodemodeTool(
      state([call("read", "ok"), call("bash", "running")], {
        isError: true,
        timing: { startedAt: 0, endedAt: 30_000 },
      }),
    ),
    "脚本执行超时（30.0s）· 已完成 1 步，第 2 步执行命令未返回",
  );
});

test("script-level timeout and syntax errors are concise even without nested calls", () => {
  for (const [text, expected] of [
    ["Script error:\nScript timed out after 30 seconds", "脚本执行超时 · 已完成 0 步"],
    ["Script error:\nSyntaxError: privateScript()", "脚本执行失败 · 已完成 0 步，脚本语法错误"],
  ]) {
    assert.equal(
      summarizeCodemodeTool(state([], { isError: true, output: { content: [{ type: "text", text }] } })),
      expected,
    );
  }
});

test("failed nested calls expose only a short reason, never script snippets or credentials", () => {
  assert.equal(
    summarizeCodemodeTool(
      state([call("bash", "error", { error: "permission denied\nconst secret = 'token'" })], { isError: true }),
    ),
    "脚本执行失败 · 已完成 0 步，权限不足",
  );
});
