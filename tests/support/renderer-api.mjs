import { installApiHostBridge } from "./api-host.mjs";

// Install the shipped compatibility layer from the SAME bundle as the tested
// component. Only the Host at the other end of the real RPC port supplies data.
export function installRendererApi(target, { installApiShims, resetRpc }, getHost, { bridge = {} } = {}) {
  const borrowed = [
    [target, "piBridge"],
    [target, "fetch"],
    [target, "EventSource"],
    [globalThis, "fetch"],
    [globalThis, "EventSource"],
  ].map(([owner, name]) => [owner, name, Object.getOwnPropertyDescriptor(owner, name)]);
  let boundary;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const errors = [];
    try {
      boundary?.close();
    } catch (error) {
      errors.push(error);
    }
    for (const [owner, name, descriptor] of borrowed) {
      try {
        if (descriptor) Object.defineProperty(owner, name, descriptor);
        else delete owner[name];
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Renderer API cleanup failed");
  };
  try {
    target.piBridge = { ...target.piBridge, ...bridge };
    boundary = installApiHostBridge(target, getHost, resetRpc);
    Object.defineProperty(target, "fetch", { configurable: true, writable: true, value: globalThis.fetch });
    installApiShims();
    for (const name of ["fetch", "EventSource"]) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: target[name] });
    }
  } catch (error) {
    const errors = [error];
    try {
      close();
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (errors.length > 1) throw new AggregateError(errors, "Renderer API setup and cleanup failed", { cause: error });
    throw error;
  }
  return { emit: (...args) => boundary.emit(...args), close };
}
