import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (fixture contract).
import { dom, createManagedDomRoot, restoreGlobals } from "../resource-dom-environment.mjs";
import { createElement, useState } from "react";
import { act, create } from "react-test-renderer";

// Phase 4 contract tests for the resource main page shell: exactly the two
// approved tabs (plugins / skills) with tablist semantics, keyboard switching
// whose focus follows the accepted selection (review R4), and the active tab
// rendering the corresponding embedded config.

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { ResourcePage } = await importTestBundle("app-nav-resource-page", {
  stdin: {
    contents: 'export { ResourcePage } from "./src/renderer/components/app-nav/resource-page.tsx";',
    resolveDir: projectRoot,
    sourcefile: "app-nav-resource-page-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "app-nav-resource-page-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "resource-page" }));
        build.onResolve({ filter: /SkillsConfig(\.tsx)?$/ }, () => ({
          path: "stub-skills",
          namespace: "resource-page",
        }));
        build.onResolve({ filter: /PluginsConfig(\.tsx)?$/ }, () => ({
          path: "stub-plugins",
          namespace: "resource-page",
        }));
        build.onLoad({ filter: /.*/, namespace: "resource-page" }, ({ path: modulePath }) => {
          if (modulePath === "i18n") {
            return {
              contents:
                "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }',
              loader: "js",
            };
          }
          const marker = modulePath === "stub-skills" ? "skills-config-stub" : "plugins-config-stub";
          const exportName = modulePath === "stub-skills" ? "SkillsConfig" : "PluginsConfig";
          return {
            contents:
              `export function ${exportName}(_props) { return <div data-testid=${JSON.stringify(marker)} />; }\n` +
              "export default undefined;",
            loader: "tsx",
          };
        });
      },
    },
  ],
});

function pageProps(overrides = {}) {
  const calls = { tabChange: [] };
  return {
    props: {
      cwd: "/Users/tester/.dexon",
      activeTab: "plugins",
      onTabChange: (tab) => {
        calls.tabChange.push(tab);
      },
      ...overrides,
    },
    calls,
  };
}

function findAllByTestId(root, testId) {
  return root.root.findAll((node) => typeof node.type === "string" && node.props["data-testid"] === testId);
}

function tabsOf(root) {
  return root.root.findAll((node) => typeof node.type === "string" && node.props.role === "tab");
}

function installActEnvironment() {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  };
}

async function renderPage(props) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(ResourcePage, props));
  });
  return renderer;
}

test("the active tab renders its embedded config and only that one", async () => {
  const restore = installActEnvironment();
  let root;
  try {
    root = await renderPage(pageProps().props);
    assert.equal(findAllByTestId(root, "plugins-config-stub").length, 1, "plugins tab must host the plugins config");
    assert.equal(findAllByTestId(root, "skills-config-stub").length, 0, "skills config must stay hidden");
    await root.unmount();

    root = await renderPage(pageProps({ activeTab: "skills" }).props);
    assert.equal(findAllByTestId(root, "skills-config-stub").length, 1, "skills tab must host the skills config");
    assert.equal(findAllByTestId(root, "plugins-config-stub").length, 0, "plugins config must stay hidden");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("the page exposes a tablist with the two approved tabs and correct selection state", async () => {
  let root;
  const restore = installActEnvironment();
  try {
    root = await renderPage(pageProps().props);
    const tablist = root.root.findAll((node) => typeof node.type === "string" && node.props.role === "tablist");
    assert.equal(tablist.length, 1, "the page must expose exactly one tablist");

    const tabs = tabsOf(root);
    assert.equal(tabs.length, 2, "the resource page must have exactly the two approved tabs");
    assert.deepEqual(
      tabs.map((tab) => tab.props["aria-label"] ?? tab.children?.join("") ?? ""),
      ["Plugins", "Skills"],
      "tab order must be plugins first, skills second",
    );
    assert.equal(tabs[0].props["aria-selected"], true);
    assert.equal(tabs[1].props["aria-selected"], false);

    const panels = root.root.findAll((node) => typeof node.type === "string" && node.props.role === "tabpanel");
    assert.equal(panels.length, 1, "the active tab must expose exactly one tabpanel");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("clicking and arrow keys request tab changes through the controlled callback", async () => {
  let root;
  const restore = installActEnvironment();
  try {
    const calls = { tabChange: [] };
    const onTabChange = (tab) => {
      calls.tabChange.push(tab);
    };
    root = await renderPage({ cwd: "/Users/tester/.dexon", activeTab: "plugins", onTabChange });
    const [pluginsTab, skillsTab] = tabsOf(root);

    await act(async () => {
      skillsTab.props.onClick();
    });
    assert.deepEqual(calls.tabChange, ["skills"], "clicking the skills tab must request it");

    await act(async () => {
      pluginsTab.props.onKeyDown({ key: "ArrowRight", preventDefault() {} });
    });
    assert.deepEqual(calls.tabChange, ["skills", "skills"], "ArrowRight must move to the next tab");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("arrow-key switches move keyboard focus to the newly selected tab once accepted", async () => {
  // Real DOM: a controlled parent accepts the change, then the focus must
  // follow the selection (review R4) and activation acts on the shown tab.
  function ControlledPage({ initial }) {
    const [tab, setTab] = useState(initial);
    return createElement(ResourcePage, { cwd: "/Users/tester/.dexon", activeTab: tab, onTabChange: setTab });
  }

  const root = createManagedDomRoot();
  try {
    await root.render(createElement(ControlledPage, { initial: "plugins" }));
    const tabs = () => Array.from(root.container.querySelectorAll('[role="tab"]'));
    const [pluginsTab] = tabs();

    await act(async () => {
      pluginsTab.focus();
    });
    assert.equal(dom.window.document.activeElement, pluginsTab, "the active tab starts focused");

    await act(async () => {
      pluginsTab.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });

    const tabsAfter = tabs();
    assert.equal(tabsAfter[1].getAttribute("aria-selected"), "true", "the parent accepted the switch to skills");
    assert.equal(dom.window.document.activeElement, tabsAfter[1], "keyboard focus must follow the accepted selection");

    await act(async () => {
      tabsAfter[1].dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
    });
    const tabsBack = tabs();
    assert.equal(tabsBack[0].getAttribute("aria-selected"), "true", "ArrowLeft must select plugins again");
    assert.equal(
      dom.window.document.activeElement,
      tabsBack[0],
      "focus must stay on the selected tab after switching back",
    );
  } finally {
    await root.unmount();
  }
});
