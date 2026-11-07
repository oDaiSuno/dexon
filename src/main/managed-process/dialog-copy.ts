import { app, dialog, type BrowserWindow } from "electron";
import type { HostManager } from "../host-manager";
import { appendMainLog } from "../logger";

export function managedProcessDialogCopy(): {
  stopAllTitle: string;
  stopAllMessage: (count: number) => string;
  stopAllDetail: string;
  stopAllButton: string;
  cancelButton: string;
  lanTitle: string;
  lanMessage: string;
  lanDetail: string;
  allowOnceButton: string;
  exportTitle: string;
  exportFilter: string;
  quitTitle: string;
  quitMessage: (count: number) => string;
  quitDetail: string;
  stopAndQuitButton: string;
} {
  if (app.getLocale().toLowerCase().startsWith("zh")) {
    return {
      stopAllTitle: "停止后台进程",
      stopAllMessage: (count) => `确认停止 ${count} 个受管后台进程？`,
      stopAllDetail: "开发服务器和 watcher 将连同完整进程树一起停止。",
      stopAllButton: "全部停止",
      cancelButton: "取消",
      lanTitle: "允许绑定局域网？",
      lanMessage: "Agent 命令似乎会把受管进程绑定到所有网络接口。",
      lanDetail: "这可能把开发服务器暴露给局域网内的其他设备。除非确实需要局域网访问，否则请使用 127.0.0.1。",
      allowOnceButton: "仅允许本次",
      exportTitle: "导出受管进程日志",
      exportFilter: "日志文件",
      quitTitle: "退出 Dexon",
      quitMessage: (count) => `仍有 ${count} 个受管后台进程在运行。`,
      quitDetail: "退出会停止所有开发服务器和 watcher，并清理其完整进程树。",
      stopAndQuitButton: "停止并退出",
    };
  }
  return {
    stopAllTitle: "Stop background processes",
    stopAllMessage: (count) => `Stop ${count} managed background process${count === 1 ? "" : "es"}?`,
    stopAllDetail: "Development servers and watchers will be stopped with their complete process trees.",
    stopAllButton: "Stop All",
    cancelButton: "Cancel",
    lanTitle: "Allow local-network binding?",
    lanMessage: "An Agent command appears to bind a managed process to all network interfaces.",
    lanDetail:
      "This may expose the development server to other devices on the local network. Prefer 127.0.0.1 unless LAN access is intentional.",
    allowOnceButton: "Allow Once",
    exportTitle: "Export managed process log",
    exportFilter: "Log files",
    quitTitle: "Quit Dexon",
    quitMessage: (count) => `${count} managed background process${count === 1 ? " is" : "es are"} still running.`,
    quitDetail: "Quitting stops every development server and watcher with its complete process tree.",
    stopAndQuitButton: "Stop and Quit",
  };
}

export async function stopAllManagedProcessesFromTray(options: {
  count: number;
  hostManager: HostManager | null;
  window: BrowserWindow | null;
}): Promise<void> {
  const { count, hostManager, window } = options;
  if (count <= 0 || hostManager?.getStatus() !== "ready") return;
  const copy = managedProcessDialogCopy();
  const confirmation = {
    type: "warning" as const,
    title: copy.stopAllTitle,
    message: copy.stopAllMessage(count),
    detail: copy.stopAllDetail,
    buttons: [copy.stopAllButton, copy.cancelButton],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const result = window ? await dialog.showMessageBox(window, confirmation) : await dialog.showMessageBox(confirmation);
  if (result.response !== 0) return;
  try {
    await hostManager.call("processes.stopAll", { mode: "graceful" }, 15_000);
  } catch (error) {
    appendMainLog(`stop all managed processes failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
