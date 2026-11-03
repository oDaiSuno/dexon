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
const RESULT = "Remote pool definition was loaded";

async function toolScene(t, path, { cwd = REMOTE, toolName = "read", space = "remote", streaming = false } = {}) {
  const settings = { history: false, initialSession: "file-tools", openProjects: [P.personal, cwd] };
  const base = navigationBoundary(settings);
  const detail = startedConversation("file-tools", cwd, "Inspect the pool definition");
  const call = {
    role: "assistant",
    content: [{ type: "toolCall", toolCallId: "read-pool", toolName, input: { path } }],
    provider: "navigation-fixture",
    model: "navigation-model",
    stopReason: "toolUse",
    timestamp: 2,
  };
  if (streaming) detail.agentState = { running: true, state: { isStreaming: true, streamingMessage: call } };
  else {
    detail.context.messages.push(
      call,
      {
        role: "toolResult",
        toolCallId: "read-pool",
        toolName,
        content: [{ type: "text", text: "file inspected" }],
        isError: false,
        timestamp: 3,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The pool definition is ready" }],
        provider: "navigation-fixture",
        model: "navigation-model",
        stopReason: "stop",
        timestamp: 4,
      },
    );
    detail.context.entryIds.push("file-tools-call", "file-tools-result", "file-tools-answer");
    detail.context.totalMessages = 4;
    detail.context.loadedMessages = 4;
    detail.info.messageCount = 4;
  }
  base.addConversation(detail);
  let external;
  external = remoteHostBoundary(base, {
    "remote.workspacesSnapshot": {
      states: {
        [REMOTE]: {
          workspace: REMOTE,
          hostLabel: "prod-vps",
          authorityLabel: "ubuntu@prod-vps",
          remotePath: "/home/ubuntu/work/app",
          connection: "connected",
          workspaceTrust: "trusted",
          trustRevision: 1,
          localSkillCount: 0,
          remoteSkillCount: 0,
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
        },
      },
    },
    "skills.list": { skills: [] },
    "files.read": {
      content: RESULT,
      language: "text",
      space,
      remoteHostLabel: space === "remote" ? "prod-vps" : undefined,
    },
    "files.watchStart": ({ path: filePath }) => {
      external.emitFileEvent({ path: filePath, event: "connected" });
      return { ok: true };
    },
  });
  const scene = await startNavigation(t, settings, external);
  await scene.settled();
  const processed = roles(scene.container, "button", /^Processed/);
  if (processed.length) await click(processed[0]);
  return scene;
}

for (const [toolName, path, expected] of [
  ["read", "src/db/pool.ts", `${REMOTE}/src/db/pool.ts`],
  ["write", "/home/ubuntu/work/app/src/db/pool.ts", `${REMOTE}/src/db/pool.ts`],
  ["edit", "/etc/app/pool.conf", "ssh://ubuntu@prod-vps/etc/app/pool.conf"],
]) {
  test(`when an SSH ${toolName} card opens ${path} its file chip opens the right panel on that server and never the desktop editor`, async (t) => {
    const scene = await toolScene(t, path, { toolName });
    visibleText(scene.container, "Remote prod-vps");
    const chip = control(scene.container, "button", `Open ${path}`);
    assert.equal(chip.parentElement.closest("button"), null, "the file button is not nested in the accordion button");
    await click(chip);
    await waitFor(() => visibleText(scene.container, RESULT));
    assert.deepEqual(scene.external.requests("files.read"), [{ path: expected, sourceSessionId: "file-tools" }]);
    assert.deepEqual(scene.external.desktop.openedFiles, []);
    control(scene.container, "button", "Hide file panel");
  });
}

for (const path of ["~/.pi/agent/skills/guide/SKILL.md", `${P.home}/.pi/agent/skills/guide/SKILL.md`]) {
  test(`when an SSH read card refers to ${path} its chip identifies and opens the local overlay`, async (t) => {
    const scene = await toolScene(t, path, { space: "local-overlay" });
    visibleText(scene.container, "💻 Local read-only layer");
    assert.doesNotMatch(control(scene.container, "region", "Conversation").textContent, /Remote prod-vps/);
    await click(control(scene.container, "button", `Open ${path}`));
    await waitFor(() => visibleText(scene.container, RESULT));
    assert.deepEqual(scene.external.requests("files.read"), [
      { path: `${P.home}/.pi/agent/skills/guide/SKILL.md`, sourceSessionId: "file-tools" },
    ]);
    assert.deepEqual(scene.external.desktop.openedFiles, []);
  });
}

test("when a local read card opens a relative file it keeps local path semantics and shows no SSH provenance", async (t) => {
  const scene = await toolScene(t, "src/db/pool.ts", { cwd: P.project, space: "local" });
  assert.doesNotMatch(
    control(scene.container, "region", "Conversation").textContent,
    /Remote prod-vps|Local read-only layer/,
  );
  await click(control(scene.container, "button", "Open src/db/pool.ts"));
  await waitFor(() => visibleText(scene.container, RESULT));
  assert.deepEqual(scene.external.requests("files.read"), [
    { path: `${P.project}/src/db/pool.ts`, sourceSessionId: "file-tools" },
  ]);
  assert.deepEqual(scene.external.desktop.openedFiles, []);
});

test("when a remote file tool is still running its streamed chip also opens the right-panel viewer", async (t) => {
  const scene = await toolScene(t, "src/db/pool.ts", { streaming: true });
  await click(control(scene.container, "button", "Open src/db/pool.ts"));
  await waitFor(() => visibleText(scene.container, RESULT));
  assert.deepEqual(scene.external.requests("files.read"), [
    { path: `${REMOTE}/src/db/pool.ts`, sourceSessionId: "file-tools" },
  ]);
  await act(async () => scene.external.finishStream("file-tools", "Finished inspecting"));
});

test("when an SSH tool opens an absolute file outside the repository its viewer still follows the session server connection", async (t) => {
  const scene = await toolScene(t, "/etc/app/pool.conf");
  await click(control(scene.container, "button", "Open /etc/app/pool.conf"));
  await waitFor(() => visibleText(scene.container, RESULT));
  await waitFor(() => visibleText(scene.container, "Live · prod-vps"));
});

test("when an SSH file tool reports a non-file URI the conversation stays readable without offering a broken viewer action", async (t) => {
  const scene = await toolScene(t, "src/db/pool.ts", { streaming: true });
  await act(async () =>
    scene.external.agentEvent("file-tools", {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            toolCallId: "read-pool",
            toolName: "read",
            input: { path: "https://example.com/pool.ts" },
          },
        ],
        provider: "navigation-fixture",
        model: "navigation-model",
        timestamp: 2,
      },
    }),
  );
  visibleText(control(scene.container, "region", "Conversation"), "https://example.com/pool.ts");
  assert.equal(roles(scene.container, "button", "Open https://example.com/pool.ts").length, 0);
  assert.doesNotMatch(scene.container.textContent, /UI crashed/);
});
