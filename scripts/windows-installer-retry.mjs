export const ACCESS_VIOLATION_EXIT_STATUS = 3221225477;

export const FIRST_INSTALL_ATTEMPTS = 4;

export const FIRST_INSTALL_PHASE = "first-install";

export function firstInstallCrashWarning(attempt, exitStatus = ACCESS_VIOLATION_EXIT_STATUS) {
  return `Fresh install exited ${exitStatus} (0xC0000005) before writing anything (electron-builder 26.0.12 multiUser.nsh over-read, fixed upstream in electron-builder#9769); retry ${attempt} of ${FIRST_INSTALL_ATTEMPTS - 1}.`;
}

const CLEAN_INSTALL_STATE = { entries: 0, shortcut: false, processes: 0 };

function isCleanInstallState({ entries, shortcut, processes }) {
  return (
    entries === CLEAN_INSTALL_STATE.entries &&
    shortcut === CLEAN_INSTALL_STATE.shortcut &&
    processes === CLEAN_INSTALL_STATE.processes
  );
}

export function shouldRetryFirstInstall({ phase, result, installState, installDirectoryEntries }) {
  return (
    phase === FIRST_INSTALL_PHASE &&
    !result.error &&
    !result.signal &&
    result.status === ACCESS_VIOLATION_EXIT_STATUS &&
    isCleanInstallState(installState) &&
    installDirectoryEntries.length === 0
  );
}

export function shouldRetryRefusedFreshInstall({ result, installState }) {
  return (
    !result.error &&
    !result.signal &&
    result.status === ACCESS_VIOLATION_EXIT_STATUS &&
    isCleanInstallState(installState)
  );
}
