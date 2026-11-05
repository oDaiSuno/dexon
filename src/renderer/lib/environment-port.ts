import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";

type DeliveredPort = { port: MessagePort; generation?: number };
type PortRequest = {
  environmentId: EnvironmentId;
  generation?: number;
  resolve: (value: DeliveredPort) => void;
  cancel: () => void;
};

const brokers = new WeakMap<Window, ReturnType<typeof createPortBroker>>();

function createPortBroker(target: Window) {
  const requests = new Set<PortRequest>();
  const receive = (event: MessageEvent) => {
    if (event.source !== target) return;
    const data = event.data as { channel?: string; environmentId?: string; generation?: number } | string | null;
    if (data !== "dexon-host-port" && !(typeof data === "object" && data?.channel === "dexon-host-port")) return;
    const port = event.ports[0];
    if (!port) return;
    const environmentId =
      typeof data === "object" ? (data?.environmentId ?? PRIMARY_ENVIRONMENT_ID) : PRIMARY_ENVIRONMENT_ID;
    const generation = typeof data === "object" ? data?.generation : undefined;
    const request = [...requests].find(
      (entry) =>
        entry.environmentId === environmentId &&
        (entry.generation === undefined || generation === undefined || entry.generation === generation),
    );
    if (!request) {
      if (environmentId !== PRIMARY_ENVIRONMENT_ID) port.close();
      return;
    }
    request.cancel();
    request.resolve({ port, generation });
  };
  return { requests, receive };
}

export function requestEnvironmentPort(
  environmentId: EnvironmentId,
  signal?: AbortSignal,
  generation?: number,
): Promise<DeliveredPort> {
  return new Promise((resolve, reject) => {
    const target = typeof window === "undefined" ? undefined : window;
    const bridge = target?.piBridge;
    const requestPort =
      environmentId === PRIMARY_ENVIRONMENT_ID
        ? bridge?.requestHostPort?.bind(bridge)
        : bridge?.requestEnvironmentPort?.bind(bridge, environmentId);
    if (!target || !requestPort) {
      reject(new Error("Environment MessagePort is unavailable"));
      return;
    }
    if (signal?.aborted) {
      reject(new Error("Environment connection was cancelled"));
      return;
    }
    const broker = brokers.get(target) ?? createPortBroker(target);
    brokers.set(target, broker);
    const cancel = () => {
      clearTimeout(timer);
      broker.requests.delete(request);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cancel();
      reject(new Error("Environment connection was cancelled"));
    };
    const timer = setTimeout(() => {
      cancel();
      reject(new Error("Timed out waiting for environment MessagePort"));
    }, 15_000);
    const request: PortRequest = { environmentId, generation, resolve, cancel };
    broker.requests.add(request);
    target.addEventListener("message", broker.receive);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      requestPort();
    } catch (error) {
      cancel();
      reject(error);
    }
  });
}
