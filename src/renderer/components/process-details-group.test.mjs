import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { ProcessDetailsGroup, ThinkingExpansionStore } = await importTestBundle(
  "src/renderer/components/process-details-group",
  {
    stdin: {
      contents:
        'export { ProcessDetailsGroup } from "./ProcessDetailsGroup.tsx"; export { ThinkingExpansionStore } from "../lib/thinking-expansion-store.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "process-details-group-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
    plugins: [
      {
        name: "stub-i18n",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@\/i18n$/ }, () => ({
            path: "i18n",
            namespace: "process-details-group-test",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "process-details-group-test" }, () => ({
            contents:
              'export function useI18n() { return { language: "en", t(_key, fallback) { return fallback; } }; }',
            loader: "js",
          }));
        },
      },
    ],
  },
);

after(() => {
  if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

function renderGroup(expansionStore, stateKey, extraProps = {}) {
  return create(
    createElement(
      ProcessDetailsGroup,
      { expansionStore, stateKey, messageCount: 2, toolCallCount: 1, ...extraProps },
      createElement("span", null, "persisted process content"),
    ),
  );
}

test("process details header prefers the whole-turn duration when available", async () => {
  const sessionStore = new ThinkingExpansionStore();
  let renderer;
  await act(async () => {
    renderer = renderGroup(sessionStore, "process-group:user-1:assistant-1", { durationSeconds: 131 });
  });
  const header = renderer.root
    .findAllByProps({ className: undefined })
    .find((node) => typeof node.props.children === "string" && node.props.children.includes("2m11s"));
  assert.ok(header, "header with duration not found");
  assert.match(header.props.children, /Processed 2m11s/);
  await act(async () => renderer.unmount());
});

test("process details header falls back to counts without a duration", async () => {
  const sessionStore = new ThinkingExpansionStore();
  let renderer;
  await act(async () => {
    renderer = renderGroup(sessionStore, "process-group:user-1:assistant-1");
  });
  const header = renderer.root
    .findAllByProps({ className: undefined })
    .find((node) => typeof node.props.children === "string" && node.props.children.includes("Process details"));
  assert.ok(header, "fallback header not found");
  assert.match(header.props.children, /2 messages · 1 tool call\b/);
  await act(async () => renderer.unmount());
});

test("process details expansion survives a component remount and remains isolated by session store", async () => {
  const sessionStore = new ThinkingExpansionStore();
  let renderer;
  await act(async () => {
    renderer = renderGroup(sessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], false);
  assert.equal(renderer.root.findAllByProps({ children: "persisted process content" }).length, 0);

  await act(async () => {
    renderer.root.findByType("button").props.onClick();
  });
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], true);
  assert.equal(renderer.root.findAllByProps({ children: "persisted process content" }).length, 1);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = renderGroup(sessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], true);
  assert.equal(renderer.root.findAllByProps({ children: "persisted process content" }).length, 1);
  await act(async () => renderer.unmount());

  const otherSessionStore = new ThinkingExpansionStore();
  await act(async () => {
    renderer = renderGroup(otherSessionStore, "process-group:user-1:assistant-1");
  });
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], false);
  await act(async () => renderer.unmount());
});
