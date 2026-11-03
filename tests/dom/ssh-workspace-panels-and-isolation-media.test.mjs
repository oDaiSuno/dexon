import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  roles,
  startNavigation,
  visibleText,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";

after(restoreGlobals);

const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/work/app";

function snapshot(connection) {
  return {
    workspace: REMOTE,
    hostLabel: "prod-vps",
    authorityLabel: "ubuntu@prod-vps",
    remotePath: "/home/ubuntu/work/app",
    connection,
    workspaceTrust: "trusted",
    trustRevision: 1,
    remoteSkillCount: 0,
    localSkillCount: 0,
    ruleLens: {
      localAgentsMd: true,
      localSkillCount: 0,
      credentialsBlocked: true,
      remoteAgentsMdPaths: [],
      remoteSkillCount: 0,
      ancestorBoundary: "git-root",
      boundaryPath: "/home/ubuntu/work/app",
      syncedAt: 1,
    },
    containment: { state: "verified-clean", activeRemoteProcessCount: 0 },
  };
}

async function mediaScene(t, name, space = "remote") {
  const settings = { history: false, initialSession: "ssh-media", openProjects: [P.personal, REMOTE] };
  const base = navigationBoundary(settings);
  base.addConversation(startedConversation("ssh-media", REMOTE, "Inspect remote media"));
  let available = true;
  let external;
  const read = () => {
    if (!available) throw new Error("Remote preview is unreachable");
    return {
      content: "cHJldmlldyBieXRlcw==",
      encoding: "base64",
      mime: "application/octet-stream",
      space,
      remoteHostLabel: "prod-vps",
    };
  };
  external = remoteHostBoundary(base, {
    "remote.workspacesSnapshot": { states: { [REMOTE]: snapshot("connected") } },
    "skills.list": { skills: [] },
    "files.list": { entries: [{ name, type: "file", isDir: false }] },
    "files.read": read,
    "files.watchStart": ({ path }) => {
      external.emitFileEvent({ path, event: "connected" });
      return { ok: true };
    },
  });
  const scene = await startNavigation(t, settings, external);
  await scene.settled();
  await click(control(scene.container, "button", "Show file panel"));
  await click(await waitFor(() => control(scene.container, "button", `Open file ${name}`)));
  return {
    ...scene,
    path: `${REMOTE}/${name}`,
    failRefresh: () => {
      available = false;
    },
    recover: () => {
      available = true;
    },
  };
}

function preview(scene, kind) {
  const element = scene.container.querySelector(`[data-testid="file-${kind}-preview"]`);
  assert.ok(element, `the ${kind} preview stays present: ${scene.container.textContent}`);
  assert.ok(element.getAttribute("src")?.startsWith("blob:"), "the viewer has actual loaded bytes");
  return element;
}

for (const [name, kind] of [
  ["diagram.png", "image"],
  ["recording.wav", "audio"],
  ["notes.pdf", "document"],
]) {
  test(`when remote ${name} disconnects or refresh fails the preview stays visible as an offline snapshot and reconnect refreshes it`, async (t) => {
    const scene = await mediaScene(t, name);
    await waitFor(() => visibleText(scene.container, "Live · prod-vps"));
    const initial = await waitFor(() => preview(scene, kind).getAttribute("src"));
    scene.failRefresh();
    await act(async () => {
      scene.external.emitFileEvent({ path: scene.path, event: "change" });
      scene.external.emitFileEvent({ path: scene.path, event: "error" });
    });
    await scene.settled();
    visibleText(scene.container, "Offline snapshot (read-only)");
    assert.equal(preview(scene, kind).getAttribute("src"), initial);
    assert.doesNotMatch(scene.container.textContent, /Remote preview is unreachable/);
    await act(async () => scene.external.emitWorkspaceState({ workspace: REMOTE, state: snapshot("offline") }));
    assert.equal(preview(scene, kind).getAttribute("src"), initial);
    scene.recover();
    await act(async () => scene.external.emitWorkspaceState({ workspace: REMOTE, state: snapshot("connected") }));
    await waitFor(() => assert.notEqual(preview(scene, kind).getAttribute("src"), initial));
    await waitFor(() => visibleText(scene.container, "Live · prod-vps"));
    assert.deepEqual(scene.external.desktop.openedFiles, []);
  });

  test(`when ${name} is supplied by the local overlay its preview lamp identifies the local read-only layer`, async (t) => {
    const scene = await mediaScene(t, name, "local-overlay");
    await waitFor(() => visibleText(scene.container, "💻 Local read-only layer"));
    preview(scene, kind);
    assert.equal(roles(scene.container, "status", "Live · prod-vps").length, 0);
  });
}
