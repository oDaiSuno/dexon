import { createDeferred } from "#test-timing";

// A controllable OTHER process: requests arrive after the real renderer
// client has encoded them. Replies are contract data, never fake Responses.
export function createDeferredHost(methods) {
  const pending = [];
  return {
    pending,
    call(method, params) {
      if (!methods.includes(method)) throw new Error(`Unexpected Host request: ${method}`);
      const deferred = createDeferred();
      pending.push({ method, params, deferred });
      return deferred.promise;
    },
  };
}

export function hostError(message, { code = "INTERNAL", ...detail } = {}) {
  return Object.assign(new Error(message), { code, detail });
}
