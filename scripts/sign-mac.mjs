import path from "node:path";
import { signAsync } from "@electron/osx-sign";

export function signOptionsWithBundleRequirement(
  options,
  bundleIdentifier = "app.dexon.desktop",
  appBundleName = "Dexon.app",
) {
  const baseOptionsForFile = options.optionsForFile;
  const requirement = `=designated => identifier "${bundleIdentifier}"`;
  const isMainBundle = path.basename(options.app) === appBundleName;
  return {
    ...options,
    optionsForFile(filePath) {
      const fileOptions = baseOptionsForFile ? baseOptionsForFile(filePath) : {};
      if (isMainBundle && filePath === options.app) {
        return { ...fileOptions, requirements: requirement };
      }
      return fileOptions;
    },
  };
}

export default async function sign(options, packager) {
  const bundleIdentifier = packager?.appInfo?.id || "app.dexon.desktop";
  const appBundleName = `${packager?.appInfo?.productFilename || "Dexon"}.app`;
  await signAsync(signOptionsWithBundleRequirement(options, bundleIdentifier, appBundleName));
}
