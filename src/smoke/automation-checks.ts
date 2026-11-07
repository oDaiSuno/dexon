import type { BrowserWindow } from "electron";
import type { SaveTaskResult, TaskRevisionView, TaskView } from "../shared/automation/views";

export async function runAutomationSmokeChecks(
  call: <T>(method: string, params?: unknown) => Promise<T>,
  waitForEvent: (topic: string, key: string, predicate: (data: unknown) => boolean) => Promise<unknown>,
): Promise<void> {
  const id = "smoke-automation";
  const change = waitForEvent("automation.changed", "*", (data) =>
    Boolean(
      data && typeof data === "object" && "taskIds" in data && Array.isArray(data.taskIds) && data.taskIds.includes(id),
    ),
  );
  await call("host.ping");
  const saved = await call<SaveTaskResult>("automation.saveTask", {
    spec: {
      schema: "dexon.automation/v1",
      id,
      name: "Automation smoke",
      cwd: process.cwd(),
      triggers: [{ id: "manual", kind: "manual" }],
      steps: [{ kind: "wait", id: "hold", wait: { kind: "duration", duration: "1h" } }],
    },
  });
  await change;
  const { task } = await call<{ task: TaskRevisionView }>("automation.getTask", { taskId: id });
  if (
    task.planHash !== saved.planHash ||
    task.requiredGrant.planHash !== saved.planHash ||
    task.revision !== saved.revision
  )
    throw new Error("Automation revision and grant binding did not survive Host RPC");
  const { tasks } = await call<{ tasks: TaskView[] }>("automation.listTasks", { cwd: process.cwd() });
  if (!tasks.some((task) => task.id === id && task.enabledRevision === null))
    throw new Error("Automation task was not saved disabled");
  await call("automation.listRuns", { taskId: id });
  await call("automation.listInbox");
  await call("automation.disableTask", { taskId: id });
  await call("automation.deleteTask", { taskId: id });
  const remaining = await call<{ tasks: TaskView[] }>("automation.listTasks");
  if (remaining.tasks.some((task) => task.id === id)) throw new Error("Automation task deletion did not persist");
}
export async function runAutomationBridgeSmokeCheck(window: BrowserWindow): Promise<void> {
  const result = await window.webContents.executeJavaScript(`(async () => {
    const bridge = window.piBridge;
    if (typeof bridge.setAutomationSecret !== "function" || typeof bridge.deleteAutomationSecret !== "function" || typeof bridge.listAutomationSecretNames !== "function" || "getAutomationSecret" in bridge) return false;
    const names = await bridge.listAutomationSecretNames();
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) return false;
    try {
      await bridge.setAutomationSecret("smoke.bridge", "bridge-secret");
      const saved = await bridge.listAutomationSecretNames();
      if (!saved.includes("smoke.bridge") || saved.includes("bridge-secret")) return false;
      await bridge.deleteAutomationSecret("smoke.bridge");
      if ((await bridge.listAutomationSecretNames()).includes("smoke.bridge")) return false;
    } catch (error) {
      if (!String(error).includes("OS credential encryption is unavailable")) return false;
      if ((await bridge.listAutomationSecretNames()).includes("smoke.bridge")) return false;
    }
    try { await bridge.setAutomationSecret("INVALID", "must-not-persist"); return false; }
    catch (error) { return String(error).includes("Invalid automation secret name"); }
  })()`);
  if (result !== true) throw new Error("Automation write-only secret bridge did not enforce its public boundary");
}
