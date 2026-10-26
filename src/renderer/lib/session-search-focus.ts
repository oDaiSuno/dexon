type FocusListener = () => void;

const listeners = new Set<FocusListener>();
let pending = false;

export function requestSessionSearchFocus(): void {
  if (listeners.size === 0) {
    pending = true;
    return;
  }
  for (const listener of [...listeners]) listener();
}

export function subscribeSessionSearchFocus(listener: FocusListener): () => void {
  listeners.add(listener);
  if (pending) {
    pending = false;
    listener();
  }
  return () => {
    listeners.delete(listener);
  };
}
