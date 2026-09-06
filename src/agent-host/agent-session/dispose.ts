import type { AgentSessionLike } from "../../shared/pi-types";
export function disposeSession(
  inner: AgentSessionLike,
  abort: boolean,
  reason: string,
  timeoutMs: number,
): Promise<void> {
  return (async () => {
    const teardown = async () => {
      if (abort) {
        try {
          await inner.abort();
        } catch (error) {
          console.warn(
            `[dexon] session abort failed during ${reason} for ${inner.sessionId}: ${error instanceof Error ? error.name : "UnknownError"}`,
          );
        }
      }
      const agent = inner.agent as { waitForIdle?: () => Promise<void>; dispose?: () => void | Promise<void> };
      try {
        await agent.waitForIdle?.();
      } catch (error) {
        console.warn(
          `[dexon] session waitForIdle failed during ${reason} for ${inner.sessionId}: ${error instanceof Error ? error.name : "UnknownError"}`,
        );
      }
      try {
        await agent.dispose?.();
      } catch (error) {
        console.warn(
          `[dexon] session dispose failed during ${reason} for ${inner.sessionId}: ${error instanceof Error ? error.name : "UnknownError"}`,
        );
      }
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        teardown(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            console.warn(`[dexon] session teardown timed out after ${timeoutMs}ms during ${reason}`);
            resolve();
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  })();
}
