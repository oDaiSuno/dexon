type OpenSessionListener = (sessionId: string) => void;

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
