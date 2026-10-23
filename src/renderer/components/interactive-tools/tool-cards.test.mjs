import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  dom,
  act,
  click,
  input,
  keyDown,
  button,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../../../../tests/support/renderer.mjs";
import { installHostBridge } from "../../../../tests/support/host-bridge.mjs";

const { ToolCardDock, InteractiveToolStore, sendAgentCommand, resetRpc, setAppLanguage } = await loadRenderer(
  "tool-cards-dom",
  'export {ToolCardDock} from "./src/renderer/components/interactive-tools/tool-card-dock.tsx"; export {InteractiveToolStore} from "./src/renderer/lib/interactive-tool-store.ts"; export {sendAgentCommand} from "./src/renderer/lib/agent-client.ts";',
);
setAppLanguage("en-US");
after(restoreGlobals);

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

async function harness(t, req = request(), reply, visible = true) {
  const commands = [];
  const views = [];
  dom.window.sessionStorage.clear();
  resetRpc();
  const host = installHostBridge(dom.window, {
    call: async (method, params) => {
      // Even a rejected request counts as outbound delivery. Hidden controls
      // cannot look silent merely because their malformed command was rejected.
      commands.push(params?.command);
      assert.equal(method, "agent.command");
      assert.equal(params.sessionId, "session");
      assert.equal(params.command.id, req.id);
      assert.ok(["extension_ui_response", "extension_ui_input"].includes(params.command.type));
      if (reply) return reply(params.command);
      return { id: req.id, status: params.command.cancelled ? "cancelled" : "submitted" };
    },
  });
  let view;
  t.after(async () => {
    try {
      for (const mounted of views) await mounted.unmount();
    } finally {
      resetRpc();
      host.close();
      dom.window.sessionStorage.clear();
    }
  });
  const store = new InteractiveToolStore("session", sendAgentCommand, dom.window.sessionStorage);
  store.reconcile({ runtimeId: "runtime", revision: 1, requests: [req], completed: [] });
  const render = async () => {
    view = await mount(t, ToolCardDock, { store, visible });
    views.push(view);
  };
  await render();
  return {
    commands,
    get container() {
      return view.container;
    },
    get page() {
      return view.container
        .querySelector('nav[aria-label="Question navigation"] [aria-label]')
        ?.getAttribute("aria-label");
    },
    button: (label) => button(view.container, label),
    async click(label) {
      const control = button(view.container, label);
      assert.ok(control, `button ${label}`);
      assert.equal(control.disabled, false, `${label} is enabled`);
      await click(control);
    },
    choose: (index = 0) => click(view.container.querySelectorAll('input[type="radio"], input[type="checkbox"]')[index]),
    type: (value) => input(view.container.querySelector("textarea"), value),
    async resume() {
      await click(
        [...view.container.querySelectorAll("button")].find((control) =>
          control.textContent.includes("Continue answering"),
        ),
      );
    },
    async show() {
      visible = true;
      await view.update({ store, visible });
    },
    unmount: () => view.unmount(),
    remount: render,
  };
}

test("hidden ordinary cards leave retained text and response delivery unchanged", async (t) => {
  const h = await harness(t, request("input"), undefined, false);
  const field = h.container.querySelector("input");
  await input(field, "hidden");
  const enter = await keyDown(field, "Enter");
  assert.equal(enter.defaultPrevented, false, "a hidden card does not consume Enter");
  await h.click("Send answer");
  assert.deepEqual(h.commands, []);
  await h.show();
  assert.equal(h.container.querySelector("input").value, "");
});

test("hidden questionnaire controls leave the visible answers empty when shown again", async (t) => {
  const h = await harness(t, request(), undefined, false);
  await h.choose();
  await h.type("hidden note");
  await h.show();
  assert.ok([...h.container.querySelectorAll("input")].every((field) => !field.checked));
  assert.equal(h.container.querySelector("textarea").value, "");
  assert.deepEqual(h.commands, []);
});

test("hidden terminal controls do not consume keys or send panel input", async (t) => {
  const h = await harness(t, request("custom"), undefined, false);
  const key = await keyDown(h.container.querySelector('[role="textbox"]'), "a");
  assert.equal(key.defaultPrevented, false);
  await h.click("Send Tab to panel");
  assert.deepEqual(h.commands, []);
});

test("Close and Escape repeatedly collapse the card while retaining its answer without responding", async (t) => {
  const h = await harness(t);
  await h.type("kept answer");
  const outsideKeys = [];
  const onOutsideKey = (event) => outsideKeys.push(event.key);
  dom.window.document.body.addEventListener("keydown", onOutsideKey);
  t.after(() => dom.window.document.body.removeEventListener("keydown", onOutsideKey));
  for (let i = 0; i < 3; i++) {
    await h.click("Collapse — your answers stay");
    assert.equal(h.container.querySelector("textarea"), null);
    await h.resume();
    const field = h.container.querySelector("textarea");
    assert.equal(field.value, "kept answer");
    const escape = await keyDown(field, "Escape");
    assert.equal(escape.defaultPrevented, true);
    assert.deepEqual(outsideKeys, [], "Escape does not reach the surrounding page");
    assert.equal(h.container.querySelector("textarea"), null);
    await h.resume();
  }
  assert.deepEqual(h.commands, []);
});

test("single selection advances one question and the last question waits for explicit submission", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await harness(t, request("questionnaire", [question(), question(), question(), question()]));
  await h.choose();
  await h.choose(1);
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(h.page, "2 / 4");
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(h.page, "2 / 4");
  await h.click("Next question");
  await h.click("Next question");
  await h.choose();
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(h.page, "4 / 4");
  assert.deepEqual(h.commands, []);
  await h.click("Previous question");
  await h.type("later changed");
  await h.click("Previous question");
  await h.click("Previous question");
  assert.equal(h.container.querySelectorAll("input")[1].checked, true, "the first answer is retained");
  await h.click("Send answered questions");
  assert.deepEqual(h.commands, [
    {
      type: "extension_ui_response",
      id: "q",
      answers: [
        { selected: [1], text: "" },
        { selected: [], text: "" },
        { selected: [], text: "later changed" },
        { selected: [0], text: "" },
      ],
    },
  ]);
});

for (const action of ["collapse", "navigate", "text", "unmount"])
  test(`a pending advance is cancelled when the user performs ${action}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = await harness(t, request("questionnaire", [question(), question()]));
    await h.choose();
    if (action === "collapse") await h.click("Collapse — your answers stay");
    if (action === "navigate") {
      await h.click("Next question");
      await h.click("Previous question");
    }
    if (action === "text") await h.type("custom replaces option");
    if (action === "unmount") await h.unmount();
    await act(async () => t.mock.timers.tick(1000));
    if (action === "collapse") await h.resume();
    if (action === "unmount") await h.remount();
    assert.equal(h.page, "1 / 2");
    assert.deepEqual(h.commands, []);
  });

test("multiple selections deliver both labels and the unmodified supplemental text", async (t) => {
  const h = await harness(t, request("questionnaire", [question(true)]));
  await h.choose();
  await h.choose(1);
  await h.type("  multiline\nnotes  ");
  await h.click("Send answers");
  assert.deepEqual(h.commands[0].answers, [{ selected: [0, 1], text: "  multiline\nnotes  " }]);
});

test("a multi-choice question can be answered with custom text alone", async (t) => {
  const h = await harness(t, request("questionnaire", [question(true)]));
  await h.type("text only");
  await h.click("Send answers");
  assert.deepEqual(h.commands[0].answers, [{ selected: [], text: "text only" }]);
});

test("single-choice text and options replace each other rather than accumulating", async (t) => {
  const h = await harness(t);
  await h.choose();
  await h.type("custom");
  assert.ok([...h.container.querySelectorAll("input")].every((field) => !field.checked));
  assert.equal(h.container.querySelector("textarea").value, "custom");
  await h.choose(1);
  assert.equal(h.container.querySelectorAll("input")[1].checked, true);
  assert.equal(h.container.querySelector("textarea").value, "");
});

test("skipping stays local and partial submission includes explicit unanswered slots", async (t) => {
  const h = await harness(t, request("questionnaire", [question(), question()]));
  assert.equal(h.button("Send answered questions").disabled, true);
  await h.click("Skip for now");
  assert.equal(h.page, "2 / 2");
  assert.deepEqual(h.commands, []);
  await h.type("one answered");
  await h.click("Send answered questions");
  assert.deepEqual(h.commands[0].answers, [
    { selected: [], text: "" },
    { selected: [], text: "one answered" },
  ]);
});

test("opening the full preview exposes inert source without selecting or submitting", async (t) => {
  const h = await harness(t);
  assert.equal(h.container.querySelector("pre"), null);
  await h.click("Preview");
  const preview = h.container.querySelector("pre");
  assert.ok(preview.textContent.length > 600);
  assert.ok(preview.textContent.includes("<script>no execution</script>"));
  assert.equal(h.container.querySelector("script"), null);
  assert.ok([...h.container.querySelectorAll("input")].every((field) => !field.checked));
  assert.deepEqual(h.commands, []);
  await h.click("Hide preview");
  assert.equal(h.container.querySelector("pre"), null);
});

test("abandonment requires in-card confirmation and never sends the retained draft", async (t) => {
  const h = await harness(t);
  await h.type("not to be sent");
  await h.click("Abandon this answer");
  assert.deepEqual(h.commands, []);
  assert.equal(h.container.querySelector('[aria-modal="true"]'), null);
  await h.click("Keep answering");
  assert.equal(h.container.querySelector("textarea").value, "not to be sent");
  await h.click("Abandon this answer");
  await h.click("Abandon without sending");
  assert.deepEqual(h.commands, [{ type: "extension_ui_response", id: "q", cancelled: true }]);
  assert.match(h.container.textContent, /Answering abandoned/);
});

for (const method of ["select", "input", "editor", "confirm", "custom"])
  test(`${method} is answered through a non-modal card with its documented response meaning`, async (t) => {
    const h = await harness(t, request(method));
    assert.equal(h.container.querySelector('[aria-modal="true"]'), null);
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
      assert.equal(h.container.querySelector("textarea").value, "existing text");
      await h.click("Send answer");
      assert.equal(h.commands[0].value, "existing text");
    }
    if (method === "confirm") {
      await h.click("Decline");
      assert.equal(h.commands[0].confirmed, false);
    }
    if (method === "custom") {
      await h.click("Collapse — your answers stay");
      assert.deepEqual(h.commands, []);
      await h.resume();
      await keyDown(h.container.querySelector('[role="textbox"]'), "ArrowDown");
      assert.equal(h.commands[0].data, "\x1b[B");
    }
  });

test("Enter during composition does not submit an ordinary text input", async (t) => {
  const h = await harness(t, request("input"));
  await keyDown(h.container.querySelector("input"), "Enter", { isComposing: true, keyCode: 229 });
  assert.deepEqual(h.commands, []);
});

test("failed delivery retains the visible answer and permits a successful retry", async (t) => {
  let offline = true;
  const h = await harness(t, request(), (command) => {
    if (offline) throw new Error("offline");
    return { id: command.id, status: "submitted" };
  });
  await h.type("saved");
  await h.click("Send answers");
  assert.match(h.container.textContent, /Not delivered/);
  assert.equal(h.container.querySelector("textarea").value, "saved");
  assert.equal(h.button("Restart"), undefined);
  offline = false;
  await h.click("Send answers");
  assert.match(h.container.textContent, /Answers sent/);
  assert.equal(h.button("Send answers"), undefined);
});

test("a terminal leaves Tab available for focus navigation but can send it explicitly", async (t) => {
  const h = await harness(t, request("custom"));
  const tab = await keyDown(h.container.querySelector('[role="textbox"]'), "Tab");
  assert.equal(tab.defaultPrevented, false);
  assert.deepEqual(h.commands, []);
  await h.click("Send Tab to panel");
  assert.equal(h.commands[0].data, "\t");
});
