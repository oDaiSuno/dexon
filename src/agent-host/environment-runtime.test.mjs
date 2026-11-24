import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
import { buildEnvironmentDescriptor } from "./environment-identity.ts";
const capabilities = {
  browser: false,
  nativeDialogs: false,
  revealInFileManager: false,
  managedProcesses: true,
  toolchainInstall: true,
};
test("remote descriptors identify the Node runtime, payload and stable daemon start time", () => {
  const first = buildEnvironmentDescriptor({ environmentId: "remote", label: "GPU", piVersion: "1.4.0", capabilities });
  const second = buildEnvironmentDescriptor({
    environmentId: "remote",
    label: "GPU",
    piVersion: "1.4.0",
    capabilities,
  });
  assert.equal(first.runtime?.nodeVersion, process.versions.node);
  assert.equal(typeof first.runtime.payloadVersion, "string");
  assert.ok(first.runtime.startedAt > 0);
  assert.equal(second.runtime.startedAt, first.runtime.startedAt);
});

test("remote platform advertises uploads and tunnels while the default host does not", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dexon-remote-capabilities-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const temporaryRoot = path.join(process.cwd(), ".artifacts");
  await mkdir(temporaryRoot, { recursive: true });
  const { initializeStandaloneHostPlatform, getActiveEnvironmentDescriptor, setActiveEnvironmentDescriptor } =
    await importTestBundle(
      "remote-platform-capabilities",
      {
        packages: "external",
        stdin: {
          contents:
            'export { initializeStandaloneHostPlatform } from "./src/agent-host/platform-services"; export { getActiveEnvironmentDescriptor, setActiveEnvironmentDescriptor } from "./src/agent-host/parent-rpc";',
          resolveDir: process.cwd(),
          loader: "ts",
        },
      },
      { temporaryRoot },
    );
  const previous = process.env.PI_DESKTOP_USER_DATA;
  let platform;
  try {
    platform = await initializeStandaloneHostPlatform({ stateDir: directory, piVersion: "1.4.0" });
    const descriptor = platform.getDescriptor();
    assert.equal(descriptor.capabilities.remoteAttachmentUpload, true);
    assert.equal(descriptor.capabilities.portForwarding, true);
    assert.deepEqual(getActiveEnvironmentDescriptor().capabilities, descriptor.capabilities);
    descriptor.capabilities.portForwarding = false;
    assert.equal(platform.getDescriptor().capabilities.portForwarding, true);
    setActiveEnvironmentDescriptor(null);
    const defaultDescriptor = getActiveEnvironmentDescriptor();
    assert.notEqual(defaultDescriptor.capabilities.remoteAttachmentUpload, true);
    assert.notEqual(defaultDescriptor.capabilities.portForwarding, true);
  } finally {
    await platform?.dispose();
    setActiveEnvironmentDescriptor(null);
    if (previous === undefined) delete process.env.PI_DESKTOP_USER_DATA;
    else process.env.PI_DESKTOP_USER_DATA = previous;
  }
});
