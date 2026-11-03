import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSshArgv,
  controlDirectoryFor,
  controlSocketPathFor,
  ensureControlDirectory,
  remotePythonCommand,
} from "../../src/agent-host/workspace/host/ssh/argv.ts";

const context = {
  target: { user: "ubuntu", host: "prod-vps", port: 2222 },
  controlPath: "/tmp/dx-abc/def.s",
  dexonKnownHostsPath: "/data/Dexon/ssh/known_hosts",
  userKnownHostsPath: "/Users/me/.ssh/known_hosts",
};

function optionValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === "-o" && argv[index + 1].startsWith(`${name}=`))
      values.push(argv[index + 1].slice(name.length + 1));
  }
  return values;
}

test("every ssh command is non-interactive, shares one control connection and places the destination after --", () => {
  const argv = buildSshArgv(context, { kind: "exec", remoteCommand: "echo hi" });
  assert.equal(argv[0], "-T");
  assert.deepEqual(optionValues(argv, "BatchMode"), ["yes"]);
  assert.deepEqual(optionValues(argv, "ControlMaster"), ["auto"]);
  assert.deepEqual(optionValues(argv, "ControlPath"), ["/tmp/dx-abc/def.s"]);
  assert.deepEqual(optionValues(argv, "ControlPersist"), ["no"]);
  assert.deepEqual(optionValues(argv, "ServerAliveInterval"), ["5"]);
  assert.deepEqual(optionValues(argv, "ServerAliveCountMax"), ["3"]);
  assert.deepEqual(optionValues(argv, "StrictHostKeyChecking"), ["yes"]);
  const separator = argv.indexOf("--");
  assert.deepEqual(argv.slice(separator), ["--", "ubuntu@prod-vps", "echo hi"]);
  assert.equal(argv[argv.indexOf("-p") + 1], "2222");
});

test("both known_hosts files are passed as one option because ssh keeps only the first UserKnownHostsFile", () => {
  const argv = buildSshArgv(context, { kind: "exec", remoteCommand: "true" });
  assert.deepEqual(optionValues(argv, "UserKnownHostsFile"), [
    '"/data/Dexon/ssh/known_hosts" "/Users/me/.ssh/known_hosts"',
  ]);
});

test("a target without user or port omits -p and the user@ prefix", () => {
  const argv = buildSshArgv({ ...context, target: { host: "gpu-a100" } }, { kind: "exec", remoteCommand: "true" });
  assert.equal(argv.includes("-p"), false);
  assert.equal(argv[argv.indexOf("--") + 1], "gpu-a100");
});

test("an IPv6 literal is passed without brackets", () => {
  const argv = buildSshArgv(
    { ...context, target: { user: "u", host: "2001:db8::1" } },
    { kind: "exec", remoteCommand: "true" },
  );
  assert.equal(argv[argv.indexOf("--") + 1], "u@2001:db8::1");
});

test("a user or host starting with a dash is rejected so it cannot become an ssh option", () => {
  assert.throws(
    () => buildSshArgv({ ...context, target: { host: "-oProxyCommand=evil" } }, { kind: "exec", remoteCommand: "x" }),
    /Invalid ssh target/,
  );
  assert.throws(
    () => buildSshArgv({ ...context, target: { user: "-l", host: "h" } }, { kind: "exec", remoteCommand: "x" }),
    /Invalid ssh target/,
  );
  assert.throws(
    () => buildSshArgv({ ...context, target: { host: "h h" } }, { kind: "exec", remoteCommand: "x" }),
    /Invalid ssh target/,
  );
});

test("forward and cancel control commands carry the loopback mapping and the control socket", () => {
  const forward = buildSshArgv(context, { kind: "forward", localPort: 54321, remotePort: 3000 });
  assert.equal(forward[forward.indexOf("-O") + 1], "forward");
  assert.equal(forward[forward.indexOf("-L") + 1], "127.0.0.1:54321:127.0.0.1:3000");
  assert.deepEqual(forward.slice(forward.indexOf("--")), ["--", "ubuntu@prod-vps"]);
  const cancel = buildSshArgv(context, { kind: "cancel", localPort: 54321, remotePort: 3000 });
  assert.equal(cancel[cancel.indexOf("-O") + 1], "cancel");
  assert.equal(cancel[cancel.indexOf("-L") + 1], "127.0.0.1:54321:127.0.0.1:3000");
  assert.equal(
    buildSshArgv(context, { kind: "check" })[buildSshArgv(context, { kind: "check" }).indexOf("-O") + 1],
    "check",
  );
});

test("forward ports outside 1..65535 are rejected", () => {
  assert.throws(() => buildSshArgv(context, { kind: "forward", localPort: 0, remotePort: 3000 }), /port/i);
  assert.throws(() => buildSshArgv(context, { kind: "forward", localPort: 3000, remotePort: 70000 }), /port/i);
});

test("the remote python command reads exactly the script length from stdin so binary frames can follow", () => {
  const script = "print('héllo')\n";
  const command = remotePythonCommand(script);
  const length = Buffer.byteLength(script, "utf8");
  assert.match(command, /^exec python3 -u -c '/);
  assert.ok(command.includes(`sys.stdin.buffer.read(${length})`));
  assert.ok(!command.includes("\n"));
});

test("control socket paths stay within 100 bytes even for very long hosts and temp directories", () => {
  const longTarget = { user: "u".repeat(60), host: `${"h".repeat(120)}.example.com`, port: 2222 };
  const socket = controlSocketPathFor(longTarget, { root: `/var/folders/${"x".repeat(200)}/T`, uid: 501 });
  assert.ok(Buffer.byteLength(socket) <= 100, socket);
  assert.ok(socket.endsWith(".s"));
});

test("the same target maps to the same socket and different targets or users map to different sockets", () => {
  const a = controlSocketPathFor({ user: "a", host: "h" }, { root: "/tmp", uid: 501 });
  assert.equal(a, controlSocketPathFor({ user: "a", host: "h" }, { root: "/tmp", uid: 501 }));
  assert.notEqual(a, controlSocketPathFor({ user: "b", host: "h" }, { root: "/tmp", uid: 501 }));
  assert.notEqual(a, controlSocketPathFor({ user: "a", host: "h", port: 2222 }, { root: "/tmp", uid: 501 }));
  assert.notEqual(controlDirectoryFor({ root: "/tmp", uid: 501 }), controlDirectoryFor({ root: "/tmp", uid: 502 }));
});

test("the private control directory is created owner-only", { skip: process.platform === "win32" }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "dx-argv-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = ensureControlDirectory({ root, uid: 501 });
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(ensureControlDirectory({ root, uid: 501 }), directory);
});
