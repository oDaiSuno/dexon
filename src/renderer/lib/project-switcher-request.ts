export type ProjectSwitcherRequest = { mode?: "list" | "ssh" };
type RequestListener = (request: ProjectSwitcherRequest) => void;

const listeners = new Set<RequestListener>();
const revealListeners = new Set<() => void>();
let pending: ProjectSwitcherRequest | null = null;

export function requestProjectSwitcher(request: ProjectSwitcherRequest = {}): void {
  for (const reveal of [...revealListeners]) reveal();
  if (listeners.size === 0) {
    pending = request;
    return;
  }
  for (const listener of [...listeners]) listener(request);
}

export function subscribeProjectSwitcherRequest(listener: RequestListener): () => void {
  listeners.add(listener);
  if (pending) {
    const request = pending;
    pending = null;
    listener(request);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeProjectSwitcherReveal(listener: () => void): () => void {
  revealListeners.add(listener);
  return () => {
    revealListeners.delete(listener);
  };
}
