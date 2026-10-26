type RequestListener = () => void;

const listeners = new Set<RequestListener>();
let pending = false;

export function requestProjectSwitcher(): void {
  if (listeners.size === 0) {
    pending = true;
    return;
  }
  for (const listener of [...listeners]) listener();
}

export function subscribeProjectSwitcherRequest(listener: RequestListener): () => void {
  listeners.add(listener);
  if (pending) {
    pending = false;
    listener();
  }
  return () => {
    listeners.delete(listener);
  };
}
