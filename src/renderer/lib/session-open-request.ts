type OpenSessionListener = (sessionId: string) => void;

// Any component may ask to open another session; the shell owns what opening
// means (leave guard, selected session, URL), exactly as it does for a deep
// link from outside the window.

const listeners = new Set<OpenSessionListener>();

export function requestOpenSession(sessionId: string): void {
  for (const listener of [...listeners]) listener(sessionId);
}

export function subscribeOpenSessionRequests(listener: OpenSessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
