import assert from "node:assert/strict";
import test from "node:test";
import { buildPreviewData } from "./ui-preview-data.mjs";
import { sessionDateGroup } from "../renderer/lib/session-list.ts";

// The preview sample data must be rich enough to make the eight confirmation
// screens honest: three populated date groups with parent-child chains,
// running/unread states, long bilingual titles and messages, plugins in both
// scopes, and skills from several sources. Everything here is in-memory only.
// Reference instants cover the local midnight edge cases (review R5): a run
// shortly after midnight must not lose the "today" group.

function referenceAt(hours) {
  const date = new Date();
  date.setHours(Math.floor(hours), Math.round((hours % 1) * 60), 0, 0);
  return date;
}

function referenceSet() {
  return [0.5, 12, 23.5].map(referenceAt);
}

const data = buildPreviewData({ now: referenceAt(12) });

test("the sample space is the fixed personal workspace", () => {
  assert.ok(data.space.name.length > 0, "the space needs a friendly name");
  assert.match(data.space.path, /\.dexon/, "the sample space path must point at the .dexon workspace");
  assert.ok(data.cwd.length > 0, "the sample cwd must be present");
});

test("sessions span all three date groups with unique ids at every reference instant", () => {
  const sessions = data.sessions;
  assert.ok(sessions.length >= 10, `expected at least 10 sample sessions, found ${sessions.length}`);
  const ids = new Set(sessions.map((session) => session.id));
  assert.equal(ids.size, sessions.length, "session ids must be unique");

  for (const reference of referenceSet()) {
    const sample = buildPreviewData({ now: reference });
    const groups = { today: 0, recent: 0, older: 0 };
    for (const session of sample.sessions) {
      groups[sessionDateGroup(session.modified, reference)] += 1;
      assert.ok(session.cwd, `session ${session.id} must have a cwd`);
      assert.ok(session.firstMessage.length > 0, `session ${session.id} must have a first message`);
    }
    assert.ok(groups.today >= 2, `today group must be populated at ${reference.toISOString()}, found ${groups.today}`);
    assert.ok(
      groups.recent >= 2,
      `recent group must be populated at ${reference.toISOString()}, found ${groups.recent}`,
    );
    assert.ok(groups.older >= 2, `older group must be populated at ${reference.toISOString()}, found ${groups.older}`);
  }
});

test("sample sessions include parent-child chains and status sets", () => {
  const { sessions, runningSessionIds, unreadSessionIds } = data;
  const byId = new Map(sessions.map((session) => [session.id, session]));

  const children = sessions.filter((session) => session.parentSessionId);
  assert.ok(children.length >= 2, "at least two forked sessions must exist for the derived-relations visual");
  for (const child of children) {
    assert.ok(byId.has(child.parentSessionId), `parent of ${child.id} must exist`);
  }
  const grandchild = children.find((child) => byId.get(child.parentSessionId)?.parentSessionId);
  assert.ok(grandchild, "a two-level chain must exist so the deep-nesting visual is honest");

  assert.ok(runningSessionIds.length >= 1, "at least one session must be running");
  assert.ok(unreadSessionIds.length >= 1, "at least one session must be unread");
  for (const id of runningSessionIds) assert.ok(byId.has(id), `running id ${id} must reference a session`);
  for (const id of unreadSessionIds) assert.ok(byId.has(id), `unread id ${id} must reference a session`);
});

test("titles and chat copy include long Chinese and long English samples", () => {
  const cjk = /[\u4e00-\u9fff]/;
  const longNames = data.sessions.map((session) => session.name ?? "").filter((name) => name.length >= 24);
  assert.ok(
    longNames.some((name) => cjk.test(name)),
    "a long Chinese session title must exist for the bilingual long-text check",
  );
  assert.ok(
    longNames.some((name) => !cjk.test(name)),
    "a long English session title must exist for the bilingual long-text check",
  );

  const bodyOf = (message) =>
    typeof message.content === "string"
      ? message.content
      : (message.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  const messages = data.chatMessages;
  assert.ok(messages.length >= 2, "the chat canvas needs a conversation");
  const longBodies = messages.map(bodyOf).filter((body) => body.length >= 120);
  assert.ok(
    longBodies.some((body) => cjk.test(body)),
    "a long Chinese message must exist",
  );
  assert.ok(
    longBodies.some((body) => !cjk.test(body)),
    "a long English message must exist",
  );
});

test("plugins cover both scopes and skills cover several sources", () => {
  const scopes = new Set(data.plugins.map((plugin) => plugin.scope));
  assert.ok(scopes.has("global"), "at least one global plugin must exist");
  assert.ok(scopes.has("project"), "at least one project plugin must exist");
  assert.ok(data.plugins.length >= 3, "the plugins list needs enough rows for a real page");

  const sources = new Set(data.skills.map((skill) => skill.sourceInfo?.source));
  assert.ok(sources.size >= 2, "skills must come from at least two sources");
  assert.ok(data.skills.length >= 3, "the skills list needs enough rows for a real page");
});
