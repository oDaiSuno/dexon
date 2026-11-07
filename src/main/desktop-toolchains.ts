import { app, net } from "electron";
import { ToolchainManager } from "./toolchains/manager";
import { resolveRuntimeCatalogPath } from "./toolchains/catalog";
import { resolveBundledCorePaths } from "./toolchains/bundled-core";
import { readLegacyNpmCommand } from "./toolchains/legacy-npm-command";
import { createElectronRuntimeFetch } from "./toolchains/electron-runtime-fetch";
export function createDesktopToolchains(isRuntimeInUse: () => boolean): ToolchainManager {
  const bundledCorePaths = resolveBundledCorePaths({
    isPackaged: app.isPackaged,
    resourcesRoot: process.resourcesPath,
  });
  const toolchainHome = app.getPath("home");
  return new ToolchainManager({
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    homeDir: toolchainHome,
    tempRoot: app.getPath("temp"),
    userDataRoot: app.getPath("userData"),
    resourcesRoot: process.resourcesPath,
    catalogPath: resolveRuntimeCatalogPath({
      isPackaged: app.isPackaged,
      resourcesRoot: process.resourcesPath,
    }),
    coreCatalogPath: bundledCorePaths.catalogPath,
    bundledCoreRoot: bundledCorePaths.coreRoot,
    fetchImpl: createElectronRuntimeFetch((options) => net.request(options)),
    legacyNpmCommand: readLegacyNpmCommand({ homeDir: toolchainHome, env: process.env }),
    isRuntimeInUse,
  });
}
