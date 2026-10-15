import type { BrowserWindow } from "electron";

// These observations use the shipped page, preload bridge and Host wire
// protocol. They do not read production controller state or install handlers.
export async function waitForProductionRenderer(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const check = async () => {
        try {
          const root = document.getElementById("root");
          if (window.piBridge && root?.childElementCount > 0 && await window.piBridge.getHostStatus() === "ready") {
            resolve();
            return;
          }
          if (Date.now() >= deadline) throw new Error("Production renderer and Host did not become ready");
          setTimeout(check, 50);
        } catch (error) {
          reject(error);
        }
      };
      void check();
    })
  `);
}

export async function pingProductionHost(window: BrowserWindow): Promise<void> {
  const result: unknown = await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      let port;
      const timer = setTimeout(() => finish(new Error("Production Host ping timed out")), 10000);
      const finish = (error, result) => {
        clearTimeout(timer);
        window.removeEventListener("message", onPort);
        port?.close();
        if (error) reject(error);
        else resolve(result);
      };
      const onPort = (event) => {
        if (event.source !== window || event.data?.channel !== "dexon-host-port" || !event.ports[0]) return;
        window.removeEventListener("message", onPort);
        port = event.ports[0];
        port.onmessage = ({ data }) => {
          if (data.kind !== "response" || data.id !== "production-startup-ping") return;
          if (!data.ok) finish(new Error(data.error?.message ?? "Production Host rejected ping"));
          else finish(null, data.result);
        };
        port.start();
        port.postMessage({ kind: "request", id: "production-startup-ping", method: "host.ping" });
      };
      window.addEventListener("message", onPort);
      window.piBridge.requestHostPort();
    })
  `);
  if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true) {
    throw new Error("Production Host returned an invalid ping result");
  }
}

export async function observeProductionHandover(window: BrowserWindow, sessionId: string): Promise<void> {
  await window.webContents.executeJavaScript(`
    window.__productionStartupHandover = false;
    window.piBridge.onDeepLinkSession((id) => {
      if (id === ${JSON.stringify(sessionId)}) window.__productionStartupHandover = true;
    });
    // The bridge returns an unsubscribe function, which cannot cross the
    // executeJavaScript result boundary. The listener belongs to this page.
    void 0;
  `);
}

export async function waitForProductionHandover(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        if (window.__productionStartupHandover === true) resolve();
        else if (Date.now() >= deadline) reject(new Error("Production page did not receive the second-instance deep link"));
        else setTimeout(check, 25);
      };
      check();
    })
  `);
}
