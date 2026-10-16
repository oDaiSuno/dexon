// Run inside the shipped page using its public preload/Host MessagePort.
// This independently validates native fixture discovery before a missing UI
// entry can block the journey. No product module or handler is replaced.
export function productionResourceProbe() {
  const { window } = globalThis;
  return new Promise((resolve, reject) => {
    let port;
    let sequence = 0;
    let finished = false;
    const pending = new Map();
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("message", receivePort);
      port?.close();
      if (error) {
        for (const request of pending.values()) request.reject(error);
        reject(error);
      } else resolve(result);
      pending.clear();
    };
    const request = (method, params) =>
      new Promise((resolveRequest, rejectRequest) => {
        const id = `navigation-resource-probe-${++sequence}`;
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        port.postMessage({ kind: "request", id, method, params });
      });
    const read = async () => {
      const { cwd } = await request("system.defaultCwd");
      const plugins = await request("plugins.list", { cwd });
      const { skills } = await request("skills.list", { cwd });
      const skill = skills.find((item) => item.name === "production-checklist");
      if (!skill) throw new Error("Production Host did not discover the seeded personal skill");
      const { content } = await request("skills.getContent", { cwd, filePath: skill.filePath });
      return { cwd, packages: plugins.packages, skills, content };
    };
    const receivePort = (event) => {
      if (event.source !== window || event.data?.channel !== "dexon-host-port" || !event.ports[0]) return;
      window.removeEventListener("message", receivePort);
      port = event.ports[0];
      port.onmessage = ({ data }) => {
        if (data.kind !== "response" || !pending.has(data.id)) return;
        const active = pending.get(data.id);
        pending.delete(data.id);
        if (data.ok) active.resolve(data.result);
        else active.reject(new Error(data.error?.message ?? "Production Host rejected a resource probe"));
      };
      port.start();
      void read().then(
        (result) => finish(null, result),
        (error) => finish(error),
      );
    };
    const timer = setTimeout(() => finish(new Error("Production resource discovery timed out")), 15000);
    window.addEventListener("message", receivePort);
    try {
      window.piBridge.requestHostPort();
    } catch (error) {
      finish(error);
    }
  });
}
