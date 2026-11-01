import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

export const SESSION_ID = "s-sync";
export const MODEL_A = { provider: "fixture", modelId: "model-a" };
export const MODEL_B = { provider: "fixture", modelId: "model-b" };
export const MODEL_C = { provider: "fixture", modelId: "model-c" };

export function createHeldCalls() {
  const calls = [];
  const open = new Set();
  return {
    calls,
    hold(args) {
      return new Promise((resolve, reject) => {
        const call = {
          args,
          resolve(value) {
            open.delete(call);
            resolve(value);
          },
          reject(error) {
            open.delete(call);
            reject(error);
          },
        };
        open.add(call);
        calls.push(call);
      });
    },
    drain(value) {
      for (const call of [...open]) call.resolve(value);
    },
  };
}

export function snapshot(options = {}) {
  return createSessionDetail(SESSION_ID, { model: MODEL_A, thinkingLevel: "off", ...options });
}

export function conversation(turns) {
  const messages = [];
  const entryIds = [];
  for (let turn = 1; turn <= turns; turn += 1) {
    messages.push({ role: "user", content: `question ${turn}`, timestamp: turn * 2 - 1 });
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: `answer ${turn}` }],
      provider: "fixture",
      model: "model-a",
      stopReason: "stop",
      timestamp: turn * 2,
    });
    entryIds.push(`u-${turn}`, `a-${turn}`);
  }
  return { messages, entryIds, historyRevision: `revision-${turns}`, messageCount: messages.length };
}

export async function mountHeldSession(t, { bundleName, heldCommands = [], hookOptions = {}, hostOverrides = {} }) {
  const reads = createHeldCalls();
  const commands = createHeldCalls();
  const host = createSessionTestHost({
    getSession: (...args) => reads.hold(args),
    agentState: async () => ({ running: false, state: {} }),
    sendAgentCommand: (sid, payload) => (heldCommands.includes(payload.type) ? commands.hold([sid, payload]) : {}),
    ...hostOverrides,
  });
  let h;
  t.after(async () => {
    if (!h) return;
    await settle(h, () => {
      commands.drain({});
      reads.drain(snapshot());
    });
  });
  h = await createSessionHookHarness(t, { bundleName, host });
  await h.mount({ session: snapshot().info, newSessionCwd: null, ...hookOptions });
  return { h, host, reads, commands };
}

export async function settle(h, action) {
  await h.act(async () => {
    await action();
  });
  await h.flush();
}

export async function announceSessionChanged(h) {
  await settle(h, () => {
    for (const onChange of h.host.changeSinks) onChange({ sessionId: SESSION_ID });
  });
}

export async function start(h, action) {
  let pending;
  await h.act(async () => {
    pending = action();
  });
  return { pending };
}
