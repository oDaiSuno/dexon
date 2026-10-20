import { workflowWarning } from "./ci-retry.mjs";
import {
  FIRST_INSTALL_ATTEMPTS,
  FIRST_INSTALL_PHASE,
  firstInstallCrashWarning,
  shouldRetryFirstInstall,
  shouldRetryRefusedFreshInstall,
} from "./windows-installer-retry.mjs";
import {
  installDirectoryEntries,
  installFailed,
  installerFailure,
  installerStatusError,
  readUserInstallState,
  runInstaller,
  runInstallerWith,
} from "./windows-nsis-harness.mjs";

const REFUSED_INSTALL_STATUS = 2;

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

export function refusedFreshInstall(installer, directory, extraArguments = []) {
  for (let attempt = 1; ; attempt += 1) {
    const result = runInstallerWith(installer, directory, extraArguments);
    if (result.status === REFUSED_INSTALL_STATUS) return result;
    if (
      attempt >= FIRST_INSTALL_ATTEMPTS ||
      !shouldRetryRefusedFreshInstall({ result, installState: readUserInstallState() })
    ) {
      throw installerStatusError(result, directory, REFUSED_INSTALL_STATUS);
    }
    console.log(workflowWarning(firstInstallCrashWarning(attempt)));
  }
}
