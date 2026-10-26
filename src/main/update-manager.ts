import type { DesktopUpdateState, UpdatePhase } from "../contract/desktop";
import type { UpdateAdapter } from "./update-adapter";
import {
  ERROR_MESSAGES,
  UpdateManagerError,
  classifyUpdateError,
  redactUpdateError,
  type UpdateOperation,
} from "./update-errors.ts";
import {
  availableUpdateDetails,
  downloadedUpdateDetails,
  finiteNonNegative,
  type UpdateDetails,
  type UpdateTarget,
} from "./update-info.ts";
import { UpdateOperationSlot } from "./update-operation.ts";

export { UpdateManagerError, redactUpdateError } from "./update-errors.ts";

const DEFAULT_INITIAL_CHECK_DELAY_MS = 60_000;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_DOWNLOAD_WATCHDOG_MS = 15 * 60 * 1_000;
const DEFAULT_JITTER_RATIO = 0.08;

type UpdateLogLevel = "info" | "warn" | "error";

export interface UpdateManagerOptions {
  adapter: UpdateAdapter | null;
  currentVersion: string;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  automaticChecksEnabled?: boolean;
  initialCheckDelayMs?: number;
  checkIntervalMs?: number;
  downloadWatchdogMs?: number;
  jitterRatio?: number;
  random?: () => number;
  now?: () => Date;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  prepareToInstall?: () => void | Promise<void>;
  recoverFromInstallFailure?: () => void | Promise<void>;
  log?: (level: UpdateLogLevel, message: string) => void;
}

export interface CheckForUpdatesOptions {
  automatic?: boolean;
}

function cloneState(state: DesktopUpdateState): DesktopUpdateState {
  return {
    ...state,
    error: state.error ? { ...state.error } : undefined,
  };
}

function unrefTimer(timer: unknown): void {
  if (!timer || typeof timer !== "object") return;
  const candidate = timer as { unref?: () => void };
  candidate.unref?.();
}

export class UpdateManager {
  private readonly adapter: UpdateAdapter | null;
  private readonly enabled: boolean;
  private readonly currentVersion: string;
  private readonly initialCheckDelayMs: number;
  private readonly checkIntervalMs: number;
  private readonly downloadWatchdogMs: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;
  private readonly now: () => Date;
  private readonly target: UpdateTarget;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly prepareToInstall: () => void | Promise<void>;
  private readonly recoverFromInstallFailure: () => void | Promise<void>;
  private readonly log: (level: UpdateLogLevel, message: string) => void;
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>();
  private readonly removeAdapterListeners: Array<() => void> = [];

  private state: DesktopUpdateState;
  private details: UpdateDetails = {};
  private readonly operation = new UpdateOperationSlot();
  private automaticTimer: unknown = null;
  private automaticChecksStarted = false;
  private disposed = false;
  private runningSessionCount = 0;
  private downloadEventReceived = false;
  private downloadPromiseSettled = false;
  private downloadWatchdogTimer: unknown = null;
  private downloadWatchdogGeneration = 0;
  private rejectWatchedDownload: ((error: unknown) => void) | null = null;
  private installLifecyclePrepared = false;
  private installRecoveryPromise: Promise<void> | null = null;

  constructor(options: UpdateManagerOptions) {
    const platform = options.platform ?? process.platform;
    const supportedPlatform = platform === "darwin" || platform === "win32";
    const explicitlyEnabledForDevelopment = process.env.PI_DESKTOP_TEST_UPDATER === "1";

    this.adapter = options.adapter;
    this.enabled = Boolean(
      options.adapter && supportedPlatform && (options.isPackaged || explicitlyEnabledForDevelopment),
    );
    this.currentVersion = options.currentVersion;
    this.initialCheckDelayMs = Math.max(0, options.initialCheckDelayMs ?? DEFAULT_INITIAL_CHECK_DELAY_MS);
    this.checkIntervalMs = Math.max(1, options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS);
    this.downloadWatchdogMs = Math.max(1, options.downloadWatchdogMs ?? DEFAULT_DOWNLOAD_WATCHDOG_MS);
    this.jitterRatio = Math.min(0.5, Math.max(0, options.jitterRatio ?? DEFAULT_JITTER_RATIO));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.target = { platform, arch: options.arch ?? process.arch };
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.prepareToInstall = options.prepareToInstall ?? (() => undefined);
    this.recoverFromInstallFailure = options.recoverFromInstallFailure ?? (() => undefined);
    this.log = options.log ?? (() => undefined);

    this.state = {
      phase: this.enabled ? "idle" : "disabled",
      currentVersion: this.currentVersion,
      automaticChecksEnabled: options.automaticChecksEnabled ?? true,
      installBlockedByActiveSessions: false,
      canRetry: false,
    };

    if (this.enabled && this.adapter) this.bindAdapterEvents(this.adapter);
  }

  getState(): DesktopUpdateState {
    return cloneState(this.state);
  }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  setRunningSessionCount(count: number): void {
    if (this.disposed) return;
    const nextCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (nextCount === this.runningSessionCount) return;
    this.runningSessionCount = nextCount;
    this.state = {
      ...this.state,
      installBlockedByActiveSessions: this.runningSessionCount > 0,
    };
    this.emitState();
  }

  checkForUpdates(options: CheckForUpdatesOptions = {}): Promise<DesktopUpdateState> {
    const unavailable = this.requireEnabled();
    if (unavailable) return Promise.reject(unavailable);

    const active = this.operation.reuseOrReject<DesktopUpdateState>("check");
    if (active) return active;
    if (!this.isPhase("idle", "up-to-date", "error")) {
      return Promise.reject(this.invalidState("check for updates"));
    }

    this.details = {};
    this.transition("checking");
    this.log("info", `checking for updates (${options.automatic ? "automatic" : "manual"})`);

    return this.operation.track("check", async () => {
      try {
        await this.adapter!.checkForUpdates();
      } catch (error) {
        if (this.state.phase !== "error") this.recordAdapterError(error, "check");
      }
      return this.getState();
    });
  }

  downloadUpdate(): Promise<DesktopUpdateState> {
    const unavailable = this.requireEnabled();
    if (unavailable) return Promise.reject(unavailable);

    const active = this.operation.reuseOrReject<DesktopUpdateState>("download");
    if (active) return active;
    if (this.state.phase !== "available") {
      return Promise.reject(this.invalidState("download an update"));
    }

    this.transition("downloading", { percent: 0, transferred: 0 });
    this.downloadEventReceived = false;
    this.downloadPromiseSettled = false;
    this.log("info", `downloading update ${this.details.availableVersion ?? "(unknown version)"}`);

    return this.operation.track("download", async () => {
      try {
        await this.downloadWithWatchdog();
        this.downloadPromiseSettled = true;
        if (this.downloadEventReceived && this.state.phase === "downloading") {
          this.finishDownloadedUpdate();
        }
      } catch (error) {
        if (this.state.phase !== "error") this.recordAdapterError(error, "download");
      }
      return this.getState();
    });
  }

  installUpdate(): Promise<void> {
    const unavailable = this.requireEnabled();
    if (unavailable) return Promise.reject(unavailable);

    const active = this.operation.reuseOrReject<void>("install");
    if (active) return active;
    if (this.state.phase !== "downloaded") {
      return Promise.reject(this.invalidState("install an update"));
    }
    if (this.runningSessionCount > 0) {
      return Promise.reject(
        new UpdateManagerError(
          "UPDATE_BUSY",
          "Active agent sessions must finish before the downloaded update can be installed.",
        ),
      );
    }

    return this.operation.track("install", async () => {
      this.transition("installing");
      this.log("info", `installing update ${this.details.availableVersion ?? "(unknown version)"}`);
      try {
        this.installLifecyclePrepared = true;
        await this.prepareToInstall();
        this.adapter!.quitAndInstall(false, true);
      } catch (error) {
        if (this.state.phase !== "error") this.recordAdapterError(error, "install");
        await this.recoverInstallLifecycle();
        const code = this.state.error?.code ?? classifyUpdateError(error, "install");
        throw new UpdateManagerError(code, ERROR_MESSAGES[code]);
      }
    });
  }

  setAutomaticChecksEnabled(enabled: boolean): DesktopUpdateState {
    if (this.disposed) return this.getState();
    this.state = { ...this.state, automaticChecksEnabled: enabled };
    this.emitState();
    if (enabled) {
      if (this.automaticChecksStarted) this.scheduleAutomaticCheck(this.initialCheckDelayMs);
    } else {
      this.cancelAutomaticTimer();
    }
    return this.getState();
  }

  startAutomaticChecks(): void {
    if (this.disposed || this.automaticChecksStarted) return;
    this.automaticChecksStarted = true;
    if (this.enabled && this.state.automaticChecksEnabled) {
      this.scheduleAutomaticCheck(this.initialCheckDelayMs);
    }
  }

  stopAutomaticChecks(): void {
    this.automaticChecksStarted = false;
    this.cancelAutomaticTimer();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDownloadWatchdog();
    if (this.operation.kind === "download") this.cancelAdapterDownload();
    this.stopAutomaticChecks();
    for (const remove of this.removeAdapterListeners.splice(0)) remove();
    this.listeners.clear();
  }

  private bindAdapterEvents(adapter: UpdateAdapter): void {
    this.removeAdapterListeners.push(
      adapter.on("checking-for-update", () => {
        if (this.disposed) return;
        this.details = {};
        this.transition("checking");
      }),
      adapter.on("update-not-available", () => {
        if (this.disposed) return;
        this.details = { checkedAt: this.now().toISOString() };
        this.transition("up-to-date");
        this.log("info", "application is up to date");
      }),
      adapter.on("update-available", (info) => {
        if (this.disposed) return;
        this.details = availableUpdateDetails(info, this.now().toISOString(), this.target);
        this.transition("available");
        this.log("info", `update available: ${this.details.availableVersion ?? "unknown"}`);
      }),
      adapter.on("download-progress", (progress) => {
        if (this.disposed || this.state.phase !== "downloading") return;
        this.armDownloadWatchdog();
        const percent = finiteNonNegative(progress.percent);
        this.transition("downloading", {
          percent: percent === undefined ? undefined : Math.min(100, percent),
          bytesPerSecond: finiteNonNegative(progress.bytesPerSecond),
          transferred: finiteNonNegative(progress.transferred),
          total: finiteNonNegative(progress.total),
        });
      }),
      adapter.on("update-downloaded", (info) => {
        if (this.disposed || !this.isPhase("available", "downloading")) return;
        this.details = downloadedUpdateDetails(info, this.details, this.target);
        this.downloadEventReceived = true;
        if (this.operation.kind !== "download" || this.downloadPromiseSettled) {
          this.finishDownloadedUpdate();
        }
      }),
      adapter.on("error", (error, message) => {
        if (this.disposed) return;
        const detail = message ? `${error.message}; ${message}` : error;
        const operation =
          this.operation.kind ??
          (this.state.phase === "installing" && this.installLifecyclePrepared ? "install" : undefined);
        this.recordAdapterError(detail, operation);
        if (operation === "download") {
          this.cancelAdapterDownload();
          this.rejectWatchedDownload?.(detail);
        }
        if (operation === "install") void this.recoverInstallLifecycle();
      }),
    );
  }

  private transition(
    phase: UpdatePhase,
    patch: Partial<Pick<DesktopUpdateState, "percent" | "bytesPerSecond" | "transferred" | "total">> = {},
  ): void {
    if (this.disposed) return;
    const retainDetails =
      phase === "available" || phase === "downloading" || phase === "downloaded" || phase === "installing";
    this.state = {
      phase,
      currentVersion: this.currentVersion,
      automaticChecksEnabled: this.state.automaticChecksEnabled,
      installBlockedByActiveSessions: this.runningSessionCount > 0,
      canRetry: false,
      ...(retainDetails ? this.details : phase === "up-to-date" ? { checkedAt: this.details.checkedAt } : {}),
      ...patch,
    };
    this.emitState();
  }

  private emitState(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(cloneState(state));
      } catch (error) {
        this.log("warn", `update state listener failed: ${redactUpdateError(error)}`);
      }
    }
  }

  private finishDownloadedUpdate(): void {
    if (this.disposed || !this.isPhase("available", "downloading")) return;
    this.transition("downloaded", { percent: 100 });
    this.log("info", `update downloaded: ${this.details.availableVersion ?? "unknown"}`);
  }

  private downloadWithWatchdog(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback: (value: unknown) => void, value: unknown) => {
        if (settled) return;
        settled = true;
        this.clearDownloadWatchdog();
        this.rejectWatchedDownload = null;
        callback(value);
      };
      this.rejectWatchedDownload = (error) => settle(reject, error);
      this.armDownloadWatchdog();
      let download: Promise<unknown>;
      try {
        download = this.adapter!.downloadUpdate();
      } catch (error) {
        settle(reject, error);
        return;
      }
      void download.then(
        (value) => settle(resolve, value),
        (error) => settle(reject, error),
      );
    });
  }

  private armDownloadWatchdog(): void {
    if (!this.rejectWatchedDownload) return;
    this.clearDownloadWatchdog();
    const generation = ++this.downloadWatchdogGeneration;
    this.downloadWatchdogTimer = this.setTimer(() => {
      if (generation !== this.downloadWatchdogGeneration) return;
      this.downloadWatchdogTimer = null;
      const reject = this.rejectWatchedDownload;
      if (!reject) return;
      this.log("warn", `update download made no progress for ${this.downloadWatchdogMs}ms; cancelling`);
      this.cancelAdapterDownload();
      reject(
        new UpdateManagerError(
          "UPDATE_DOWNLOAD_FAILED",
          `Update download timed out after ${this.downloadWatchdogMs}ms without progress.`,
        ),
      );
    }, this.downloadWatchdogMs);
    unrefTimer(this.downloadWatchdogTimer);
  }

  private clearDownloadWatchdog(): void {
    this.downloadWatchdogGeneration += 1;
    if (this.downloadWatchdogTimer === null) return;
    this.clearTimer(this.downloadWatchdogTimer);
    this.downloadWatchdogTimer = null;
  }

  private cancelAdapterDownload(): void {
    try {
      this.adapter?.cancelDownload?.();
    } catch (error) {
      this.log("warn", `update download cancellation failed: ${redactUpdateError(error)}`);
    }
  }

  private recoverInstallLifecycle(): Promise<void> {
    if (this.installRecoveryPromise) return this.installRecoveryPromise;
    if (!this.installLifecyclePrepared) return Promise.resolve();
    this.installLifecyclePrepared = false;
    const recovery = Promise.resolve()
      .then(() => this.recoverFromInstallFailure())
      .catch((error) => {
        this.log("error", `updater install recovery failed: ${redactUpdateError(error)}`);
      })
      .finally(() => {
        if (this.installRecoveryPromise === recovery) this.installRecoveryPromise = null;
      });
    this.installRecoveryPromise = recovery;
    return recovery;
  }

  private recordAdapterError(error: unknown, context?: UpdateOperation): void {
    const code = classifyUpdateError(error, context);
    const message = ERROR_MESSAGES[code];
    const detail = redactUpdateError(error);
    const duplicate = this.state.phase === "error" && this.state.error?.code === code;
    if (duplicate) return;
    this.state = {
      phase: "error",
      currentVersion: this.currentVersion,
      automaticChecksEnabled: this.state.automaticChecksEnabled,
      installBlockedByActiveSessions: this.runningSessionCount > 0,
      canRetry: code !== "UPDATE_SIGNATURE_INVALID" && code !== "UPDATE_UNSUPPORTED",
      error: { code, message },
    };
    this.emitState();
    this.log("error", `updater ${code}: ${detail}`);
  }

  private requireEnabled(): UpdateManagerError | null {
    if (this.enabled && this.adapter && !this.disposed) return null;
    return new UpdateManagerError("UPDATE_UNSUPPORTED", ERROR_MESSAGES.UPDATE_UNSUPPORTED);
  }

  private invalidState(action: string): UpdateManagerError {
    return new UpdateManagerError(
      "UPDATE_INVALID_STATE",
      `${ERROR_MESSAGES.UPDATE_INVALID_STATE} Cannot ${action} while phase is ${this.state.phase}.`,
    );
  }

  private isPhase(...phases: UpdatePhase[]): boolean {
    return phases.includes(this.state.phase);
  }

  private scheduleAutomaticCheck(delayMs: number): void {
    if (
      this.disposed ||
      !this.automaticChecksStarted ||
      !this.enabled ||
      !this.state.automaticChecksEnabled ||
      this.automaticTimer !== null
    ) {
      return;
    }
    this.automaticTimer = this.setTimer(() => {
      this.automaticTimer = null;
      const scheduleNext = () => {
        if (!this.disposed && this.automaticChecksStarted && this.state.automaticChecksEnabled) {
          const jitter = (this.random() * 2 - 1) * this.jitterRatio;
          this.scheduleAutomaticCheck(Math.round(this.checkIntervalMs * (1 + jitter)));
        }
      };
      if (!this.isPhase("idle", "up-to-date", "error")) {
        this.log("info", `automatic update check skipped while phase is ${this.state.phase}`);
        scheduleNext();
        return;
      }
      const check = this.checkForUpdates({ automatic: true });
      void check
        .catch((error) => {
          this.log("warn", `automatic update check was skipped: ${redactUpdateError(error)}`);
        })
        .finally(scheduleNext);
    }, delayMs);
    unrefTimer(this.automaticTimer);
  }

  private cancelAutomaticTimer(): void {
    if (this.automaticTimer === null) return;
    this.clearTimer(this.automaticTimer);
    this.automaticTimer = null;
  }
}

export function createUpdateManager(options: UpdateManagerOptions): UpdateManager {
  return new UpdateManager(options);
}
