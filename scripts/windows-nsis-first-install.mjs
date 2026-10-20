import { workflowWarning } from "./ci-retry.mjs";
import {
  FIRST_INSTALL_ATTEMPTS,
  FIRST_INSTALL_PHASE,
  firstInstallCrashWarning,
  shouldRetryFirstInstall,
} from "./windows-installer-retry.mjs";
import {
  installDirectoryEntries,
  installFailed,
  installerFailure,
  readUserInstallState,
  runInstaller,
} from "./windows-nsis-harness.mjs";

export function firstInstall(installer, directory) {
  for (let attempt = 1; ; attempt += 1) {
    const result = runInstaller(installer, directory);
    if (!installFailed(result)) return;
    if (
      attempt >= FIRST_INSTALL_ATTEMPTS ||
      !shouldRetryFirstInstall({
        phase: FIRST_INSTALL_PHASE,
        result,
        installState: readUserInstallState(),
        installDirectoryEntries: installDirectoryEntries(directory),
      })
    ) {
      throw installerFailure(result);
    }
    console.log(workflowWarning(firstInstallCrashWarning(attempt)));
  }
}
