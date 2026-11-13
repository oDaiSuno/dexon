import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { HostManager } from "./host-manager";
import type { UpdateManager } from "./update-manager";
import type { ToolchainSnapshot } from "../shared/toolchains/types";
import { hostSelfCheckFailures, type HostSelfCheckReport } from "../shared/host-self-check";
import { appendMainLog } from "./logger";

const STARTUP_TIMEOUT_MS = 45_000;
const SELF_CHECK_RPC_TIMEOUT_MS = 100_000;
const SELF_CHECK_TIMER_MS = SELF_CHECK_RPC_TIMEOUT_MS + 5_000;

export class PackagedStartupValidation {
  rendererReady = false;
  hostReady = false;
  toolchainSnapshot: ToolchainSnapshot | null = null;
  private phase: "waiting" | "probing" | "finished" = "waiting";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: {
    enabled: boolean;
    expectedPiVersion?: string;
    getHostManager: () => HostManager | null;
    getUpdateManager: () => UpdateManager | null;
    managedProcessSupported: () => boolean;
    setQuitting: (value: boolean) => void;
  };

  constructor(options: PackagedStartupValidation["options"]) {
    this.options = options;
  }

  start(): void {
    if (!this.options.enabled || this.phase !== "waiting" || this.timer) return;
    this.timer = setTimeout(() => this.finish("Packaged startup validation timed out"), STARTUP_TIMEOUT_MS);
  }

  finish(error?: string): void {
    if (!this.options.enabled || this.phase === "finished") return;
    if (error) {
      this.complete(error);
      return;
    }
    if (this.phase !== "waiting") return;
    const snapshot = this.toolchainSnapshot;
    const host = this.options.getHostManager();
    if (!this.rendererReady || !this.hostReady || !snapshot?.publicState.coreReady || !host) return;
    if (!this.options.expectedPiVersion || host.getPiVersion() !== this.options.expectedPiVersion) {
      this.complete(
        `Agent Host Pi version mismatch: expected ${this.options.expectedPiVersion ?? "unknown"}, got ${host.getPiVersion() ?? "unknown"}`,
      );
      return;
    }
    if (host.getToolchainAckRevision() < snapshot.revision) return;
    for (const capability of ["search.rg", "search.fd"] as const) {
      const candidates = snapshot.publicState.capabilities[capability]?.candidates ?? [];
      if (!candidates.some((candidate) => candidate.provider === "bundled" && candidate.health === "healthy")) return;
    }
    this.phase = "probing";
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.complete("Host self-check timed out"), SELF_CHECK_TIMER_MS);
    void host.call<HostSelfCheckReport>("host.selfCheck", undefined, SELF_CHECK_RPC_TIMEOUT_MS).then(
      (selfCheck) => {
        const failures = hostSelfCheckFailures(selfCheck, {
          offline: false,
          managedProcessSupported: this.options.managedProcessSupported(),
        });
        this.complete(failures.length ? failures.join("; ") : undefined, selfCheck);
      },
      (cause) => this.complete(cause instanceof Error ? cause.message : String(cause)),
    );
  }

  private complete(error?: string, selfCheck?: HostSelfCheckReport): void {
    if (this.phase === "finished") return;
    this.phase = "finished";
    if (this.timer) clearTimeout(this.timer);
    try {
      const report = error
        ? { ok: false, error, selfCheck }
        : {
            ok: true,
            appVersion: app.getVersion(),
            piVersion: this.options.getHostManager()?.getPiVersion(),
            platformArch: `${process.platform}-${process.arch}`,
            revision: this.toolchainSnapshot?.revision,
            rendererReady: this.rendererReady,
            hostReady: this.hostReady,
            hostAckRevision: this.options.getHostManager()?.getToolchainAckRevision(),
            bundledSearch: ["search.rg", "search.fd"],
            selfCheck,
          };
      fs.mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(app.getPath("userData"), "packaged-startup-check.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    } catch (writeError) {
      error ??= writeError instanceof Error ? writeError.message : "Could not write packaged startup report";
    }
    this.options.setQuitting(true);
    this.options.getUpdateManager()?.stopAutomaticChecks();
    const exitCode = error ? 1 : 0;
    void (async () => {
      try {
        await this.options.getHostManager()?.stop();
      } catch (stopError) {
        appendMainLog(
          `packaged startup host shutdown failed: ${stopError instanceof Error ? stopError.message : String(stopError)}`,
        );
      } finally {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
        app.exit(exitCode);
      }
    })();
  }
}
