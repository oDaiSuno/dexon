import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const root = path.resolve(import.meta.dirname, "../../../../..");
const { createServerDraft, toEnvironmentDraft } = await importTestBundle("server-draft", {
  entryPoints: [path.join(import.meta.dirname, "server-draft.ts")],
  tsconfig: path.join(root, "tsconfig.renderer.json"),
});

const view = (target) => ({
  id: "remote-a",
  label: "Research",
  enabled: true,
  target,
  status: { phase: "offline", lastFailure: null },
  descriptor: null,
});

test("editing a WebSocket server preserves its saved identity and leaves a blank token unchanged", () => {
  const draft = createServerDraft(
    view({ kind: "websocket", url: "wss://worker.example", expectedEnvironmentId: "saved-id" }),
  );
  assert.deepEqual(draft, { kind: "websocket", label: "Research", url: "wss://worker.example", authToken: "" });
  assert.deepEqual(toEnvironmentDraft(draft), {
    label: "Research",
    target: { kind: "websocket", url: "wss://worker.example" },
  });
});

test("SSH edits round-trip advanced fields without sending the trusted environment identity", () => {
  const draft = createServerDraft(
    view({
      kind: "ssh",
      sshAlias: "gpu-a",
      hostname: "10.0.0.8",
      user: "ubuntu",
      port: 2222,
      identityFile: "~/.ssh/work",
      proxyJump: "bastion",
      remotePort: 39100,
      remoteStateDir: "/data/dexon",
      expectedEnvironmentId: "saved-id",
    }),
  );
  assert.equal(draft.remoteStateDir, "/data/dexon");
  assert.deepEqual(toEnvironmentDraft(draft), {
    label: "Research",
    target: {
      kind: "ssh",
      sshAlias: "gpu-a",
      hostname: "10.0.0.8",
      user: "ubuntu",
      port: 2222,
      identityFile: "~/.ssh/work",
      proxyJump: "bastion",
      remotePort: 39100,
      remoteStateDir: "/data/dexon",
    },
  });
});
