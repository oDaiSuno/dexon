import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { HostManager } from "./host-manager";
import type { UpdateManager } from "./update-manager";
import type { ToolchainSnapshot } from "../shared/toolchains/types";
import { appendMainLog } from "./logger";
export class PackagedStartupValidation {
  rendererReady = false;
  hostReady = false;
  toolchainSnapshot: ToolchainSnapshot | null = null;
  private finished = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: {
    enabled: boolean;
    expectedPiVersion?: string;
    getHostManager: () => HostManager | null;
    getUpdateManager: () => UpdateManager | null;
    setQuitting: (value: boolean) => void;
  };
  constructor(options: PackagedStartupValidation["options"]) {
    this.options = options;
  }
  start(): void {
    this.timer = setTimeout(() => this.finish("Packaged startup validation timed out"), 45000);
  }
  finish(error?: string): void {
    if (!this.options.enabled || this.finished) return;
    if (!error) {
      const snapshot = this.toolchainSnapshot;
      if (!this.rendererReady || !this.hostReady || !snapshot?.publicState.coreReady) return;
      if (
        !this.options.expectedPiVersion ||
        this.options.getHostManager()?.getPiVersion() !== this.options.expectedPiVersion
      ) {
        error = `Agent Host Pi version mismatch: expected ${this.options.expectedPiVersion ?? "unknown"}, got ${this.options.getHostManager()?.getPiVersion() ?? "unknown"}`;
      }
      if ((this.options.getHostManager()?.getToolchainAckRevision() ?? -1) < snapshot.revision) return;
      for (const capability of ["search.rg", "search.fd"] as const) {
        const candidates = snapshot.publicState.capabilities[capability]?.candidates ?? [];
        if (!candidates.some((candidate) => candidate.provider === "bundled" && candidate.health === "healthy")) return;
      }
    }

    this.finished = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      const report = error
        ? { ok: false, error }
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
