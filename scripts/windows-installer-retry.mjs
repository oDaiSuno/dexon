export const ACCESS_VIOLATION_EXIT_STATUS = 3221225477;

export const FIRST_INSTALL_PHASE = "first-install";

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
