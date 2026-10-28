import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, allByRole } from "../support/dom-queries.mjs";
import { act, byRole, click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import {
  createSessionDetail,
  createSessionTestHost,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "session-thinking-level",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const PROVIDER = "held-fixture";
const ALPHA = { id: "held-model", name: "Held Alpha" };
const BETA = { id: "held-model-b", name: "Held Beta" };
const PLAIN = { id: "held-model-plain", name: "Held Plain" };

const ALPHA_LEVEL = "high";
const BETA_LEVEL = "max";
const RELOADED_ALPHA_LEVEL = "low";

const PROJECT_WITH_OWN_SETTINGS = "/project-with-own-settings";
const OWN_SETTINGS_LEVEL = "low";

const FRESH_SESSION = "fresh-session";

const ALPHA_LEVELS = ["off", "minimal", "low", "medium", "high"];
const BETA_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const PLAIN_LEVELS = ["off"];

const REASONING_CONTROL = /^Change reasoning level/;

function keyFor(provider, modelId) {
  return `${provider}:${modelId}`;
}

function keyOf(model) {
  return keyFor(PROVIDER, model.id);
}

function modelsReply(effective = {}) {
  const levels = { [keyOf(ALPHA)]: ALPHA_LEVEL, [keyOf(BETA)]: BETA_LEVEL, ...effective };
  return {
    models: [
      { id: ALPHA.id, name: ALPHA.name, provider: PROVIDER },
      { id: BETA.id, name: BETA.name, provider: PROVIDER },
    ],
    defaultModel: { provider: PROVIDER, modelId: ALPHA.id },
    thinkingLevels: { [keyOf(ALPHA)]: ALPHA_LEVELS, [keyOf(BETA)]: BETA_LEVELS },
    thinkingLevelMaps: { [keyOf(BETA)]: { xhigh: "xhigh", max: "max" } },
    nameMap: { [keyOf(ALPHA)]: ALPHA.name, [keyOf(BETA)]: BETA.name },
    effectiveThinkingLevels: levels,
    catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
  };
}

function plainReply() {
  const announced = modelsReply();
  return {
    ...announced,
    models: [...announced.models, { id: PLAIN.id, name: PLAIN.name, provider: PROVIDER }],
    defaultModel: { provider: PROVIDER, modelId: PLAIN.id },
    thinkingLevels: { ...announced.thinkingLevels, [keyOf(PLAIN)]: PLAIN_LEVELS },
    effectiveThinkingLevels: { ...announced.effectiveThinkingLevels, [keyOf(PLAIN)]: "off" },
    nameMap: { ...announced.nameMap, [keyOf(PLAIN)]: PLAIN.name },
  };
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function waitFor(check) {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      return check();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
  }
}

function reasoningControl(view) {
  const controls = allByRole(view.container, "button").filter((node) => REASONING_CONTROL.test(accessibleName(node)));
  assert.equal(controls.length, 1, "the chat offers exactly one reasoning level control");
  return controls[0];
}

function shownLevel(view) {
  const label = accessibleName(reasoningControl(view));
  const match = /^Change reasoning level: (.+)$/.exec(label);
  assert.ok(match, `the reasoning level control names a level, but reads “${label}”`);
  return match[1];
}

function levelOptions(view) {
  const menu = byRole(view.container, "menu", "Change reasoning level");
  assert.ok(menu, "the reasoning level control opens a menu");
  return allByRole(menu, "menuitemradio");
}

async function openLevels(view) {
  await click(reasoningControl(view));
  await settle();
  return levelOptions(view);
}

function menuHelpTexts(view) {
  const menu = byRole(view.container, "menu", "Change reasoning level");
  assert.ok(menu, "the reasoning level control opens a menu");
  const texts = allByRole(menu, "img").map(accessibleName);
  assert.ok(texts.length > 0, "the reasoning menu explains itself with a help text");
  return texts;
}

async function pickLevel(view, label) {
  const options = await openLevels(view);
  const option = options.find((node) => accessibleName(node) === label);
  assert.ok(
    option,
    `the reasoning menu offers ${label}, but offers ${options.map(accessibleName).join(", ") || "nothing"}`,
  );
  await click(option);
  await settle();
}

function modelChip(view, name) {
  return byRole(view.container, "button", name);
}

async function pickModel(view, currentName, name) {
  const chip = modelChip(view, currentName);
  assert.ok(chip, "the chat names the model it will answer on");
  await click(chip);
  await settle();
  const dialog = byRole(dom.window.document.body, "dialog", "Models");
  assert.ok(dialog, "the model chip opens the model list");
  const group = byRole(dialog, "group", PROVIDER);
  assert.ok(group, "the model list groups models by where they come from");
  const row = byRole(group, "button", name);
  assert.ok(row, `the model list offers ${name}`);
  await click(row);
  await settle();
}

async function typeComposer(view, value) {
  const box = byRole(view.container, "textbox");
  assert.ok(box, "the chat offers a place to write a message");
  await act(async () => {
    box.focus();
    box.textContent = value;
    const range = dom.window.document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    box.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  await settle();
}

async function sendMessage(view, value) {
  await typeComposer(view, value);
  await click(byRole(view.container, "button", "Send"));
}

function sessionAtFirstPrompt(requests, realLevels) {
  const created = { provider: PROVIDER, modelId: ALPHA.id };
  let level = realLevels[keyFor(created.provider, created.modelId)] ?? null;
  for (const request of requests) {
    if (request.kind === "new-session") {
      created.provider = request.params.provider ?? created.provider;
      created.modelId = request.params.modelId ?? created.modelId;
      level = request.params.thinkingLevel ?? realLevels[keyFor(created.provider, created.modelId)] ?? null;
      continue;
    }
    if (request.payload.type === "set_thinking_level") {
      level = request.payload.level;
      continue;
    }
    if (request.payload.type === "set_model") {
      created.provider = request.payload.provider;
      created.modelId = request.payload.modelId;
      level = request.reply?.thinkingLevel ?? realLevels[keyFor(created.provider, created.modelId)] ?? null;
      continue;
    }
    if (request.payload.type === "prompt") return { ...created, level };
  }
  return { ...created, level };
}

function askedPrompts(requests) {
  return requests.filter((request) => request.kind === "command" && request.payload.type === "prompt").length;
}

async function emit(host, event) {
  await act(async () => {
    for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
  });
  await settle();
}

function announcedReply(cwd, effective) {
  return modelsReply(
    cwd === PROJECT_WITH_OWN_SETTINGS ? { ...effective, [keyOf(ALPHA)]: OWN_SETTINGS_LEVEL } : effective,
  );
}

async function mountScene(
  t,
  {
    session = null,
    newSessionCwd = "/fixture",
    effective,
    hostLevels = {},
    models = (cwd) => announcedReply(cwd, effective),
  } = {},
) {
  const requests = [];
  const listed = [];
  let refreshed = null;
  const announced = models(newSessionCwd);
  const realLevels = { ...announced.effectiveThinkingLevels, ...hostLevels };
  const hosted = (provider, modelId) => realLevels[keyFor(provider, modelId)] ?? null;
  const seeded = session
    ? { provider: session.options.model?.provider ?? PROVIDER, modelId: session.options.model?.modelId ?? ALPHA.id }
    : (announced.defaultModel ?? { provider: PROVIDER, modelId: ALPHA.id });
  const live = {
    provider: seeded.provider,
    modelId: seeded.modelId,
    level: session?.options.thinkingLevel ?? hosted(seeded.provider, seeded.modelId),
  };
  const enterModel = (provider, modelId) => {
    live.provider = provider;
    live.modelId = modelId;
    return hosted(provider, modelId);
  };
  const detailFor = (id, options) => {
    const model = { provider: live.provider, modelId: live.modelId };
    return createSessionDetail(id, {
      ...options,
      model,
      thinkingLevel: live.level,
      agentState: {
        running: false,
        ...options.agentState,
        state: { ...options.agentState?.state, model, thinkingLevel: live.level },
      },
    });
  };
  const current = () =>
    session ? detailFor(session.id, session.options) : detailFor(FRESH_SESSION, { cwd: newSessionCwd, messages: [] });
  const host = createSessionTestHost({
    listModels: async (cwd) => {
      const reply = refreshed ?? models(cwd);
      listed.push(reply);
      return reply;
    },
    getSession: async () => current(),
    agentState: async () => current().agentState,
    newAgent: async (params) => {
      requests.push({ kind: "new-session", params });
      const hostedLevel = enterModel(params.provider ?? live.provider, params.modelId ?? live.modelId);
      live.level = params.thinkingLevel ?? hostedLevel;
      return { sessionId: FRESH_SESSION, data: null };
    },
    sendAgentCommand: async (sid, payload) => {
      let reply = {};
      if (payload.type === "set_model") {
        reply = {
          id: payload.modelId,
          provider: payload.provider,
          thinkingLevel: enterModel(payload.provider, payload.modelId),
        };
        live.level = reply.thinkingLevel;
      } else if (payload.type === "set_thinking_level") {
        live.level = payload.level;
      }
      requests.push({ kind: "command", payload, reply });
      return reply;
    },
  });
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  const props = {
    session: session ? current().info : null,
    newSessionCwd,
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  };
  view = await mount(t, ChatWindow, props);
  await settle();
  return {
    view,
    host,
    requests,
    props,
    listCount: () => listed.length,
    sessionAtFirstPrompt: () => sessionAtFirstPrompt(requests, realLevels),
    reload(reply) {
      refreshed = reply;
      return view.update({ ...props, modelsRefreshKey: 1 });
    },
  };
}

test("a new conversation names the reasoning level its model would use, and the first turn really uses that level", async (t) => {
  const scene = await mountScene(t);
  assert.deepEqual(
    scene.requests.filter((request) => request.kind === "new-session"),
    [],
    "opening the page for a new conversation does not start one",
  );
  assert.equal(
    shownLevel(scene.view),
    "High",
    "before anything is typed, the reasoning level control names the level the chosen model reasons at",
  );
  assert.equal(
    reasoningControl(scene.view).getAttribute("title"),
    "Change reasoning level: High",
    "the tooltip of the control names the same level as the control itself",
  );

  await sendMessage(scene.view, "Draft the quarterly summary");
  await waitFor(() => assert.equal(askedPrompts(scene.requests), 1, "the first message reached the agent"));
  assert.equal(
    scene.sessionAtFirstPrompt().level,
    ALPHA_LEVEL,
    "the first turn asked the agent to reason at the level the model reasons at by default",
  );
  assert.equal(
    scene.sessionAtFirstPrompt().level,
    shownLevel(scene.view).toLowerCase(),
    "the first turn asked the agent to reason at exactly the level the control shows",
  );

  await emit(scene.host, { type: "agent_end" });
  assert.equal(shownLevel(scene.view), "High", "after the answer the control still names the level the agent used");
});

test("the reasoning menu offers no automatic choice, neither in a new conversation nor in an open one", async (t) => {
  const fresh = await mountScene(t);
  const freshOptions = (await openLevels(fresh.view)).map(accessibleName);
  assert.deepEqual(
    freshOptions.filter((label) => /auto/i.test(label)),
    [],
    `a new conversation offers no automatic reasoning level, but the menu offers ${freshOptions.join(", ")}`,
  );
  assert.doesNotMatch(
    accessibleName(reasoningControl(fresh.view)),
    /auto/i,
    "the reasoning level control never reads as an automatic choice",
  );
  assert.deepEqual(
    freshOptions,
    ["Off", "Minimal", "Low", "Medium", "High"],
    "the menu offers exactly the levels this model can reason at, from least to most effort",
  );
  const freshHelp = menuHelpTexts(fresh.view);
  assert.deepEqual(
    freshHelp.filter((text) => /auto/i.test(text)),
    [],
    `a new conversation never explains an automatic choice, but its menu help reads ${freshHelp.join(", ")}`,
  );

  const open = await mountScene(t, { session: { id: "open-session", options: { thinkingLevel: "low" } } });
  const openOptions = (await openLevels(open.view)).map(accessibleName);
  assert.deepEqual(
    openOptions.filter((label) => /auto/i.test(label)),
    [],
    `an open conversation offers no automatic reasoning level, but the menu offers ${openOptions.join(", ")}`,
  );
  assert.doesNotMatch(
    accessibleName(reasoningControl(open.view)),
    /auto/i,
    "the reasoning level control of an open conversation never reads as an automatic choice",
  );
  const openHelp = menuHelpTexts(open.view);
  assert.deepEqual(
    openHelp.filter((text) => /auto/i.test(text)),
    [],
    `an open conversation never explains an automatic choice, but its menu help reads ${openHelp.join(", ")}`,
  );
});

test("a new conversation whose model cannot reason names the reasoning level as off", async (t) => {
  const scene = await mountScene(t, { models: plainReply });
  assert.equal(
    shownLevel(scene.view),
    "Off",
    "before anything is typed, a model that cannot reason shows its reasoning level as off",
  );
});

test("a level chosen by hand gives way to the level the next model reasons at, and the first turn uses that level", async (t) => {
  const scene = await mountScene(t);
  await pickLevel(scene.view, "Low");
  assert.equal(shownLevel(scene.view), "Low", "the reasoning level control follows the level the reader chose");

  await pickModel(scene.view, ALPHA.name, BETA.name);
  await waitFor(() =>
    assert.equal(
      shownLevel(scene.view),
      "Max",
      "picking another model replaces the level chosen by hand with the level that model reasons at",
    ),
  );

  await sendMessage(scene.view, "Compare the two drafts");
  await waitFor(() => assert.equal(askedPrompts(scene.requests), 1, "the first message reached the agent"));
  assert.deepEqual(
    { provider: scene.sessionAtFirstPrompt().provider, modelId: scene.sessionAtFirstPrompt().modelId },
    { provider: PROVIDER, modelId: BETA.id },
    "the first turn ran on the model the reader picked",
  );
  assert.equal(
    scene.sessionAtFirstPrompt().level,
    BETA_LEVEL,
    "the first turn asked the agent to reason at the level the control shows, not the level chosen by hand",
  );
});

test("a level chosen by hand is the level the first turn uses and survives the answer", async (t) => {
  const scene = await mountScene(t);
  await pickLevel(scene.view, "Low");

  await sendMessage(scene.view, "Summarise the last release");
  await waitFor(() => assert.equal(askedPrompts(scene.requests), 1, "the first message reached the agent"));
  assert.equal(scene.sessionAtFirstPrompt().level, "low", "the first turn asked the agent to reason low");

  await emit(scene.host, { type: "agent_end" });
  assert.equal(shownLevel(scene.view), "Low", "after the answer the control still names the level chosen by hand");
});

test("after the reader picks another model in an open conversation, the reasoning level control names the new level at once", async (t) => {
  const scene = await mountScene(t, {
    effective: { [keyOf(BETA)]: "xhigh" },
    hostLevels: { [keyOf(BETA)]: BETA_LEVEL },
    session: {
      id: "open-session",
      options: {
        model: { provider: PROVIDER, modelId: ALPHA.id },
        thinkingLevel: "low",
        agentState: { running: true },
      },
    },
  });
  assert.equal(shownLevel(scene.view), "Low", "the open conversation names the level it is reasoning at");

  await pickModel(scene.view, ALPHA.name, BETA.name);
  await waitFor(() =>
    assert.equal(
      shownLevel(scene.view),
      "Max",
      "the control names the level the switch reported, not the level the model list announced for that model",
    ),
  );
});

test("when the announced level of a model is out of date, a new conversation follows the level the session reports once it exists", async (t) => {
  const scene = await mountScene(t, { hostLevels: { [keyOf(ALPHA)]: RELOADED_ALPHA_LEVEL } });
  assert.equal(
    shownLevel(scene.view),
    "High",
    "the control starts on the level the model list announced for the model",
  );

  await sendMessage(scene.view, "Draft the quarterly summary");
  await waitFor(() => assert.equal(askedPrompts(scene.requests), 1, "the first message reached the agent"));
  assert.equal(
    scene.sessionAtFirstPrompt().level,
    RELOADED_ALPHA_LEVEL,
    "the first turn asked the agent to reason at the level the settings really hold, not the announced one",
  );

  await emit(scene.host, { type: "agent_end" });
  assert.equal(
    shownLevel(scene.view),
    "Low",
    "once the conversation exists, the control names the level the conversation really reports",
  );
});

test("when the folder keeps its own level in its settings, a new conversation there names that level", async (t) => {
  const scene = await mountScene(t, { newSessionCwd: PROJECT_WITH_OWN_SETTINGS });
  assert.equal(
    shownLevel(scene.view),
    "Low",
    "the control names the level the folder's own settings give the model, not the shared default",
  );
});

test("when the settings change while nobody chose a level, a new conversation follows the announced level", async (t) => {
  const scene = await mountScene(t);
  assert.equal(shownLevel(scene.view), "High", "the control starts on the announced level of the chosen model");
  const listingsBefore = scene.listCount();

  await scene.reload(modelsReply({ [keyOf(ALPHA)]: RELOADED_ALPHA_LEVEL }));
  await waitFor(() =>
    assert.ok(
      scene.listCount() > listingsBefore,
      "the app asks the host for the models again after the settings change",
    ),
  );
  await waitFor(() =>
    assert.equal(
      shownLevel(scene.view),
      "Low",
      "after the settings change the control follows the newly announced level of the chosen model",
    ),
  );
});

test("when the settings change after a level was chosen by hand, a new conversation keeps the chosen level", async (t) => {
  const scene = await mountScene(t);
  await pickLevel(scene.view, "Minimal");
  assert.equal(shownLevel(scene.view), "Minimal", "the control follows the level chosen by hand");
  const listingsBefore = scene.listCount();

  await scene.reload(modelsReply({ [keyOf(ALPHA)]: RELOADED_ALPHA_LEVEL }));
  await waitFor(() =>
    assert.ok(
      scene.listCount() > listingsBefore,
      "the app asks the host for the models again after the settings change",
    ),
  );
  await settle();
  assert.equal(
    shownLevel(scene.view),
    "Minimal",
    "a level chosen by hand survives the settings change that would otherwise announce another level",
  );
});
