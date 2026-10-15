import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedDesktopIpcSender } from "./ipc-trust.ts";

test("desktop IPC trusts only the live main window main frame", () => {
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { isDestroyed: () => false, webContents };

  assert.equal(isTrustedDesktopIpcSender(window, { sender: webContents, senderFrame: mainFrame }), true);
  assert.equal(isTrustedDesktopIpcSender(window, { sender: {}, senderFrame: mainFrame }), false);
  assert.equal(isTrustedDesktopIpcSender(window, { sender: webContents, senderFrame: {} }), false);
  assert.equal(
    isTrustedDesktopIpcSender({ ...window, isDestroyed: () => true }, { sender: webContents, senderFrame: mainFrame }),
    false,
  );
  assert.equal(isTrustedDesktopIpcSender(null, { sender: webContents, senderFrame: mainFrame }), false);
});
