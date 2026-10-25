import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, byRole, button, click, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { precedes } from "../support/dom-queries.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "toolchains-page",
  'export {ToolchainsConfig} from "./src/renderer/components/ToolchainsConfig.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);

const MB = 1024 * 1024;

const ready = (capability, version, provider = "system", extra = {}) => ({
  capability,
  preference: "auto",
  provider,
  version,
  pathLabel: `/usr/local/bin/${capability.split(".")[1]}`,
  health: "healthy",
  candidates: [],
  ...extra,
});

function toolchainState({ follows = true } = {}) {
  return {
    schemaVersion: 1,
    revision: 3,
    platform: "darwin",
    arch: "arm64",
    coreReady: true,
    managedRootLabel: "$APP_DATA/toolchains",
    lastScanAt: "2026-10-22T12:00:00.000Z",
    capabilities: {
      "shell.bash": ready("shell.bash", "5.2.37"),
      "shell.powershell": { capability: "shell.powershell", preference: "auto", health: "missing", candidates: [] },
      "vcs.git": ready("vcs.git", "2.47.1"),
      "js.node": ready("js.node", "22.12.0", "managed", {
        pathLabel: "$APP_DATA/toolchains/runtimes/node-lts/22.12.0/bin/node",
        candidates: [
          {
            id: "managed-node",
            capability: "js.node",
            provider: "managed",
            version: "22.12.0",
            pathLabel: "$APP_DATA/toolchains/runtimes/node-lts/22.12.0/bin/node",
            health: "healthy",
          },
          {
            id: "system-node",
            capability: "js.node",
            provider: "system",
            version: "24.14.0",
            pathLabel: "/opt/homebrew/bin/node",
            health: "healthy",
          },
        ],
      }),
      "js.npm": ready("js.npm", "10.9.0", "managed", follows ? { follows: "js.node" } : {}),
      "js.npx": ready("js.npx", "10.9.0", "managed", follows ? { follows: "js.node" } : {}),
      "js.bun": ready("js.bun", "1.2.4"),
      "python.interpreter": ready("python.interpreter", "3.13.1"),
      "python.uv": ready("python.uv", "0.6.3"),
      "python.uvx": ready("python.uvx", "0.6.3", "system", follows ? { follows: "python.uv" } : {}),
      "search.rg": ready("search.rg", "14.1.1", "managed", { health: "modified" }),
      "search.fd": ready("search.fd", "10.2.0"),
      "data.jq": ready("data.jq", "1.7.1"),
      "network.curl": ready("network.curl", "8.7.1"),
    },
    components: {
      "node-lts": {
        componentId: "node-lts",
        installed: true,
        activeVersion: "22.12.0",
        availableVersion: "22.12.0",
        platformArch: "darwin-arm64",
        downloadBytes: 48 * MB,
        diskBytes: 190 * MB,
        sourceName: "nodejs.org",
        licenseName: "Node.js license",
        licenseUrl: "https://github.com/nodejs/node/blob/v22.12.0/LICENSE",
        health: "healthy",
        canInstall: false,
        canRepair: false,
        canRemove: true,
      },
      ripgrep: {
        componentId: "ripgrep",
        installed: true,
        activeVersion: "14.1.1",
        downloadBytes: 5 * MB,
        sourceName: "GitHub",
        health: "modified",
        canInstall: false,
        canRepair: true,
        canRemove: true,
      },
    },
    caches: {
      npm: { cacheId: "npm", diskBytes: 912 * MB, canClear: true },
      downloads: { cacheId: "downloads", diskBytes: 96 * MB, canClear: true },
    },
    operations: [],
  };
}

async function openPage(t, { state = toolchainState(), bridge = {} } = {}) {
  const requests = [];
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method) {
        throw new Error(`unexpected ${method}`);
      },
    }),
    {
      bridge: {
        platform: "darwin",
        onToolchainState: () => () => undefined,
        getToolchainState: async () => structuredClone(state),
        rescanToolchains: async () => structuredClone(state),
        performToolchainAction: async (request) => {
          requests.push(request);
          return structuredClone(state);
        },
        openExternal: async () => undefined,
        ...bridge,
      },
    },
  );
  const view = await mount(t, api.ToolchainsConfig, { cwd: null }, { release: host.close });
  await waitFor(() => assert.ok(byRole(view.container, "list", "开发工具列表"), "the tool list has loaded"));
  return { view, requests };
}

const toolRow = (view, capability) => view.container.querySelector(`button[data-tool-id="${capability}"]`);

test("当用户在“托管工具位置”一行点“打开文件夹”时，应用请主进程打开托管工具文件夹", async (t) => {
  let opened = 0;
  const { view } = await openPage(t, {
    bridge: {
      openManagedToolsFolder: async () => {
        opened += 1;
      },
    },
  });
  const open = button(view.container, "打开文件夹");
  assert.ok(open, "the managed tools location row offers an Open folder button");
  assert.equal(open.getAttribute("title"), "$APP_DATA/toolchains");
  await click(open);
  assert.equal(opened, 1);
  assert.equal(Boolean(byRole(view.container, "alert")), false, "a successful open shows no error");
});

test("当托管工具文件夹打不开时，页面顶部提示打开失败", async (t) => {
  const { view } = await openPage(t, {
    bridge: {
      openManagedToolsFolder: async () => {
        throw new Error("Directory does not exist");
      },
    },
  });
  await click(button(view.container, "打开文件夹"));
  await waitFor(() => assert.equal(byRole(view.container, "alert")?.textContent, "无法打开托管工具文件夹。"));
});

test("当主进程说明 npm、npx 跟随 Node.js、uvx 跟随 uv 时，已就绪列表的来源一栏照此显示", async (t) => {
  const { view } = await openPage(t);
  assert.equal(toolRow(view, "js.npm").getAttribute("aria-label"), "npm · 跟随 Node.js");
  assert.equal(toolRow(view, "js.npx").getAttribute("aria-label"), "npx · 跟随 Node.js");
  assert.equal(toolRow(view, "python.uvx").getAttribute("aria-label"), "uvx · 跟随 uv");
  assert.equal(toolRow(view, "python.uv").getAttribute("aria-label"), "uv · 系统");
});

test("当主进程没有给出跟随关系时，npm 和 uvx 显示各自的来源", async (t) => {
  const { view } = await openPage(t, { state: toolchainState({ follows: false }) });
  assert.equal(toolRow(view, "js.npm").getAttribute("aria-label"), "npm · Dexon 托管");
  assert.equal(toolRow(view, "python.uvx").getAttribute("aria-label"), "uvx · 系统");
});

test("展开 Node.js 后，来源列表最后一项是“自定义路径…”，点它会打开选择可执行文件", async (t) => {
  const { view, requests } = await openPage(t);
  const detail = byRole(view.container, "region", "Node.js · 工具解析");
  assert.ok(detail, "Node.js is expanded by default");
  const sources = [...detail.querySelectorAll('[role="radio"]')];
  assert.equal(sources.length, 2);
  const custom = button(detail, "自定义路径…");
  assert.ok(custom, "the source list ends with a Custom path… entry");
  assert.ok(precedes(sources[1], custom), "Custom path… comes after every detected source");
  assert.equal(Boolean(button(detail, "选择路径")), false, "the separate Choose path button is gone");
  await click(custom);
  await waitFor(() => assert.deepEqual(requests, [{ action: "choose-custom-tool", capability: "js.node" }]));
});

test("展开 Node.js 后，卸载和许可证是来源列表下方的一排按钮，托管运行时明细不再出现", async (t) => {
  let licenseOpened = null;
  const { view, requests } = await openPage(t, {
    bridge: {
      openExternal: async (url) => {
        licenseOpened = url;
      },
    },
  });
  const detail = byRole(view.container, "region", "Node.js · 工具解析");
  const custom = button(detail, "自定义路径…");
  assert.ok(custom, "the source list ends with a Custom path… entry");
  const remove = button(detail, "卸载");
  const license = button(detail, "许可证");
  assert.ok(remove && license, "the expanded row offers Remove and License");
  assert.ok(precedes(custom, license) && precedes(custom, remove), "the action buttons sit below the source list");
  assert.doesNotMatch(detail.outerHTML, /托管运行时|托管组件|可用版本|磁盘占用|下载大小/);
  await click(license);
  assert.equal(licenseOpened, "https://github.com/nodejs/node/blob/v22.12.0/LICENSE");
  await click(remove);
  await waitFor(() => assert.deepEqual(requests, [{ action: "remove-component", componentId: "node-lts" }]));
});

test("ripgrep 被改动过时，问题卡只给“重新安装”，不再多出“卸载”", async (t) => {
  const { view, requests } = await openPage(t);
  const card = view.container.querySelector('article[data-tool-id="search.rg"]');
  assert.ok(card, "the modified ripgrep is listed under Needs attention");
  assert.equal(Boolean(button(card, "卸载")), false, "the issue card has no Remove button");
  const reinstall = byRole(card, "button", /重新安装/);
  assert.ok(reinstall);
  await click(reinstall);
  await waitFor(() => assert.deepEqual(requests, [{ action: "repair-component", componentId: "ripgrep" }]));
});

test("收起 Node.js 再展开 Bun 时，Bun 的来源列表同样以“自定义路径…”结尾", async (t) => {
  const { view } = await openPage(t);
  await click(toolRow(view, "js.node"));
  assert.equal(Boolean(byRole(view.container, "region", "Node.js · 工具解析")), false, "Node.js collapses");
  await click(toolRow(view, "js.bun"));
  const bun = byRole(view.container, "region", "Bun · 工具解析");
  assert.ok(bun, "Bun expands");
  assert.ok(button(bun, "自定义路径…"), "every expanded tool can pick a custom path");
});
