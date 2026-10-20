import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, precedes } from "../support/dom-queries.mjs";
import {
  click,
  control,
  currentPages,
  historyRow,
  restoreGlobals,
  visibleText,
  waitFor,
} from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import {
  daysAgo,
  delegateToolConversation,
  minutesAgo,
  sourceConversation,
  treeSession,
} from "../fixtures/session-tree-data.mjs";

after(restoreGlobals);

const chat = (scene) => control(scene.container, "region", "Chat");

function sessionPath(scene) {
  return control(scene.container, "navigation", "Session path");
}

test("opening a session three levels deep shows its whole path and every ancestor opens on click", async (t) => {
  const scene = await startSessionScene(t, [
    treeSession("path-root", { name: "Root plan", created: daysAgo(6), modified: daysAgo(6) }),
    treeSession("path-mid", {
      name: "Mid migration",
      parentSessionId: "path-root",
      created: daysAgo(5),
      modified: minutesAgo(30),
    }),
    treeSession("path-leaf", {
      name: "Leaf tests",
      parentSessionId: "path-mid",
      created: daysAgo(4),
      modified: minutesAgo(20),
    }),
  ]);
  await click(await waitFor(() => historyRow(scene, "Leaf tests")));
  await waitFor(() => visibleText(chat(scene), "path-leaf marker"));
  const path = sessionPath(scene);
  const segments = ["Root plan", "Mid migration", "Leaf tests"].map((title) =>
    [...path.querySelectorAll("*")].find((element) => accessibleName(element) === title),
  );
  assert.ok(segments.every(Boolean), "the path names every ancestor and the current session");
  assert.ok(precedes(segments[0], segments[1]), "the path starts at the root");
  assert.ok(precedes(segments[1], segments[2]), "the path ends at the session on screen");
  control(path, "button", "Root plan");
  control(path, "button", "Mid migration");
  await click(control(path, "button", "Root plan"));
  await waitFor(() => visibleText(chat(scene), "path-root marker"));
  assert.deepEqual(currentPages(scene), ["Root plan"]);
});

test("a message written by another session names that session and opens it", async (t) => {
  const scene = await startSessionScene(
    t,
    [
      sourceConversation("source-target", {
        name: "Delegating session",
        from: "personal-other",
        fromTitle: "Another personal conversation",
        text: "Please finish the migration list.",
        reply: "Migration list finished",
      }),
    ],
    { initialSession: "source-target" },
  );
  await waitFor(() => visibleText(chat(scene), "Please finish the migration list."));
  const chip = control(chat(scene), "button", "From session Another personal conversation");
  await click(chip);
  await waitFor(() => visibleText(chat(scene), "Other conversation marker"));
  assert.deepEqual(currentPages(scene), ["Another personal conversation"]);
});

test("a tool card that created another session names it and opens it", async (t) => {
  const scene = await startSessionScene(
    t,
    [
      delegateToolConversation("tool-target", {
        name: "Delegating tool session",
        target: "personal-other",
        targetTitle: "Another personal conversation",
        text: "Please start the migration in another session.",
        reply: "Delegated work finished",
      }),
    ],
    { initialSession: "tool-target" },
  );
  await waitFor(() => visibleText(chat(scene), "Delegated work finished"));
  await click(control(chat(scene), "button", /process details/i));
  const link = await waitFor(() => control(chat(scene), "button", "Open session Another personal conversation"));
  assert.match(link.textContent, /Another personal conversation/, "the card shows the other session's name");
  await click(link);
  await waitFor(() => visibleText(chat(scene), "Other conversation marker"));
  assert.deepEqual(currentPages(scene), ["Another personal conversation"]);
});
