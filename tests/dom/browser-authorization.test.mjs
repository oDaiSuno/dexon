import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, act, click, keyDown, button, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
const { BrowserAuthorizationDialog, useBrowserAuthorization, createElement } = await loadRenderer(
  "browser-authorization-behavior",
  [
    'export {BrowserAuthorizationDialog} from "./src/renderer/components/browser/BrowserAuthorizationDialog.tsx";',
    'export {useBrowserAuthorization} from "./src/renderer/components/app-shell/use-browser-authorization.ts"; export {createElement} from "react";',
  ].join("\n"),
);
after(restoreGlobals);
const request = {
  id: "request-one",
  sessionId: "session-one",
  source: "local",
  minimumPermission: "read",
  createdAt: 1,
  expiresAt: 30001,
};

test("authorization starts on Deny, traps keyboard focus and restores it when closed", async (t) => {
  const origin = dom.window.document.createElement("button");
  dom.window.document.body.appendChild(origin);
  origin.focus();
  t.after(() => origin.remove());
  const decisions = [];
  const view = await mount(t, BrowserAuthorizationDialog, {
    request,
    sessionTitle: "Fixture session",
    onRespond: (value) => decisions.push(value),
    onManage() {},
  });
  const deny = button(view.container, "Deny");
  const allow = button(view.container, "Allow current Agent session");
  assert.equal(dom.window.document.activeElement, deny);
  await keyDown(allow, "Tab");
  assert.equal(dom.window.document.activeElement, button(view.container, "Manage permanent permission…"));
  await keyDown(deny, "Escape");
  assert.deepEqual(decisions, ["deny"]);
  await view.unmount();
  assert.equal(dom.window.document.activeElement, origin);
});

test("the shell asks only after a request and sends only the user's temporary decision", async (t) => {
  let receive;
  const decisions = [];
  const visibility = [];
  dom.window.piBridge = {
    onBrowserEvent: (listener) => {
      receive = listener;
      return () => {
        receive = null;
      };
    },
    browserSetSurfaceVisible: async (value) => {
      visibility.push(value);
    },
    browserRespondAgentAuthorization: async (...args) => {
      decisions.push(args);
    },
  };
  function Authorization() {
    const state = useBrowserAuthorization();
    return state.browserAuthorization
      ? createElement(BrowserAuthorizationDialog, {
          request: state.browserAuthorization,
          sessionTitle: "Fixture",
          onRespond: state.respondToBrowserAuthorization,
          onManage() {},
        })
      : null;
  }
  const view = await mount(t, Authorization);
  assert.equal(view.container.querySelector('[role="dialog"]'), null);
  assert.deepEqual(decisions, []);
  await act(async () => receive({ type: "agent-authorization-request", request }));
  assert.deepEqual(visibility.at(-1), { visible: false });
  await click(button(view.container, "Allow current Agent session"));
  assert.deepEqual(decisions, [["request-one", "allow-session"]]);
  assert.equal(view.container.querySelector('[role="dialog"]'), null);
  await view.unmount();
  assert.equal(receive, null);
});
