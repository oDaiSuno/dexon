type RequestListener = () => void;

const listeners = new Set<RequestListener>();

export function requestModelSettings(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeModelSettingsRequest(listener: RequestListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
