import { unlink } from "node:fs/promises";
import type { RpcServer } from "../contract/rpc";
import { cleanupManagedTaskDirectory, isTaskDirectoryReferenced } from "./automation-workspace";
import { getRpcSession } from "./rpc-manager";
import { invalidateSessionContent } from "./session-content-cache";
import { clearSessionEventBinding } from "./session-event-binding";
import { sessionIndex } from "./session-index";
import { deleteSessionLeafChoice } from "./session-leaf-store";
import { sessionTranscriptPath } from "./session-orchestration/transcript";
import { sessionOriginStore } from "./session-origin-store";
import { invalidateSessionPathCache, resolveSessionPath } from "./session-reader";

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function cleanupAutomationTask(
  server: RpcServer,
  taskId: string,
  taskCwd: string,
  home: string,
  remainingTaskCwds: () => readonly string[],
): Promise<void> {
  for (const [sessionId, origin] of Object.entries(sessionOriginStore.list())) {
    if (origin.relation !== "automation" || origin.automationStep?.taskId !== taskId) continue;
    const session = getRpcSession(sessionId);
    if (session?.isAlive()) {
      await session.abortAndDispose();
      clearSessionEventBinding(sessionId);
    }
    const filePath = await resolveSessionPath(sessionId);
    if (filePath) {
      await unlinkIfPresent(filePath);
      invalidateSessionContent(filePath);
      await sessionIndex.removePath(filePath);
    }
    sessionOriginStore.delete(sessionId);
    deleteSessionLeafChoice(sessionId);
    await unlinkIfPresent(sessionTranscriptPath(sessionId));
    invalidateSessionPathCache(sessionId);
    server.emit("sessions.changed", sessionId, { cwd: taskCwd, sessionId, deleted: true, cause: "mutation" });
  }
  await sessionOriginStore.flush();
  if (!(await isTaskDirectoryReferenced(taskCwd, remainingTaskCwds()))) {
    await cleanupManagedTaskDirectory(home, taskCwd);
  }
}
