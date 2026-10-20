import { act, dom, loadRenderer, mount, observeIntersections } from "./renderer.mjs";
import { installApiHostBridge } from "./api-host.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "session-reading-scene",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);

export async function settleUntil(check, { passes = 40 } = {}) {
  let lastError;
  for (let pass = 0; pass < passes; pass += 1) {
    try {
      return check();
    } catch (error) {
      lastError = error;
    }
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
  throw lastError;
}

export async function openConversation(t, { host, props = {} }) {
  const observers = observeIntersections(t);
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
  let currentProps = {
    newSessionCwd: null,
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
    ...props,
  };
  view = await mount(t, ChatWindow, currentProps);
  return {
    view,
    host,
    observers,
    async rerender(overrides) {
      currentProps = { ...currentProps, ...overrides };
      await view.update(currentProps);
    },
    async signalInView(target, isIntersecting = true) {
      await act(async () => observers.intersect(target, isIntersecting));
    },
    settle: (check, options) => settleUntil(check, options),
  };
}
