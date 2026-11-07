import assert from "node:assert/strict";
import test from "node:test";
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
