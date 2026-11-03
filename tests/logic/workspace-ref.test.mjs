import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
import { normalizeWorktreePathForComparison } from "../../src/shared/worktree-path.ts";

const workspace = await importTestBundle("workspace-ref-browser", {
  entryPoints: [path.resolve("src/shared/workspace-ref.ts")],
  platform: "browser",
});

const sessions = await importTestBundle("workspace-project-identity", {
  entryPoints: [path.resolve("src/renderer/lib/session-list.ts")],
  tsconfig: path.resolve("tsconfig.renderer.json"),
  platform: "browser",
});

const session = (id, cwd) => ({ id, cwd, modified: "2026-10-29T00:00:00.000Z" });

test("remote projects on different hosts keep separate canonical project identities", () => {
  const production = "ssh://ubuntu@prod-vps/home/ubuntu/app";
  const staging = "ssh://ubuntu@staging-02/home/ubuntu/app";
  assert.equal(sessions.sessionProjectKey(production), production);
  assert.equal(sessions.sessionProjectKey(staging), staging);
  assert.equal(sessions.sessionProjectKey("ubuntu@prod-vps:/home/ubuntu/./app/"), production);
  assert.equal(
    normalizeWorktreePathForComparison("ssh://ubuntu@prod-vps/home/ubuntu/App", "win32"),
    "ssh://ubuntu@prod-vps/home/ubuntu/App",
  );
  assert.deepEqual(
    sessions.groupSessionsByProject([session("prod", production), session("stage", staging)], production),
    [
      { root: production, sessions: [session("prod", production)] },
      { root: staging, sessions: [session("stage", staging)] },
    ],
  );
});

test("workspace addresses normalize remote directories without changing local absolute paths", () => {
  for (const [input, expected] of [
    [
      "ssh://ubuntu@prod-vps:2222/home//ubuntu/./work/../App/",
      { kind: "ssh", target: { user: "ubuntu", host: "prod-vps", port: 2222 }, root: "/home/ubuntu/App" },
    ],
    [
      "SSH://ubuntu@[::1]:22/home/ubuntu/app",
      { kind: "ssh", target: { user: "ubuntu", host: "::1", port: 22 }, root: "/home/ubuntu/app" },
    ],
    ["[2001:db8::1]:/home/ubuntu/app", { kind: "ssh", target: { host: "2001:db8::1" }, root: "/home/ubuntu/app" }],
    [
      "ssh://prod-vps/home/with%20space/%E4%B8%AD%E6%96%87",
      { kind: "ssh", target: { host: "prod-vps" }, root: "/home/with space/中文" },
    ],
    ["prod-vps:/../../", { kind: "ssh", target: { host: "prod-vps" }, root: "/" }],
    ["/local/../Project/", { kind: "local", root: "/local/../Project/" }],
    ["C:/Projects/App", { kind: "local", root: "C:/Projects/App" }],
    ["C:\\Projects\\App", { kind: "local", root: "C:\\Projects\\App" }],
    ["\\\\server\\share\\App", { kind: "local", root: "\\\\server\\share\\App" }],
    ["u@c:/app", { kind: "ssh", target: { user: "u", host: "c" }, root: "/app" }],
  ]) {
    assert.deepEqual(workspace.parseWorkspaceInput(input), { ok: true, value: expected }, input);
  }
  assert.equal(workspace.normalizePosixPath("///home/./ubuntu/work/../App///"), "/home/ubuntu/App");
});

test("unsafe or incomplete workspace input returns an error without accepting server options", () => {
  for (const input of [
    "",
    "   ",
    "/app\0evil",
    "/app\r",
    "/app\n",
    "relative/app",
    "C:relative",
    "\\\\server",
    "ssh://host",
    "ssh://host:0/app",
    "ssh://host:65536/app",
    "ssh://host:abc/app",
    "ssh://host:/app",
    "ssh://user:password@host/app",
    "ssh://host/app?query",
    "ssh://host/app#fragment",
    "ssh://host/%ZZ",
    "ssh://host/%00",
    "ssh://host/%0a",
    "ssh://host/%0D",
    "ssh://-option/app",
    "ssh://-user@host/app",
    "-option:/app",
    "-user@host:/app",
    "user@-host:/app",
    "user name@host:/app",
    "user@host name:/app",
    "ssh://user%0Aname@host/app",
    "ssh://[not-ipv6]/app",
    "ssh://user@@host/app",
    "host:~/app",
  ]) {
    const parsed = workspace.parseWorkspaceInput(input);
    assert.equal(parsed.ok, false, JSON.stringify(input));
    assert.equal(typeof parsed.error, "string");
    assert.ok(parsed.error.length > 0);
  }
  assert.throws(() => workspace.normalizePosixPath("relative/path"));
});

test("web and file links pasted as a workspace address are rejected instead of becoming server hosts", () => {
  for (const input of [
    "https://example.com/foo",
    "http://localhost:3000/app",
    "file:///etc/passwd",
    "host://home/app",
    "user@host://app",
  ]) {
    assert.equal(workspace.parseWorkspaceInput(input).ok, false, input);
    assert.equal(workspace.parseSshConnectInput(input).ok, false, input);
  }
});

test("saved keys and display labels keep host identity and round-trip reserved path characters", () => {
  const ipv6 = workspace.parseWorkspaceInput("ssh://ubuntu@[::1]:22/home/ubuntu/app").value;
  assert.equal(workspace.keyOf(ipv6), "ssh://ubuntu@[::1]/home/ubuntu/app");
  assert.equal(workspace.hostIdOf(ipv6), "ssh://ubuntu@[::1]:22");
  assert.equal(workspace.formatSshHostLabel(ipv6.target), "[::1]");
  assert.equal(workspace.formatSshAuthority(ipv6.target), "ubuntu@[::1]");
  assert.equal(workspace.formatSshAuthority({ host: "prod-vps", user: "ubuntu", port: 2222 }), "ubuntu@prod-vps:2222");
  const remote = workspace.parseWorkspaceInput("ubuntu@prod-vps:/home/ubuntu/work/app").value;
  assert.deepEqual(workspace.fromKey(workspace.keyOf(remote)), { ok: true, value: remote });
  assert.deepEqual(workspace.describeWorkspaceKey(workspace.keyOf(remote)), {
    isSsh: true,
    workspaceKey: "ssh://ubuntu@prod-vps/home/ubuntu/work/app",
    folderName: "app",
    hostLabel: "prod-vps",
    authorityLabel: "ubuntu@prod-vps",
    displayPath: "/home/ubuntu/work/app",
    pulsePrefix: "app@prod-vps",
  });
  const reserved = workspace.parseWorkspaceInput("ssh://prod-vps/home/literal%2520/%23%3F").value;
  assert.equal(workspace.keyOf(reserved), "ssh://prod-vps/home/literal%2520/%23%3F");
  assert.deepEqual(workspace.fromKey(workspace.keyOf(reserved)), { ok: true, value: reserved });
  for (const root of ["/home/local/App/", "C:\\Projects\\App", "\\\\server\\share\\App"]) {
    const ref = workspace.parseWorkspaceInput(root).value;
    assert.equal(workspace.keyOf(ref), root);
    assert.equal(workspace.hostIdOf(ref), "local");
    assert.deepEqual(workspace.describeWorkspaceKey(root), {
      isSsh: false,
      workspaceKey: root,
      folderName: "App",
      hostLabel: null,
      authorityLabel: null,
      displayPath: root,
      pulsePrefix: "App",
    });
  }
  assert.equal(workspace.describeWorkspaceKey("/").folderName, "/");
  assert.equal(workspace.describeWorkspaceKey("ssh://prod-vps/").folderName, "/");
});

test("connection input recognizes terminal login commands and separates hosts from full workspaces", () => {
  assert.equal(typeof workspace.parseSshConnectInput, "function", "connection parsing must be available to callers");
  const target = { user: "ubuntu", host: "47.98.12.34", port: 2222 };
  for (const input of [
    "ssh -p 2222 ubuntu@47.98.12.34",
    "ssh ubuntu@47.98.12.34 -p 2222",
    "ssh -l ubuntu -p2222 47.98.12.34",
    "ssh 47.98.12.34 -lubuntu -p 2222",
    "ssh -i '~/.ssh/my key' -J bastion -p 2222 ubuntu@47.98.12.34",
    "ubuntu@47.98.12.34:2222",
    "ssh://ubuntu@47.98.12.34:2222",
  ]) {
    assert.deepEqual(workspace.parseSshConnectInput(input), { ok: true, value: { kind: "host-only", target } }, input);
  }
  for (const input of ["prod-vps", "ssh prod-vps", "ssh -- prod-vps"])
    assert.deepEqual(workspace.parseSshConnectInput(input), {
      ok: true,
      value: { kind: "host-only", target: { host: "prod-vps" } },
    });
  assert.deepEqual(workspace.parseSshConnectInput("ubuntu@prod-vps"), {
    ok: true,
    value: { kind: "host-only", target: { user: "ubuntu", host: "prod-vps" } },
  });
  assert.deepEqual(workspace.parseSshConnectInput("user@host:~/work"), {
    ok: true,
    value: { kind: "host-only", target: { user: "user", host: "host" }, suggestedPath: "~/work" },
  });
  for (const input of ["ubuntu@prod-vps:/home//ubuntu/app/", "ssh://ubuntu@prod-vps/home/ubuntu/app"])
    assert.deepEqual(workspace.parseSshConnectInput(input), {
      ok: true,
      value: {
        kind: "workspace",
        ref: { kind: "ssh", target: { user: "ubuntu", host: "prod-vps" }, root: "/home/ubuntu/app" },
      },
    });
  assert.deepEqual(workspace.parseSshConnectInput("ssh -p 2222 ubuntu@[::1]"), {
    ok: true,
    value: { kind: "host-only", target: { user: "ubuntu", host: "::1", port: 2222 } },
  });
});

test("connection parsing rejects local paths, malformed commands, and option-injected users or hosts", () => {
  for (const input of [
    "",
    "ssh",
    "ssh -p",
    "ssh -p 0 host",
    "ssh -p 65536 host",
    "ssh -p 2e3 host",
    "ssh -l -option host",
    "ssh -- -option",
    "ssh -o ProxyCommand=evil host",
    "ssh host command",
    "ssh -i 'unfinished host",
    "ssh -p 22 -p 23 host",
    "ssh user@host -l other",
    "ssh -p 23 user@host:24",
    "-user@host",
    "user@-host",
    "-host",
    "user name@host",
    "user@host name",
    "ssh://user:password@host",
    "ssh://host?query",
    "ssh://host#fragment",
    "ssh://host/app%00",
    "ssh://host/app%0a",
    "ssh://-host",
    "ssh://-user@host",
    "host\n",
    "user\0@host",
    "/local/app",
    "C:/Projects/App",
    "C:\\Projects\\App",
    "\\\\server\\share\\App",
  ]) {
    const parsed = workspace.parseSshConnectInput(input);
    assert.equal(parsed.ok, false, JSON.stringify(input));
    assert.equal(typeof parsed.error, "string");
  }
});

test("workspace file paths join and become relative only within the same host and directory boundary", () => {
  assert.equal(typeof workspace.joinWorkspaceKeyPath, "function", "workspace file joins must be available to callers");
  const root = "ssh://ubuntu@prod-vps/home/ubuntu/App";
  assert.equal(workspace.joinWorkspaceKeyPath(root, "src/./db/../pool.ts"), `${root}/src/pool.ts`);
  assert.equal(workspace.joinWorkspaceKeyPath(`${root}/src`, "../README.md"), `${root}/README.md`);
  assert.equal(workspace.joinWorkspaceKeyPath("ssh://[::1]:2222/", "src/app.ts"), "ssh://[::1]:2222/src/app.ts");
  assert.equal(workspace.relativeWorkspacePath(root, `${root}/src/pool.ts`), "src/pool.ts");
  assert.equal(workspace.relativeWorkspacePath(root, "/home/ubuntu/App/src/pool.ts"), "src/pool.ts");
  assert.equal(workspace.relativeWorkspacePath(root, root), "");
  for (const target of [
    "ssh://ubuntu@staging-02/home/ubuntu/App/src/pool.ts",
    "ssh://root@prod-vps/home/ubuntu/App/src/pool.ts",
    "ssh://ubuntu@prod-vps:2222/home/ubuntu/App/src/pool.ts",
    "/home/ubuntu/Application/pool.ts",
    "/home/ubuntu/app/pool.ts",
    "/home/ubuntu/App/../outside",
    "../outside",
    "C:/Projects/App",
  ])
    assert.equal(workspace.relativeWorkspacePath(root, target), null, target);
  assert.equal(workspace.relativeWorkspacePath("ssh://prod-vps/", "/src/app.ts"), "src/app.ts");
  assert.equal(workspace.relativeWorkspacePath("ssh://prod-vps:22/app", "ssh://prod-vps/app/a.ts"), "a.ts");
  assert.equal(workspace.joinWorkspaceKeyPath("C:\\Projects\\App", "src/pool.ts"), "C:\\Projects\\App\\src\\pool.ts");
  assert.equal(workspace.relativeWorkspacePath("C:\\Projects\\App", "c:/projects/app/Src/Pool.ts"), "Src/Pool.ts");
  assert.equal(workspace.relativeWorkspacePath("C:/Projects/App", "D:/Projects/App/a.ts"), null);
  assert.equal(
    workspace.joinWorkspaceKeyPath("\\\\server\\share\\App", "src/a.ts"),
    "\\\\server\\share\\App\\src\\a.ts",
  );
  assert.equal(workspace.relativeWorkspacePath("\\\\server\\share\\App", "//SERVER/share/App/src/a.ts"), "src/a.ts");
  assert.equal(workspace.joinWorkspaceKeyPath("/local/App", "src/a.ts"), "/local/App/src/a.ts");
  assert.equal(workspace.relativeWorkspacePath("/local/App", "/local/App/src/a.ts"), "src/a.ts");
  assert.equal(workspace.relativeWorkspacePath("/local/App", "ssh://prod-vps/local/App/src/a.ts"), null);
  assert.equal(workspace.relativeWorkspacePath("/local/App", "/local/App2/src/a.ts"), null);
  assert.equal(workspace.relativeWorkspacePath("/local/App", "/local/app/src/a.ts"), null);
  assert.equal(workspace.isPosixPathUnder("/app/src", "/app"), true);
  assert.equal(workspace.isPosixPathUnder("/app", "/app"), true);
  assert.equal(workspace.isPosixPathUnder("/app2", "/app"), false);
  assert.equal(workspace.isPosixPathUnder("/App/src", "/app"), false);
  assert.equal(workspace.isPosixPathUnder("/app/../outside", "/app"), false);
  assert.equal(workspace.isPosixPathUnder("/anything", "/"), true);
  for (const child of ["/absolute", "ssh://other/app", "C:/absolute", "bad\0path"])
    assert.throws(() => workspace.joinWorkspaceKeyPath(root, child), child);
});
