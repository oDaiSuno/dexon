export function managedProcessSecurityChecks(read) {
  const main = read("src/main/main.ts");
  const updateManager = read("src/main/update-manager.ts");
  const desktopBuildWorkflow = read(".github/workflows/build-desktop.yml");
  const packagedToolchainVerifier = read("scripts/verify-packaged-toolchains.mjs");
  const toolchainBash = read("src/agent-host/toolchain-bash.ts");
  const toolchainRuntime = read("src/agent-host/toolchain-runtime.ts");
  const toolEnvironment = read("src/agent-host/tool-environment.ts");
  const packageJson = read("package.json");
  const windowsHelperCargo = read("native/windows-managed-process-helper/Cargo.toml");
  const windowsHelperLock = read("native/windows-managed-process-helper/Cargo.lock");
  const windowsHelperMain = read("native/windows-managed-process-helper/src/main.rs");
  const windowsHelperWin32 = read("native/windows-managed-process-helper/src/win32/mod.rs");
  const windowsHelperState = read("native/windows-managed-process-helper/src/state.rs");
  const windowsHelperProtocol = read("native/windows-managed-process-helper/src/protocol.rs");
  const windowsHelperJson = read("native/windows-managed-process-helper/src/json.rs");
  const windowsHelperError = read("native/windows-managed-process-helper/src/error.rs");
  const windowsHelperCargoConfig = read("native/windows-managed-process-helper/.cargo/config.toml");
  const windowsHelperBuild = read("scripts/build-windows-managed-helper.mjs");
  const windowsHelperReproducibility = read("scripts/verify-windows-helper-reproducibility.mjs");
  const windowsHelperPe = read("scripts/windows-helper-pe.mjs");
  const windowsHelperClient = read("src/agent-host/managed-process/windows-helper-client.ts");
  const windowsHelperResolver = read("src/shared/windows-managed-process-helper.ts");
  const managedProcessService = read("src/agent-host/managed-process/service.ts");
  const managedProcessBackend = read("src/agent-host/managed-process/backend.ts");
  const posixManagedProcessBackend = read("src/agent-host/managed-process/posix-backend.ts");
  const managedProcessFrameworkAcceptance = read("scripts/test-managed-process-frameworks.mjs");
  const managedProcessFloodAcceptance = read("scripts/test-managed-process-flood.mjs");
  const windowsNsisUpgradeAcceptance = read("scripts/test-windows-nsis-upgrade.mjs");
  const windowsSbomBuild = read("scripts/generate-windows-sbom.mjs");
  const windowsSbomVerify = read("scripts/verify-windows-sbom.mjs");
  const packageDesktop = read("scripts/package-desktop.mjs");
  const thirdPartyNotices = read("THIRD_PARTY_NOTICES.md");
  const reaperJournal = read("src/main/managed-process/reaper-journal.ts");
  const managedProcessShutdownCleanup = read("src/main/managed-process/shutdown-cleanup.ts");
  const packagedCleanupFaultValidation = read("src/main/packaged-cleanup-fault-validation.ts");
  const windowsHelperUnsafePattern = /\bunsafe\s*(?:\{|impl\b)/gu;
  const windowsHelperUnsafeLines = windowsHelperWin32.split(/\r?\n/u);
  const documentedWindowsHelperUnsafe = windowsHelperUnsafeLines.every((line, index) => {
    if (!windowsHelperUnsafePattern.test(line)) {
      windowsHelperUnsafePattern.lastIndex = 0;
      return true;
    }
    windowsHelperUnsafePattern.lastIndex = 0;
    return windowsHelperUnsafeLines
      .slice(Math.max(0, index - 4), index + 1)
      .some((candidate) => candidate.includes("// SAFETY:"));
  });
  const windowsHelperUnsafeCount = windowsHelperWin32.match(windowsHelperUnsafePattern)?.length ?? 0;
  return [
    [
      windowsHelperCargo.includes('windows-sys = { version = "=0.61.2"') &&
        windowsHelperCargo.includes('panic = "abort"') &&
        windowsHelperCargo.includes('unsafe_op_in_unsafe_fn = "deny"') &&
        windowsHelperLock.includes('name = "windows-sys"\nversion = "0.61.2"') &&
        windowsHelperLock.includes('name = "windows-link"\nversion = "0.2.1"') &&
        !/(tokio|serde|reqwest|socket|tls)/i.test(windowsHelperCargo),
      "the Windows helper dependency, panic, unsafe, and runtime allowlist must remain pinned",
    ],
    [
      !/\bunsafe\b/u.test(
        windowsHelperMain + windowsHelperState + windowsHelperProtocol + windowsHelperJson + windowsHelperError,
      ) &&
        documentedWindowsHelperUnsafe &&
        windowsHelperUnsafeCount === 99,
      "the Windows helper safe parser/state machine must contain no unsafe code and every allowlisted Win32 unsafe operation must retain a SAFETY invariant",
    ],
    [
      windowsHelperCargoConfig.includes("target-feature=+crt-static") &&
        windowsHelperCargoConfig.includes("control-flow-guard=yes") &&
        windowsHelperCargoConfig.includes("link-arg=/Brepro") &&
        windowsHelperBuild.includes("verifyWindowsHelperPe(source)") &&
        windowsHelperPe.includes("REQUIRED_DLL_CHARACTERISTICS") &&
        windowsHelperPe.includes("ALLOWED_IMPORTS") &&
        windowsHelperPe.includes("resource type") &&
        desktopBuildWorkflow.includes("cargo install cargo-audit --locked --version 0.22.2") &&
        desktopBuildWorkflow.includes("cargo install cargo-deny --locked --version 0.20.2") &&
        desktopBuildWorkflow.includes("cargo install cargo-xwin --locked --version 0.23.1") &&
        desktopBuildWorkflow.includes("npm run build:windows-helper") &&
        windowsHelperBuild.includes('cargoXwin: "0.23.1"') &&
        windowsHelperBuild.includes('llvmMajor: "18"') &&
        windowsHelperBuild.includes('sdk: "10.0.26100"') &&
        windowsHelperBuild.includes('crt: "14.44.17.14"') &&
        windowsHelperBuild.includes('provenance = "cross-dev"') &&
        windowsHelperBuild.includes('digest.update(relative, "utf8")') &&
        windowsHelperReproducibility.includes("first !== second") &&
        desktopBuildWorkflow.includes("check:windows-helper-reproducibility") &&
        desktopBuildWorkflow.includes("cargo audit --file native/windows-managed-process-helper/Cargo.lock") &&
        desktopBuildWorkflow.includes("native/windows-managed-process-helper/deny.toml --locked check") &&
        desktopBuildWorkflow.includes("Flask==3.1.0 fastapi==0.128.0 uvicorn==0.40.0"),
      "the Windows helper must use static CRT and enforce pinned supply-chain, PE mitigation, import, manifest, and version-resource gates",
    ],
    [
      windowsHelperWin32.includes("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE") &&
        windowsHelperWin32.includes("CREATE_SUSPENDED") &&
        windowsHelperWin32.includes("PROC_THREAD_ATTRIBUTE_HANDLE_LIST") &&
        windowsHelperWin32.indexOf("AssignProcessToJobObject(job.raw(), process.raw())") <
          windowsHelperWin32.indexOf("ResumeThread(thread.raw())") &&
        !windowsHelperWin32.includes("CREATE_BREAKAWAY_FROM_JOB"),
      "the Windows helper must assign a suspended target to a kill-on-close Job before resume with an inherited-handle allowlist",
    ],
    [
      windowsHelperWin32.includes('verify_job_dacl(handle.raw(), "JOB_CREATE_FAILED")') &&
        windowsHelperWin32.includes('verify_job_dacl(handle.raw(), "JOB_QUERY_FAILED")') &&
        windowsHelperWin32.includes("JOB_OBJECT_TERMINATE | JOB_OBJECT_QUERY | READ_CONTROL | SYNCHRONIZE") &&
        windowsHelperWin32.includes("PROTECTED_DACL_SECURITY_INFORMATION") &&
        windowsHelperWin32.includes("let reopened = Job::open_for_reap(&name).unwrap().unwrap()"),
      "named Jobs must retain an exact protected current-user plus SYSTEM DACL and reapers must request READ_CONTROL before verifying it",
    ],
    [
      windowsHelperWin32.includes("JobObjectAssociateCompletionPortInformation") &&
        windowsHelperMain.includes("let active = job.active_processes()?") &&
        !windowsHelperWin32.includes("GetQueuedCompletionStatus"),
      "Job completion notifications must remain advisory: authoritative empty detection must query accounting even when no notification is consumed",
    ],
    [
      windowsHelperWin32.includes("CreateFileW") &&
        windowsHelperWin32.includes("GetFinalPathNameByHandleW") &&
        windowsHelperWin32.includes("FILE_SHARE_READ | FILE_SHARE_WRITE") &&
        !windowsHelperWin32.includes("FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE") &&
        windowsHelperWin32.indexOf("verify_spawn_path(&bootstrap.cwd, true)") <
          windowsHelperWin32.indexOf("CreateProcessW(") &&
        windowsHelperWin32.indexOf("verify_spawn_path(&bootstrap.shell_executable, false)") <
          windowsHelperWin32.indexOf("CreateProcessW(") &&
        windowsHelperState.includes("valid_bootstrap_path") &&
        windowsHelperState.includes('normalized.starts_with(r"\\\\?\\")'),
      "the Windows helper must pin and final-path verify cwd/shell before CreateProcessW while rejecting device namespaces",
    ],
    [
      windowsHelperMain.includes('Some("--owner-stdio-v1")') &&
        windowsHelperMain.includes('Some("--reap-stdio-v1")') &&
        windowsHelperMain.includes('Some("--self-test-json-v1")') &&
        windowsHelperMain.includes('Some("--version-json-v1")') &&
        !/(TcpListener|UdpSocket|std::net|WinHttp|WinInet)/u.test(
          windowsHelperMain + windowsHelperWin32 + windowsHelperState + windowsHelperProtocol,
        ),
      "the Windows helper must expose only fixed owner/reaper/self-test/version modes and no network surface",
    ],
    [
      windowsHelperClient.includes('this.descriptor.path, ["--owner-stdio-v1"]') &&
        windowsHelperClient.includes("actual !== this.descriptor.sha256") &&
        windowsHelperMain.includes("win32::lock_current_executable()") &&
        windowsHelperWin32.includes("pub fn lock_current_executable()") &&
        windowsHelperWin32.includes("Sharing only reads pins the helper against write/delete replacement") &&
        windowsHelperResolver.includes('"managed-process", "win32-x64"') &&
        !windowsHelperResolver.includes("process.env") &&
        !/taskkill(?:\.exe)?\s+\/T/i.test(windowsHelperClient + managedProcessService) &&
        reaperJournal.includes("fs.lstatSync(filePath)") &&
        windowsHelperWin32.includes("PROTECTED_DACL_SECURITY_INFORMATION") &&
        windowsHelperWin32.includes("SetFileSecurityW") &&
        windowsHelperWin32.includes("FILE_ATTRIBUTE_REPARSE_POINT") &&
        reaperJournal.includes("JOURNAL_MAX_BYTES = 64 * 1024") &&
        reaperJournal.includes("RECORD_MAX_COUNT = 16"),
      "Windows managed processes must use a fixed verified helper path, never taskkill /T, and retain bounded protected-DACL reparse-aware journals",
    ],
    [
      managedProcessBackend.includes("export interface ManagedProcessBackend") &&
        posixManagedProcessBackend.includes("implements ManagedProcessBackend") &&
        posixManagedProcessBackend.includes("detached: true") &&
        posixManagedProcessBackend.includes("terminatePosixProcessGroup") &&
        managedProcessService.includes("new PosixManagedProcessBackend") &&
        !managedProcessService.includes("record.worker"),
      "managed process orchestration must use explicit POSIX and Windows backend adapters without inline worker ownership",
    ],
    [
      toolEnvironment.includes("export function sanitizeToolEnvironment") &&
        toolEnvironment.includes("SENSITIVE_EXACT_KEYS") &&
        toolEnvironment.includes("SENSITIVE_KEY_SUFFIXES") &&
        toolEnvironment.includes("containsUrlCredentials") &&
        toolchainRuntime.includes("this.baseEnv = sanitizeToolEnvironment(options.baseEnv ?? process.env)") &&
        toolchainBash.includes("env: sanitizeToolEnvironment({ ...spawnContext.env, ...context.shellEnv })"),
      "Agent tools and managed processes must not inherit provider credentials or credential-bearing URLs",
    ],
    [
      managedProcessFrameworkAcceptance.includes("Next dev HMR tree stop") &&
        managedProcessFrameworkAcceptance.includes("Storybook real cold start stop") &&
        managedProcessFrameworkAcceptance.includes("Spring Boot mvnw.cmd JVM tree stop") &&
        desktopBuildWorkflow.includes("windows-frameworks:") &&
        desktopBuildWorkflow.includes("next@16.3.2") &&
        desktopBuildWorkflow.includes("storybook@10.5.10") &&
        desktopBuildWorkflow.includes("npm run test:managed-process-frameworks"),
      "real Next, Storybook, and Spring Boot scenarios must remain pinned in the Windows release gate",
    ],
    [
      managedProcessFloodAcceptance.includes('new Set(["stdout", "both"])') &&
        managedProcessFloodAcceptance.includes("processCount > 8") &&
        managedProcessFloodAcceptance.includes("per-process output memory exceeded 2 MiB") &&
        managedProcessFloodAcceptance.includes("a dual-stream flood process did not expose both stdout and stderr") &&
        desktopBuildWorkflow.includes('$env:PI_MANAGED_FLOOD_DURATION_MS = "60000"') &&
        desktopBuildWorkflow.includes('$env:PI_MANAGED_FLOOD_PROCESSES = "8"') &&
        desktopBuildWorkflow.includes('$env:PI_MANAGED_FLOOD_STREAMS = "both"') &&
        desktopBuildWorkflow.includes("npm run test:managed-process-flood"),
      "Windows CI must retain the 60-second eight-process stdout/stderr flood and bounded-output lifecycle budgets",
    ],
    [
      windowsNsisUpgradeAcceptance.includes("assertCleanUserInstallState()") &&
        windowsNsisUpgradeAcceptance.includes("direct rollback must remove the newer helper directory") &&
        windowsNsisUpgradeAcceptance.includes("verifyInstalledHelperLock(executable)") &&
        windowsNsisUpgradeAcceptance.includes("running installed helper must prevent replacement") &&
        windowsNsisUpgradeAcceptance.includes("stopped installed helper must become replaceable") &&
        windowsNsisUpgradeAcceptance.includes("validateStartup(appExecutable(installPath), isolated, currentVersion") &&
        windowsNsisUpgradeAcceptance.includes(
          "validateStartup(appExecutable(installPath), isolated, previousVersion",
        ) &&
        desktopBuildWorkflow.includes("5d99744a18f7495c987146a44718dbb5ba7037cf279ada62669aefc9940313c5") &&
        desktopBuildWorkflow.match(/npm run test:windows-nsis-upgrade/g)?.length === 2,
      "Windows PR and release packaging must test a hash-pinned previous NSIS upgrade, installed-helper locking, direct rollback, and clean uninstall",
    ],
    [
      packageJson.includes('"build:windows-sbom": "node scripts/generate-windows-sbom.mjs"') &&
        packageJson.includes('"check:windows-sbom": "node scripts/verify-windows-sbom.mjs"') &&
        packageDesktop.includes("generate Windows release SBOM") &&
        packageDesktop.includes("verify Windows release SBOM") &&
        windowsSbomBuild.includes('bomFormat: "CycloneDX"') &&
        windowsSbomBuild.includes('specVersion: "1.5"') &&
        windowsSbomBuild.includes('facts.helperManifest.provenance !== "release-authoritative"') &&
        windowsSbomBuild.includes('name: "Rust standard library"') &&
        windowsSbomBuild.includes('name: "windows-sys"') &&
        windowsSbomBuild.includes('name: "windows-link"') &&
        windowsSbomBuild.includes('buildTool("tool:cargo-xwin", "cargo-xwin"') &&
        windowsSbomBuild.includes("nativeWindowsSdk") &&
        windowsSbomBuild.includes("nativeMsvcToolset") &&
        windowsSbomVerify.includes("exactly one Windows x64 CycloneDX SBOM") &&
        desktopBuildWorkflow.match(/Generate and verify Windows SBOM/g)?.length === 2 &&
        desktopBuildWorkflow.includes("dist/*.cdx.json") &&
        desktopBuildWorkflow.includes("THIRD_PARTY_NOTICES.md") &&
        thirdPartyNotices.includes("Each Windows release publishes a CycloneDX SBOM"),
      "Windows packaging and draft releases must publish a lock-derived CycloneDX SBOM, exact native/cross build provenance, and third-party notices",
    ],
    [
      managedProcessShutdownCleanup.includes("options.deadline") &&
        managedProcessShutdownCleanup.includes("options.requireConfirmedEmpty") &&
        managedProcessShutdownCleanup.includes("status?.ready !== true") &&
        managedProcessShutdownCleanup.includes("status.records !== 0") &&
        main.includes("cleanupManagedProcessContainment") &&
        main.includes("verifyWindowsManagedProcessHelperReplaceable") &&
        updateManager.includes("await this.prepareToInstall()") &&
        updateManager.includes("await this.recoverInstallLifecycle()"),
      "quit and update cleanup must share a hard deadline while update installation fails closed and restores lifecycle state",
    ],
    [
      main.includes('process.argv.includes("--validate-packaged-cleanup-fault")') &&
        main.includes("runPackagedCleanupFaultValidation") &&
        main.includes("isQuitting = false") &&
        main.includes("createTray(getMainWindow, () => void stopAllManagedProcessesFromTray())") &&
        main.includes("restartHostAfterExit(manager, () => !isQuitting)") &&
        packagedCleanupFaultValidation.includes("requireConfirmedEmpty: false") &&
        packagedCleanupFaultValidation.includes("requireConfirmedEmpty: true") &&
        packagedCleanupFaultValidation.includes("installerLaunches === 0") &&
        packagedCleanupFaultValidation.includes('report.updatePhase === "error"') &&
        packagedToolchainVerifier.includes("runPackagedCleanupFaultValidation(layout.executable)") &&
        packagedToolchainVerifier.includes("packaged-cleanup-fault-check.json"),
      "the packaged Windows gate must fault-inject cleanup uncertainty, retain the journal, recover lifecycle state, and never launch the installer",
    ],
  ];
}
