import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { planEnvironmentUpdate } from "./environment-editing.ts";
import { EnvironmentStore, parseAddEnvironmentInput } from "./environment-store.ts";
import { sshArguments } from "./ssh-command.ts";
import { computeSshStateKey, targetConnectionKey, validateSshTarget } from "./ssh-scripts.ts";
import { SshEnvironmentManager } from "./ssh-tunnel-manager.ts";

const target = { kind: "ssh", sshAlias: "gpu" };
const options = {
  identityFile: "~/.ssh/team's training key",
  proxyJump: "dev@bastion:2202,build@[2001:db8::1]:2222",
};

function assertOptionArguments(args, expected) {
  const destination = args.indexOf("gpu");
  assert.ok(destination > 0, "SSH must receive the destination alias");
  for (const [flag, value] of [
    ["-i", expected.identityFile],
    ["-J", expected.proxyJump],
  ]) {
    const index = args.indexOf(flag);
    if (value === undefined) {
      assert.equal(index, -1, `${flag} must be omitted when unset`);
      continue;
    }
    assert.ok(index >= 0 && index + 1 < destination, `${flag} and its value must precede the destination`);
    assert.equal(args[index + 1], value);
  }
}

function captureSshCommands(t) {
  const commands = [];
  t.mock.method(childProcess, "spawn", (executable, args, spawnOptions) => {
    commands.push({ executable, args, spawnOptions });
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
    });
    child.kill = () => {
      child.signalCode = "SIGTERM";
      child.emit("exit", null, "SIGTERM");
      child.emit("close", null, "SIGTERM");
      return true;
    };
    if (args.includes("-N")) {
      const localPort = args[args.indexOf("-L") + 1].split(":")[1];
      setImmediate(() => child.stderr.write(`Local forwarding listening on 127.0.0.1 port ${localPort}`));
    } else {
      child.stdin.once("finish", () => {
        const output = args.at(-1).includes("DEXON_LAUNCH")
          ? JSON.stringify({ port: 3780, ownership: "managed", authToken: "a".repeat(64) })
          : [
              "DEXON\tHOME\t/home/dev",
              "DEXON\tUSER\tdev",
              "DEXON\tSTATE\t/home/dev/.dexon",
              "DEXON\tWRITABLE\t1",
              "DEXON\tOS\tlinux",
              "DEXON\tARCH\tx64",
              "DEXON\tINSTALLED\t1",
              "DEXON\tNODE\t/usr/bin/node\t22.23.3",
            ].join("\n");
        child.stdout.end(output);
        child.exitCode = 0;
        child.emit("close", 0);
      });
    }
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return commands;
}

test("manual SSH identity and jump options survive parsing and saving a server", (t) => {
  const input = { label: "Training", target: { ...target, ...options } };
  const parsed = parseAddEnvironmentInput(input);
  assert.equal(parsed.target.identityFile, "~/.ssh/team's training key");
  assert.equal(parsed.target.proxyJump, "dev@bastion:2202,build@[2001:db8::1]:2222");

  const directory = mkdtempSync(path.join(tmpdir(), "dexon-ssh-options-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new EnvironmentStore(directory);
  const stored = store.create(input);
  store.save([stored]);
  const [reloaded] = new EnvironmentStore(directory).load();
  assert.equal(reloaded.id, stored.id);
  assert.equal(reloaded.target.identityFile, "~/.ssh/team's training key");
  assert.equal(reloaded.target.proxyJump, "dev@bastion:2202,build@[2001:db8::1]:2222");
});

test("SSH options accept bounded paths and jump chains but reject unsafe or malformed values", () => {
  const accepted = {
    identityFile: [
      options.identityFile,
      "/home/dev/.ssh/key with spaces",
      "C:\\Users\\dev\\.ssh\\training key",
      ".ssh/id_ed25519",
      "/tmp/key;$(literal)'s file",
      "/" + "a".repeat(4095),
    ],
    proxyJump: [
      options.proxyJump,
      "bastion",
      "none",
      "dev@jump:1",
      "jump:65535",
      "[::1]",
      "dev@[fe80::1%en0]:22",
      "ab" + ",a".repeat(2047),
    ],
  };
  for (const [field, values] of Object.entries(accepted)) {
    for (const value of values) {
      const candidate = { ...target, [field]: value };
      assert.doesNotThrow(() => validateSshTarget(candidate));
      assert.equal(parseAddEnvironmentInput({ label: "GPU", target: candidate }).target[field], value);
    }
  }

  const rejected = {
    identityFile: ["", " ", "-oProxyCommand=evil", "key\nother", "key\r", "key\0", "key\t", "key\u001b"],
    proxyJump: [
      "",
      " ",
      "-oProxyCommand=evil",
      "jump -oProxyCommand=evil",
      "jump;touch marker",
      "jump,$(id)",
      "jump,`id`",
      "jump\nother",
      "jump\0",
      "jump:0",
      "jump:65536",
      "jump:-1",
      "jump:port",
      "jump,",
      ",jump",
      "jump,,next",
      "dev@-jump",
      "@jump",
      "[::1]:0",
      "a" + ",a".repeat(2048),
    ],
  };
  for (const field of ["identityFile", "proxyJump"]) {
    for (const value of [...rejected[field], "a".repeat(4097), null, false, 22, [], {}]) {
      const candidate = { ...target, [field]: value };
      assert.throws(() => validateSshTarget(candidate), Error, `${field} must reject ${JSON.stringify(value)}`);
      assert.throws(() => parseAddEnvironmentInput({ label: "GPU", target: candidate }));
    }
  }
});

test("SSH argv keeps identity paths and jump chains in separate tokens before the alias", () => {
  for (const configured of [
    { ...target, ...options, identityFile: "/tmp/key;$(literal)'s file" },
    { ...target, identityFile: options.identityFile },
    { ...target, proxyJump: options.proxyJump },
  ])
    assertOptionArguments([...sshArguments(configured), "gpu"], configured);
  const defaults = sshArguments(target);
  assert.equal(defaults.includes("-i"), false);
  assert.equal(defaults.includes("-J"), false);
  assert.ok(defaults.includes("StrictHostKeyChecking=accept-new"));
  assert.throws(() => sshArguments({ ...target, identityFile: "bad\nfile" }));
  assert.throws(() => sshArguments({ ...target, proxyJump: "jump;evil" }));
});

test("public SSH probe, daemon launch and tunnel send the same manual options to OpenSSH", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-ssh-options-runtime-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ version: "0.3.3", payloads: [] }));
  const commands = captureSshCommands(t);
  const descriptor = {
    environmentId: "remote-gpu",
    label: "GPU",
    protocolVersion: 1,
    serverVersion: "0.3.3",
    platform: { os: "linux", arch: "x64", pathStyle: "posix", home: "/home/dev" },
    capabilities: {
      browser: false,
      nativeDialogs: false,
      revealInFileManager: false,
      managedProcesses: true,
      toolchainInstall: true,
    },
    runtime: { nodeVersion: "22.23.3", payloadVersion: "0.3.3", startedAt: 1 },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, request) =>
      new globalThis.Response(JSON.stringify(descriptor), {
        headers: {
          "x-dexon-proof": createHmac("sha256", "a".repeat(64)).update(request.headers["x-dexon-nonce"]).digest("hex"),
        },
      }),
  );
  const manager = new SshEnvironmentManager({ payloadDirectory: directory });
  const configured = { ...target, ...options };
  try {
    const probe = await manager.probe(configured);
    assert.equal(probe.node.version, "22.23.3");
    const tunnel = await manager.ensureTunnel(configured);
    assert.equal(tunnel.descriptor.environmentId, "remote-gpu");
    assert.ok(
      commands.some(({ args }) => args.at(-1).includes("DEXON_PROBE")),
      "a probe must reach SSH",
    );
    assert.ok(
      commands.some(({ args }) => args.at(-1).includes("DEXON_LAUNCH")),
      "a launch must reach SSH",
    );
    assert.ok(
      commands.some(({ args }) => args.includes("-N")),
      "a tunnel must reach SSH",
    );
    for (const { executable, args, spawnOptions } of commands) {
      assert.equal(executable, "ssh");
      assertOptionArguments(args, options);
      assert.ok(spawnOptions.shell === undefined || spawnOptions.shell === false);
      assert.equal(args.at(-1).includes(options.identityFile), false);
      assert.equal(args.at(-1).includes(options.proxyJump), false);
    }
  } finally {
    await manager.dispose();
  }
});

test("adding, replacing or removing an SSH option invalidates its connection and edit binding", () => {
  assert.equal(targetConnectionKey(target), '["gpu",null,null,22,3780,"~/.dexon"]');
  assert.equal(
    targetConnectionKey({ ...target, identityFile: undefined, proxyJump: undefined }),
    targetConnectionKey(target),
  );
  for (const [field, first, second] of [
    ["identityFile", "~/.ssh/key-a", "~/.ssh/key-b"],
    ["proxyJump", "jump-a", "jump-b"],
  ]) {
    for (const [before, after] of [
      [target, { ...target, [field]: first }],
      [
        { ...target, ...options },
        { ...target, ...options, [field]: second },
      ],
      [{ ...target, [field]: first }, target],
    ]) {
      assert.notEqual(targetConnectionKey(before), targetConnectionKey(after), `${field} changes connection identity`);
      assert.notEqual(computeSshStateKey(before), computeSshStateKey(after), `${field} changes the tunnel state key`);
      const current = {
        id: "saved-server",
        label: "GPU",
        enabled: true,
        authToken: "secret",
        target: { ...before, expectedEnvironmentId: "bound-remote" },
      };
      const plan = planEnvironmentUpdate(current, { label: "Training", target: after });
      assert.equal(plan.rebind, true);
      assert.equal(plan.reconnect, true);
      assert.equal(plan.configuration.target.expectedEnvironmentId, undefined);
      assert.equal(plan.configuration.target.identityFile, after.identityFile);
      assert.equal(plan.configuration.target.proxyJump, after.proxyJump);
      assert.equal(plan.configuration.id, "saved-server");
      assert.equal(plan.configuration.authToken, "secret");
      assert.equal(current.target.expectedEnvironmentId, "bound-remote");
    }
  }
});

test("renaming a server without changing SSH options preserves the binding and does not reconnect", () => {
  const current = {
    id: "saved-server",
    label: "GPU",
    enabled: true,
    authToken: "secret",
    target: { ...target, ...options, expectedEnvironmentId: "bound-remote" },
  };
  const plan = planEnvironmentUpdate(current, { label: "Training", target: { ...target, ...options } });
  assert.equal(plan.rebind, false);
  assert.equal(plan.reconnect, false);
  assert.equal(plan.configuration.label, "Training");
  assert.equal(plan.configuration.target.expectedEnvironmentId, "bound-remote");
  assert.equal(targetConnectionKey(plan.configuration.target), targetConnectionKey(current.target));
  assert.equal(computeSshStateKey(plan.configuration.target), computeSshStateKey(current.target));
});
