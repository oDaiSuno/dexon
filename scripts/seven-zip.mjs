import { createRequire } from "node:module";

export async function locate7za() {
  const fromElectronBuilder = createRequire(createRequire(import.meta.url).resolve("electron-builder"));
  const fromAppBuilderLib = createRequire(fromElectronBuilder.resolve("app-builder-lib"));
  return fromAppBuilderLib("app-builder-lib/out/toolsets/7zip").getPath7za();
}
