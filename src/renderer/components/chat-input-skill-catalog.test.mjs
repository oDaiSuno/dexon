import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach, beforeEach } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { click, waitFor } from "../../../tests/support/dom-events.mjs";

const { useSkillCatalog, installApiShims, resetRpc } = await importTestBundle("chat-input-skill-catalog", {
  stdin: {
    contents:
      'export {useSkillCatalog} from "./chat-input/use-skill-catalog.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "skill-catalog-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
});

const skill = (name, disableModelInvocation = false) => ({
  name,
  description: `${name} description`,
  filePath: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  disableModelInvocation,
});
let reply;
const requests = [];
harness.connectApi(
  { installApiShims, resetRpc },
  {
    skills: (params) => {
      requests.push(params.cwd);
      return reply(params.cwd);
    },
  },
);

function Probe(props) {
  const catalog = useSkillCatalog(props);
  return createElement(
    "div",
    null,
    createElement("output", null, `${catalog.status}:${catalog.skills.map((entry) => entry.name).join(",")}`),
    createElement("button", { onClick: catalog.refresh }, "Refresh"),
  );
}

let mounted;
async function render(cwd, visible = true) {
  await act(async () => {
    mounted ??= createRoot(rootEl);
    mounted.render(createElement(Probe, { cwd, visible }));
  });
}
const snapshot = () => rootEl.querySelector("output").textContent;
const refresh = () => click(rootEl.querySelector("button"));

beforeEach(() => {
  requests.length = 0;
  reply = () => ({ skills: [] });
});
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = null;
  rootEl.textContent = "";
});
after(restoreGlobals);

test("only visible composers with a working folder load skills, including manually invoked skills", async () => {
  reply = () => ({ skills: [skill("poteto-mode", true), skill("Invalid"), skill("poteto-help")] });
  await render(null);
  await refresh();
  await render("/a", false);
  await refresh();
  assert.deepEqual(requests, []);
  await render("/a");
  assert.deepEqual(requests, ["/a"]);
  assert.equal(snapshot(), "ready:poteto-mode,poteto-help");
});

test("refreshes share an in-flight request and keep ready skills visible even when the refresh fails", async () => {
  let finish;
  reply = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await render("/a");
  await refresh();
  await refresh();
  assert.deepEqual(requests, ["/a"]);
  await act(async () => finish({ skills: [skill("poteto-mode")] }));
  assert.equal(snapshot(), "ready:poteto-mode");
  let fail;
  reply = () =>
    new Promise((resolve, reject) => {
      fail = reject;
    });
  await refresh();
  await refresh();
  assert.deepEqual(requests, ["/a", "/a"]);
  assert.equal(snapshot(), "ready:poteto-mode");
  await act(async () => fail(new Error("refresh unavailable")));
  assert.equal(snapshot(), "ready:poteto-mode");
});

test("a late response from another folder cannot replace the currently visible catalog", async () => {
  const pending = new Map();
  reply = (cwd) => new Promise((resolve) => pending.set(cwd, resolve));
  await render("/a");
  await render("/b");
  await act(async () => pending.get("/b")({ skills: [skill("beta")] }));
  assert.equal(snapshot(), "ready:beta");
  await act(async () => pending.get("/a")({ skills: [skill("alpha")] }));
  assert.equal(snapshot(), "ready:beta");
  await render("/a");
  assert.equal(snapshot(), "ready:alpha");
  await act(async () => pending.get("/a")({ skills: [skill("alpha-new")] }));
  await waitFor(() => assert.equal(snapshot(), "ready:alpha-new"));
});

test("a new composer instance reads its own catalog instead of inheriting another instance's data", async () => {
  reply = () => ({ skills: [skill("first")] });
  await render("/a");
  assert.equal(snapshot(), "ready:first");
  await act(async () => mounted.unmount());
  mounted = null;
  reply = () => ({ skills: [skill("second")] });
  await render("/a");
  assert.equal(snapshot(), "ready:second");
  assert.deepEqual(requests, ["/a", "/a"]);
});
