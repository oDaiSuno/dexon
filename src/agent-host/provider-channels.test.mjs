import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const agentDirectory = mkdtempSync(path.join(tmpdir(), "dexon-provider-channels-store-"));
process.env.PI_CODING_AGENT_DIR = agentDirectory;
delete process.env.PI_DESKTOP_USER_DATA;
const channelsFile = path.join(agentDirectory, "desktop", "provider-channels.json");
after(() => rmSync(agentDirectory, { recursive: true, force: true }));

const { readProviderChannels, disabledProviderIds, updateProviderChannel } = await importTestBundle(
  "provider-channels-store",
  { packages: "external", absWorkingDir: root, entryPoints: ["src/agent-host/provider-channels.ts"] },
);

const LEGACY = "azure-openai-responses";
const FAILED_TEST = { ok: false, reason: "timeout", error: "no answer", testedAt: "2026-01-02T03:04:05.000Z" };
const PASSED_TEST = { ok: true, latencyMs: 120, status: 200, testedAt: "2026-02-03T04:05:06.000Z" };

function store(channels) {
  mkdirSync(path.dirname(channelsFile), { recursive: true });
  const body = Object.entries(channels)
    .map(([provider, state]) => `${JSON.stringify(provider)}: ${JSON.stringify(state)}`)
    .join(",\n");
  writeFileSync(channelsFile, `{"version": 1, "channels": {${body}}}`);
}

test("a channel saved under the old Azure name is reported under the new name with its on/off state and last test", () => {
  store({ [LEGACY]: { enabled: false, lastTest: FAILED_TEST } });
  assert.deepEqual(readProviderChannels(), { azure: { enabled: false, lastTest: FAILED_TEST } });
});

test("a channel saved under the old Azure name stays turned off for model filtering under the new name", () => {
  store({ [LEGACY]: { enabled: false, lastTest: null } });
  assert.deepEqual([...disabledProviderIds()], ["azure"]);
});

test("when both Azure names are saved, the new name wins whichever comes first in the file", () => {
  const modern = { enabled: true, lastTest: PASSED_TEST };
  const legacy = { enabled: false, lastTest: FAILED_TEST };
  store({ azure: modern, [LEGACY]: legacy });
  assert.deepEqual(readProviderChannels(), { azure: modern });
  store({ [LEGACY]: legacy, azure: modern });
  assert.deepEqual(readProviderChannels(), { azure: modern });
  assert.deepEqual([...disabledProviderIds()], []);
});

test("when the new name is turned off and the old name is on, the channel stays off in either file order", () => {
  const modern = { enabled: false, lastTest: null };
  const legacy = { enabled: true, lastTest: PASSED_TEST };
  store({ azure: modern, [LEGACY]: legacy });
  assert.deepEqual([...disabledProviderIds()], ["azure"]);
  store({ [LEGACY]: legacy, azure: modern });
  assert.deepEqual([...disabledProviderIds()], ["azure"]);
});

test("saving any channel rewrites the file with only the new Azure name and keeps the migrated state", () => {
  store({ [LEGACY]: { enabled: false, lastTest: FAILED_TEST } });
  updateProviderChannel("acme", { enabled: false });
  const saved = JSON.parse(readFileSync(channelsFile, "utf8"));
  assert.deepEqual(saved.channels, {
    azure: { enabled: false, lastTest: FAILED_TEST },
    acme: { enabled: false, lastTest: null },
  });
});

test("other channel names are left exactly as saved", () => {
  store({ acme: { enabled: false, lastTest: null }, "azure-foundry": { enabled: true, lastTest: PASSED_TEST } });
  assert.deepEqual(readProviderChannels(), {
    acme: { enabled: false, lastTest: null },
    "azure-foundry": { enabled: true, lastTest: PASSED_TEST },
  });
});
