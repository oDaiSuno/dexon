import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";
const { ToolCardDock, InteractiveToolStore } = await importTestBundle("tool-cards", {
  packages: "external",
  tsconfig: "tsconfig.renderer.json",
  loader: { ".css": "empty" },
  stdin: {
    contents:
      'export {ToolCardDock} from "./src/renderer/components/interactive-tools/tool-card-dock"; export {InteractiveToolStore} from "./src/renderer/lib/interactive-tool-store";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  plugins: [
    {
      name: "card-i18n",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "card-test" }));
        build.onLoad({ filter: /.*/, namespace: "card-test" }, () => ({
          contents: "export const useI18n = () => ({t: (key, fallback) => fallback});",
        }));
      },
    },
  ],
});
const question = (multiSelect = false) => ({
  question: "Which option?",
  header: "Options",
  multiSelect,
  options: [
    {
      label: "First",
      description: "Full first explanation",
      preview: "<script>no execution</script>\n" + "code\n".repeat(180),
    },
    { label: "Second", description: "Full second explanation" },
  ],
});
function request(method = "questionnaire", questions = [question()]) {
  return {
    type: "extension_ui_request",
    id: "q",
    method,
    questions,
    title: "Ordinary question",
    options: ["First", "Second"],
    prefill: "existing text",
    lines: ["custom frame"],
    message: "Please explicitly decide",
  };
}
async function harness(t, req = request(), send) {
  const globals = ["IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame"];
  const previous = globals.map((n) => Object.getOwnPropertyDescriptor(globalThis, n));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = () => 0;
  const commands = [];
  const store = new InteractiveToolStore("session", async (_, command) => {
    commands.push(command);
    return send ? send(command) : { id: command.id, status: "cancelled" in command ? "cancelled" : "submitted" };
  });
  store.reconcile({ runtimeId: "runtime", revision: 1, requests: [req], completed: [] });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(createElement(ToolCardDock, { store }));
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    globals.forEach((n, i) => (previous[i] ? Object.defineProperty(globalThis, n, previous[i]) : delete globalThis[n]));
  });
  const text = (node) => node.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
  return {
    store,
    commands,
    renderer,
    get root() {
      return renderer.root;
    },
    get entry() {
      return store.getSnapshot().entries[0];
    },
    button: (label) =>
      renderer.root.findAllByType("button").find((b) => b.props["aria-label"] === label || text(b) === label),
    async click(label) {
      const b = this.button(label);
      assert.ok(b, `button ${label}`);
      assert.ok(!b.props.disabled, `${label} is enabled`);
      await act(async () => b.props.onClick());
    },
    async choose(index = 0) {
      await act(async () => renderer.root.findAllByType("input")[index].props.onChange());
    },
    async type(textValue) {
      await act(async () => renderer.root.findByType("textarea").props.onChange({ target: { value: textValue } }));
    },
  };
}

test("question card Close and Escape collapse three times without responding", async (t) => {
  const h = await harness(t);
  await h.type("kept answer");
  for (let i = 0; i < 3; i++) {
    await h.click("Collapse and keep answers");
    assert.equal(h.root.findAllByType("textarea").length, 0);
    const resume = h.root.findByProps({ className: "tool-resume" });
    await act(async () => resume.props.onClick());
    assert.equal(h.root.findByType("textarea").props.value, "kept answer");
    let stopped = 0;
    await act(async () =>
      h.root.findByType("section").props.onKeyDownCapture({
        key: "Escape",
        nativeEvent: {},
        preventDefault() {},
        stopPropagation() {
          stopped++;
        },
      }),
    );
    assert.equal(stopped, 1);
    assert.equal(h.entry.draft.collapsed, true);
    await act(async () => h.root.findByProps({ className: "tool-resume" }).props.onClick());
  }
  assert.deepEqual(h.commands, []);
});

test("single selection advances once, last question waits for manual submit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await harness(t, request("questionnaire", [question(), question(), question(), question()]));
  await h.choose();
  await h.choose(1);
  await act(async () => t.mock.timers.tick(150));
  assert.equal(h.entry.draft.questionIndex, 1);
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(h.entry.draft.questionIndex, 1);
  await h.click("Next question");
  await h.click("Next question");
  await h.choose();
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(h.entry.draft.questionIndex, 3);
  assert.deepEqual(h.commands, []);
  await h.click("Previous question");
  await h.type("later changed");
  assert.deepEqual(h.entry.draft.answers[0].selected, [1]);
  await h.click("Send answered questions");
  assert.equal(h.commands.length, 1);
});

for (const action of ["collapse", "navigate", "text", "unmount"])
  test(`pending automatic advance is cancelled by ${action}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = await harness(t, request("questionnaire", [question(), question()]));
    await h.choose();
    if (action === "collapse") await h.click("Collapse and keep answers");
    if (action === "navigate") {
      await h.click("Next question");
      await h.click("Previous question");
    }
    if (action === "text") await h.type("custom replaces option");
    if (action === "unmount") await act(async () => h.renderer.unmount());
    await act(async () => t.mock.timers.tick(1000));
    assert.equal(h.entry.draft.questionIndex, 0);
    assert.equal(h.commands.length, 0);
  });

test("multi choice includes two selected labels and the unmodified supplemental text", async (t) => {
  const h = await harness(t, request("questionnaire", [question(true)]));
  await h.choose();
  await h.choose(1);
  await h.type("  multiline\nnotes  ");
  await h.click("Send answers");
  assert.deepEqual(h.commands[0].answers, [{ selected: [0, 1], text: "  multiline\nnotes  " }]);
});

test("multi choice permits only custom text", async (t) => {
  const h = await harness(t, request("questionnaire", [question(true)]));
  await h.type("text only");
  await h.click("Send answers");
  assert.deepEqual(h.commands[0].answers, [{ selected: [], text: "text only" }]);
});

test("single custom text and options are mutually exclusive", async (t) => {
  const h = await harness(t);
  await h.choose();
  await h.type("custom");
  assert.deepEqual(h.entry.draft.answers[0], { selected: [], text: "custom" });
  await h.choose(1);
  assert.deepEqual(h.entry.draft.answers[0], { selected: [1], text: "" });
});

test("skip is local, partial submit includes explicit empty slots, all empty cannot submit", async (t) => {
  const h = await harness(t, request("questionnaire", [question(), question()]));
  assert.equal(h.button("Send answered questions").props.disabled, true);
  await h.click("Skip for now");
  assert.equal(h.entry.draft.questionIndex, 1);
  assert.equal(h.commands.length, 0);
  await h.type("one answered");
  await h.click("Send answered questions");
  assert.deepEqual(h.commands[0].answers[0], { selected: [], text: "" });
});

test("preview renders the full source inertly without selecting or submitting", async (t) => {
  const h = await harness(t);
  const preview = h.root.findByType("pre");
  assert.ok(preview.children.join("").length > 600);
  assert.ok(preview.children.join("").includes("<script>no execution</script>"));
  await act(async () => h.root.findByType("details").props.onToggle());
  assert.deepEqual(h.entry.draft.answers, [{ selected: [], text: "" }]);
  assert.equal(h.commands.length, 0);
});

test("abandonment is confirmed inside the card and never sends drafts", async (t) => {
  const h = await harness(t);
  await h.type("not to be sent");
  await h.click("Abandon this answer");
  assert.equal(h.commands.length, 0);
  assert.equal(h.root.findAll((n) => n.props["aria-modal"]).length, 0);
  await h.click("Keep answering");
  assert.equal(h.entry.draft.answers[0].text, "not to be sent");
  await h.click("Abandon this answer");
  await h.click("Abandon without sending");
  assert.deepEqual(h.commands[0], { type: "extension_ui_response", id: "q", cancelled: true });
  assert.equal(h.entry.status, "cancelled");
});

for (const method of ["select", "input", "editor", "confirm", "custom"])
  test(`${method} uses the real non-modal card and preserves its return meaning`, async (t) => {
    const h = await harness(t, request(method));
    assert.equal(h.root.findAll((n) => n.props["aria-modal"]).length, 0);
    if (method === "select") {
      await h.choose(1);
      await h.click("Send answer");
      assert.equal(h.commands[0].value, "Second");
    }
    if (method === "input") {
      await h.click("Send answer");
      assert.equal(h.commands[0].value, "");
    }
    if (method === "editor") {
      assert.equal(h.root.findByType("textarea").props.value, "existing text");
      await h.click("Send answer");
      assert.equal(h.commands[0].value, "existing text");
    }
    if (method === "confirm") {
      await h.click("Decline");
      assert.equal(h.commands[0].confirmed, false);
    }
    if (method === "custom") {
      await h.click("Collapse and keep answers");
      assert.equal(h.commands.length, 0);
      await act(async () => h.root.findByProps({ className: "tool-resume" }).props.onClick());
      await act(async () =>
        h.root
          .findByType("pre")
          .props.onKeyDown({ key: "ArrowDown", nativeEvent: {}, preventDefault() {}, stopPropagation() {} }),
      );
      assert.equal(h.commands[0].data, "\x1b[B");
    }
  });

test("input-method Enter does not submit an ordinary text input", async (t) => {
  const h = await harness(t, request("input"));
  await act(async () =>
    h.root.findByType("input").props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true }, keyCode: 229 }),
  );
  assert.equal(h.commands.length, 0);
});

test("failed submission shows a retryable error and no restart execution button", async (t) => {
  let attempts = 0;
  const h = await harness(t, request(), (c) => {
    if (++attempts === 1) throw new Error("offline");
    return { id: c.id, status: "submitted" };
  });
  await h.type("saved");
  await h.click("Send answers");
  assert.equal(h.entry.status, "failed");
  assert.match(JSON.stringify(h.renderer.toJSON()), /Delivery failed/);
  assert.equal(h.root.findByType("textarea").props.value, "saved");
  await h.click("Send answers");
  assert.equal(h.entry.status, "submitted");
  assert.equal(h.button("Send answers"), undefined);
});

test("custom panel Tab remains available without trapping keyboard focus", async (t) => {
  const h = await harness(t, request("custom"));
  let prevented = false;
  await act(async () =>
    h.root.findByType("pre").props.onKeyDown({
      key: "Tab",
      nativeEvent: {},
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
    }),
  );
  assert.equal(prevented, false);
  assert.equal(h.commands.length, 0);
  await h.click("Send Tab to panel");
  assert.equal(h.commands[0].data, "\t");
});
