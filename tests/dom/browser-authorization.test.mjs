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
  const allow = button(view.container, /^Allow this session/);
  assert.equal(dom.window.document.activeElement, deny);
  await keyDown(allow, "Tab");
  assert.equal(dom.window.document.activeElement, button(view.container, "Close and deny"));
  await keyDown(button(view.container, "Close and deny"), "Tab", { shiftKey: true });
  assert.equal(dom.window.document.activeElement, allow);
  await keyDown(deny, "Escape");
  assert.deepEqual(decisions, ["deny"]);
  await view.unmount();
  assert.equal(dom.window.document.activeElement, origin);
});

test("closing the request from its corner button denies it, the same as Escape", async (t) => {
  const decisions = [];
  const view = await mount(t, BrowserAuthorizationDialog, {
    request,
    sessionTitle: "Fixture session",
    onRespond: (value) => decisions.push(value),
    onManage() {},
  });
  await click(button(view.container, "Close and deny"));
  assert.deepEqual(decisions, ["deny"]);
});

test("Command or Control+Enter allows the session only after the request has been on screen briefly", async (t) => {
  const decisions = [];
  const view = await mount(t, BrowserAuthorizationDialog, {
    request,
    sessionTitle: "Fixture session",
    onRespond: (value) => decisions.push(value),
    onManage() {},
  });
  const deny = button(view.container, "Deny");
  await keyDown(deny, "Enter", { metaKey: true });
  assert.deepEqual(decisions, []);
  await new Promise((resolve) => setTimeout(resolve, 700));
  await keyDown(deny, "Enter", { metaKey: true, repeat: true });
  assert.deepEqual(decisions, []);
  await keyDown(deny, "Enter", { ctrlKey: true });
  assert.deepEqual(decisions, ["allow-session"]);
});

test("an Advanced Browser Mode request names the risk on its title and allow button", async (t) => {
  const view = await mount(t, BrowserAuthorizationDialog, {
    request: { ...request, minimumPermission: "advanced" },
    sessionTitle: "Fixture session",
    onRespond() {},
    onManage() {},
  });
  assert.match(view.container.textContent, /Allow the Agent to enter Advanced Browser Mode\?/);
  assert.ok(button(view.container, /^I understand the risk, allow/));
  assert.equal(button(view.container, /^Allow this session/), undefined);
  const current = view.container.querySelector('[aria-current="true"]');
  assert.match(current.textContent, /^Advanced Browser Mode/);
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
  await click(button(view.container, /^Allow this session/));
  assert.deepEqual(decisions, [["request-one", "allow-session"]]);
  assert.equal(view.container.querySelector('[role="dialog"]'), null);
  await view.unmount();
  assert.equal(receive, null);
});
