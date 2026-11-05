import { app } from "electron";
import path from "node:path";
import type { ToolchainActionRequest } from "../shared/toolchains/types";

export function toolchainActionConfirmation(request: ToolchainActionRequest): Electron.MessageBoxOptions | undefined {
  const chinese = app.getLocale().toLowerCase().startsWith("zh");
  if (
    request.action === "install-profile" ||
    request.action === "install-component" ||
    request.action === "repair-component"
  ) {
    return {
      type: "warning",
      title: chinese ? "安装开发工具" : "Install developer tools",
      message: chinese
        ? "Pi Desktop 将从界面所示的官方来源下载固定版本。来源会收到你的 IP 地址、平台和架构；文件仅保存在应用私有数据中，也不会修改系统 PATH。是否继续？"
        : "Pi Desktop will download fixed releases from the official sources shown in Developer Tools. The sources receive your IP address, platform, and architecture. Files stay in private app data and system PATH is not changed.",
      buttons: chinese ? ["取消", "继续"] : ["Cancel", "Continue"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    };
  }
  if (request.action === "remove-component") {
    return {
      type: "warning",
      title: chinese ? "移除托管工具" : "Remove managed tool",
      message: chinese
        ? "移除此 Pi Desktop 托管运行时？系统工具和自定义工具不会受影响。"
        : "Remove this Pi Desktop-managed runtime? System and custom tools are not affected.",
      buttons: chinese ? ["取消", "移除"] : ["Cancel", "Remove"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
  }
  if (request.action === "clear-cache") {
    return {
      type: "question",
      title: chinese ? "清理工具缓存" : "Clear tool cache",
      message: chinese
        ? "清除此应用私有缓存？已安装的运行时不会被移除。"
        : "Clear this private app cache? Installed runtimes are not removed.",
      buttons: chinese ? ["取消", "清理"] : ["Cancel", "Clear"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
  }
  return undefined;
}

export function validateOptionalToolchainCwd(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 4_096 || /[\0\r\n]/.test(value) || !path.isAbsolute(value)) {
    throw new Error("Invalid toolchain workspace path");
  }
  return path.normalize(value);
}
