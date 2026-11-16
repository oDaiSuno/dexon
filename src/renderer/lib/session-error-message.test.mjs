import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { sessionClientErrorMessage, RpcError } = await importTestBundle("session-client-error-message", {
  stdin: {
    contents:
      'export { sessionClientErrorMessage } from "./session-error-message.ts"; export { RpcError } from "../../contract/types.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "session-client-error-message-entry.ts",
    loader: "ts",
  },
});
const t = (key, fallback) =>
  ({
    primaryHostReconnecting: "正在重新连接后台服务…",
    missingSessionFolderSend: "原项目文件夹已不存在，无法在原目录继续发送消息。",
  })[key] ?? fallback;

for (const code of ["CLOSED", "DISCONNECTED"]) {
  test(`${code} is presented as reconnecting rather than a raw transport failure`, () => {
    assert.equal(
      sessionClientErrorMessage(new RpcError({ code, message: "RPC port closed" }), t, "fallback"),
      "正在重新连接后台服务…",
    );
  });
}
test("an untyped closed port is localized without hiding an INTERNAL backend failure", () => {
  assert.equal(sessionClientErrorMessage(new Error("RPC port closed"), t, "fallback"), "正在重新连接后台服务…");
  assert.equal(
    sessionClientErrorMessage(new RpcError({ code: "INTERNAL", message: "RPC port closed" }), t, "fallback"),
    "RPC port closed",
  );
});
test("a missing historical session folder has a readable recovery reason", () => {
  assert.equal(
    sessionClientErrorMessage(new RpcError({ code: "MISSING_SESSION_CWD", message: "missing" }), t, "fallback"),
    "原项目文件夹已不存在，无法在原目录继续发送消息。",
  );
});
