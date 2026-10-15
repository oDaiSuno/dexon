// target: scripts/phase-8-fixture-cases.mjs
// Contract: spec §3.4 / plan §2.7 / ASTRA-R10-F001; reviewer-authorized placement alignment.
// Expected failure features: RESTORATION_CONTRACT:fetch / RESTORATION_CONTRACT:navigator.
const components = "src/renderer/components/";
const hooks = "src/renderer/hooks/";
const composition = `${components}chat-window-composition.test.mjs`;
const compositionTitles = {
  rejecting: "a rejecting bundle acquisition restores the environment and host",
  hookOnly: "the ordered teardown alone restores a rejecting acquisition",
  deleting: "an originally absent fetch is absent again after the ordered release",
};
const message = (text) => ({ kind: "message", text });
const first = { kind: "first" };
const rejected = { kind: "method", method: "rejects" };
const installed = message("the fixture fetch remains installed during the test");
const released = message("the host binding is released when acquisition fails");

export const unsupportedSetups = [
  {
    file: composition,
    title: compositionTitles.deleting,
    ambient: "absent",
    reason: "The as-written precondition requires an existing configurable fetch; this is not restoration coverage.",
    omitted: ["normal", "before precondition", "rejection", "host release", "installed fetch"],
  },
];

export function fixtureCases() {
  const cases = [];
  const add = (group, name, file, title, boundary = null, extra = {}) =>
    cases.push({ group, name: `${group}-${name}`, file, title, boundary, ambient: "native", ...extra });
  for (const ambient of ["native", "absent", "custom"]) {
    for (const [name, boundary] of [
      ["normal", null],
      ["rejection", rejected],
      ["host-release", released],
      ["installed-fetch", installed],
    ]) {
      add("closure", `rejecting-${ambient}-${name}`, composition, compositionTitles.rejecting, boundary, { ambient });
    }
    add("closure", `hook-only-${ambient}`, composition, compositionTitles.hookOnly, null, { ambient });
    if (ambient === "absent") continue;
    for (const [name, boundary] of [
      ["normal", null],
      ["before-deletion", message("fetch is deletable in this runtime")],
      ["rejection", rejected],
      ["host-release", released],
      ["installed-fetch", installed],
    ]) {
      add("closure", `deleting-${ambient}-${name}`, composition, compositionTitles.deleting, boundary, { ambient });
    }
  }
  const direct = (name, file, operation) => add("class", name, file, null, null, { direct: operation });
  direct("composition-environment", `${components}chat-window-composition.harness.mjs`, "composition-environment");
  direct("composition-host", `${components}chat-window-composition.harness.mjs`, "composition-host");
  direct("file-environment", `${components}chat-input-file-reference.harness.mjs`, "file-environment");
  const consumer = (name, file, title, boundary = first) => add("class", name, file, title, boundary);
  consumer(
    "composition-consumer-1-geometry",
    composition,
    "retained ChatWindow hides reading work while the runtime continues",
    message("no scrollIntoView while hidden"),
  );
  consumer(
    "composition-consumer-2-geometry",
    composition,
    "an active minimap drag and a pending follow frame are cancelled by hiding",
    message("dragging the viewport halfway across its travel scrolls halfway down"),
  );
  consumer(
    "composition-consumer-3",
    composition,
    "delayed element readiness attaches the viewport observer",
    message("the loading state has no scroll container"),
  );
  consumer("composition-ordered-consumer-4", composition, compositionTitles.rejecting, installed);
  consumer("composition-ordered-consumer-5", composition, compositionTitles.hookOnly, null);
  consumer("composition-deleting-consumer-6", composition, compositionTitles.deleting, installed);
  consumer(
    "file-reference-clipboard-descriptors",
    `${components}chat-input-file-reference.test.mjs`,
    "pasted clipboard images are staged and referenced as chips",
  );
  consumer(
    "file-reference-editor-geometry",
    `${components}chat-input-file-reference.test.mjs`,
    "typing a path then a space materializes it into a chip",
  );
  consumer(
    "file-reference-mock-timer",
    `${components}chat-input-file-reference.test.mjs`,
    "@ project file autocomplete completes into a chip and sends the literal token",
  );
  consumer(
    "visibility-clipboard-descriptors",
    `${components}chat-input-visibility.test.mjs`,
    "a file batch that crosses hide keeps every staged and local token",
    message("the first image is paused at the staging boundary"),
  );
  consumer(
    "visibility-Date-timer",
    `${components}chat-input-visibility.test.mjs`,
    "composition Enter and native IME key codes never submit before the grace window expires",
    message("an Enter reported by the IME must not submit"),
  );
  consumer(
    "focus-frame-environment-consumer",
    `${components}chat-input-focus-frame.test.mjs`,
    "hiding cancels a queued focus-return frame before it can run",
    message("the thinking control must be mounted"),
  );
  consumer(
    "skill-environment-consumer",
    `${components}chat-input-skill-reference.test.mjs`,
    "a picked skill becomes a chip at message start, serialized as /skill:name",
    message("the skill chip must be rendered"),
  );
  consumer(
    "migration-environment-consumer",
    `${components}chat-input-draft-migration.test.mjs`,
    "an initial v3 draft is materialized before the first edit",
    message("the stored draft must materialize on the initial mount"),
  );
  consumer(
    "tool-cards-environment",
    `${components}interactive-tools/tool-cards.test.mjs`,
    "hidden ordinary cards leave retained text and response delivery unchanged",
    message("a hidden card does not consume Enter"),
  );
  consumer(
    "tool-cards-mock-timer",
    `${components}interactive-tools/tool-cards.test.mjs`,
    "single selection advances one question and the last question waits for explicit submission",
  );
  consumer(
    "events-geometry",
    `${hooks}agent-session/use-session-events.test.mjs`,
    "a hidden external turn preserves visible away intent through mid-run and completion",
    message("hidden state must still receive runtime events"),
  );
  consumer(
    "events-mock-timer",
    `${hooks}agent-session/use-session-events.test.mjs`,
    "a late agent_end after the reconcile finish must not trigger completion twice",
  );
  consumer(
    "history-request-frame",
    `${hooks}agent-session/use-session-history.test.mjs`,
    "loading older history prepends and preserves the reading offset",
    message("page prepended"),
  );
  consumer(
    "history-cancel-frame",
    `${hooks}agent-session/use-session-history.test.mjs`,
    "a queued history frame cannot mutate a surface after unmount",
    message("a late frame cannot write after unmount"),
  );
  consumer(
    "history-geometry",
    `${hooks}agent-session/use-session-history.test.mjs`,
    "history pagination keeps data while hide cancels visual anchor compensation",
    message("a page completing after hide schedules no hidden compensation"),
  );
  consumer(
    "history-visual-DOM-frame-consumer-1",
    `${hooks}agent-session/use-session-history-visuals.test.mjs`,
    "history visual scheduling survives StrictMode effect replay",
    message("the valid post-replay anchor must be restored"),
  );
  consumer(
    "history-visual-DOM-frame-consumer-3",
    `${hooks}agent-session/use-session-history-visuals.test.mjs`,
    "history restoration attributes hidden growth to the stable content anchor",
    message("hidden history completion must not queue a visual frame"),
  );
  consumer(
    "height-DOM-prototype",
    `${hooks}useObservedElementHeight.test.mjs`,
    "a later-mounted visible element responds to size changes without accepting removed-element notifications",
    message("the visible element publishes its changed height"),
  );
  consumer(
    "draft-localStorage-stage",
    "src/renderer/lib/draft-persistence.test.mjs",
    "staging changes memory without replacing storage until an explicit flush",
  );
  consumer(
    "draft-localStorage-tombstone",
    "src/renderer/lib/draft-persistence.test.mjs",
    "an in-memory empty draft hides stale saved text before its pending removal",
  );
  return cases;
}
