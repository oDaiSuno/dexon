import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPackageWithOptions } from "@electron/asar";
import { verifyPiRuntimeAssets } from "./pi-runtime-assets.mjs";

const piPackages = ["pi-ai", "pi-agent-core", "pi-coding-agent", "pi-codemode", "pi-mcp", "pi-telemetry", "pi-tui"];
const quickjsExtensions = ["crypto", "encoding", "headers", "structured-clone", "url"];

async function packagedRuntime(t, { platform = "darwin", arch = "arm64", omit = [], version = "1.4.0", unpack } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-pi-package-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  const resources = path.join(directory, "resources");
  const files = new Map();
  const lockfile = { packages: {} };
  for (const name of piPackages) {
    const root = `node_modules/@earendil-works/${name}`;
    files.set(`${root}/package.json`, JSON.stringify({ name: `@earendil-works/${name}`, version }));
    files.set(`${root}/dist/index.js`, "export {};\n");
    files.set(`${root}/dist/index.d.ts`, "export {};\n");
    lockfile.packages[root] = { version: "1.4.0" };
  }
  for (const [name, packageVersion] of [
    ["grok-mermaid", "0.2.3"],
    ["quickjs-wasi", "3.6.2"],
  ]) {
    const root = `node_modules/${name}`;
    files.set(`${root}/package.json`, JSON.stringify({ name, version: packageVersion }));
    files.set(`${root}/dist/index.js`, "export {};\n");
    lockfile.packages[root] = { version: packageVersion };
  }
  files.set("node_modules/typebox/package.json", JSON.stringify({ name: "typebox", version: "1.3.27" }));
  files.set("node_modules/typebox/build/index.mjs", "export {};\n");
  lockfile.packages["node_modules/typebox"] = { version: "1.3.27" };
  files.set("node_modules/quickjs-wasi/dist/index.d.ts", "export {};\n");
  files.set("node_modules/quickjs-wasi/quickjs.wasm", "wasm");
  for (const extension of quickjsExtensions) {
    files.set(`node_modules/quickjs-wasi/extensions/${extension}/${extension}.so`, "wasm extension");
  }
  files.set("node_modules/@earendil-works/pi-mcp/LICENSES/modelcontextprotocol-typescript-sdk.txt", "MIT");
  files.set("node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json", "{}");
  const nativeName = platform === "linux" ? "linux-platform-x11" : `${platform}-platform`;
  files.set(
    `node_modules/@earendil-works/pi-tui/native/${platform}/prebuilds/${platform}-${arch}/${nativeName}.node`,
    "native",
  );
  for (const [name, content] of files) {
    if (omit.includes(name)) continue;
    const file = path.join(source, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  fs.mkdirSync(resources);
  await createPackageWithOptions(source, path.join(resources, "app.asar"), { unpack });
  return { resources, platform, arch, lockfile };
}

test("a Pi 1.4 package validates without the removed client, protocol and clipboard packages", async (t) => {
  const { resources, platform, arch, lockfile } = await packagedRuntime(t);
  assert.doesNotThrow(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile));
});

test("a package missing the QuickJS runtime cannot pass verification", async (t) => {
  const { resources, platform, arch, lockfile } = await packagedRuntime(t, {
    omit: ["node_modules/quickjs-wasi/quickjs.wasm"],
  });
  assert.throws(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile), /quickjs\.wasm/);
});

test("a package missing a QuickJS extension cannot pass verification", async (t) => {
  const { resources, platform, arch, lockfile } = await packagedRuntime(t, {
    omit: ["node_modules/quickjs-wasi/extensions/url/url.so"],
  });
  assert.throws(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile), /url\.so/);
});

test("each desktop package requires the native runtime for its selected target", async (t) => {
  for (const [platform, arch, nativeName] of [
    ["darwin", "arm64", "darwin-platform"],
    ["darwin", "x64", "darwin-platform"],
    ["win32", "x64", "win32-platform"],
    ["linux", "x64", "linux-platform-x11"],
  ]) {
    const complete = await packagedRuntime(t, { platform, arch });
    assert.doesNotThrow(() => verifyPiRuntimeAssets(complete.resources, platform, arch, "1.4.0", complete.lockfile));
    const incomplete = await packagedRuntime(t, {
      platform,
      arch,
      omit: [`node_modules/@earendil-works/pi-tui/native/${platform}/prebuilds/${platform}-${arch}/${nativeName}.node`],
    });
    assert.throws(
      () => verifyPiRuntimeAssets(incomplete.resources, platform, arch, "1.4.0", incomplete.lockfile),
      /\.node/,
    );
  }
});

test("a packaged Pi dependency with the wrong version blocks verification", async (t) => {
  const { resources, platform, arch, lockfile } = await packagedRuntime(t, { version: "0.84.4" });
  assert.throws(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile), /does not match lockfile/);
});

test("a package missing the directly imported typebox runtime blocks verification", async (t) => {
  const { resources, platform, arch, lockfile } = await packagedRuntime(t, {
    omit: ["node_modules/typebox/build/index.mjs"],
  });
  assert.throws(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile), /typebox/);
});

test("an archive without the physical unpacked runtime files cannot pass verification", async (t) => {
  const { resources, platform, arch, lockfile } = await packagedRuntime(t, { unpack: "**/*.{wasm,node}" });
  assert.doesNotThrow(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile));
  fs.rmSync(path.join(resources, "app.asar.unpacked"), { recursive: true });
  assert.throws(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile), /unpacked.*quickjs\.wasm/);
});

test("a lockfile matching an obsolete Pi package does not override the required version", async (t) => {
  const { resources, platform, arch, lockfile } = await packagedRuntime(t, { version: "0.84.4" });
  for (const name of piPackages) lockfile.packages[`node_modules/@earendil-works/${name}`].version = "0.84.4";
  assert.throws(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile), /does not match 1\.4\.0/);
});

test("signing an unpacked native module may change its size without making the package incomplete", async (t) => {
  const { resources, platform, arch, lockfile } = await packagedRuntime(t, { unpack: "**/*.node" });
  const native = path.join(
    resources,
    "app.asar.unpacked/node_modules/@earendil-works/pi-tui/native/darwin/prebuilds/darwin-arm64/darwin-platform.node",
  );
  fs.appendFileSync(native, "native signature");
  assert.doesNotThrow(() => verifyPiRuntimeAssets(resources, platform, arch, "1.4.0", lockfile));
});
