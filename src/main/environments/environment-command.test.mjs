import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvironmentCommand } from "./environment-command.ts";
const draft = { label: "GPU", target: { kind: "ssh", sshAlias: "gpu" } };
test("the single command boundary accepts every supported operation and preserves explicit removal choices", () => {
  const commands = [
    { type: "add", draft, connect: false },
    { type: "update", environmentId: "server", draft },
    { type: "test", subject: { draft } },
    { type: "test", subject: { environmentId: "server" } },
    { type: "connect", environmentId: "server" },
    { type: "disconnect", environmentId: "server" },
    { type: "trust", environmentId: "server", trust: "host-key" },
    { type: "restart-daemon", environmentId: "server" },
    { type: "remove", environmentId: "server", remoteDaemon: "stop" },
    { type: "remove", environmentId: "server", remoteDaemon: "keep" },
    { type: "set-policy", policy: { autoReconnect: false } },
    { type: "discover-ssh-hosts" },
  ];
  for (const command of commands) {
    const parsed = parseEnvironmentCommand(command);
    assert.equal(parsed.type, command.type);
    if (command.type === "remove") assert.equal(parsed.remoteDaemon, command.remoteDaemon);
  }
});
test("untrusted commands cannot inject shell options, pre-bind identities or bypass lifecycle choices", () => {
  for (const command of [
    null,
    { type: "unknown" },
    { type: "add", draft },
    { type: "add", connect: true, draft: { ...draft, target: { ...draft.target, sshAlias: "-oProxyCommand=evil" } } },
    {
      type: "add",
      connect: true,
      draft: { ...draft, target: { ...draft.target, expectedEnvironmentId: "untrusted" } },
    },
    { type: "test", subject: { draft, environmentId: "server" } },
    { type: "remove", environmentId: "server" },
    { type: "connect", environmentId: "bad\nserver" },
    { type: "set-policy", policy: { autoReconnect: "yes" } },
    { type: "set-policy", policy: { unknown: true } },
  ])
    assert.throws(() => parseEnvironmentCommand(command));
});
