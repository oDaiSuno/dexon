import type { PublicToolchainState } from "@shared/toolchains/types";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { RefreshIcon } from "./icons";
import { LogoTile, Notice, SectionHeader } from "./section-parts";
import {
  TOOL_CATEGORIES,
  countedCapabilities,
  healthTone,
  toneBorderColor,
  toneColor,
  toneTextColor,
  type ToolCategoryId,
  type Translate,
} from "./shared";

export function OverviewSection({
  state,
  failed,
  actionError,
  rescanPending,
  isMobile,
  onRescan,
}: {
  state: PublicToolchainState | null;
  failed: boolean;
  actionError: string | null;
  rescanPending: boolean;
  isMobile: boolean;
  onRescan: () => void;
}) {
  const { language, t } = useI18n();
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <SectionHeader title={t("toolOverview", "Environment overview")}>
        <span
          role="status"
          aria-live="polite"
          className="type-mono-label"
          title={
            state?.lastScanAt
              ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(state.lastScanAt),
                )
              : undefined
          }
          style={{ flex: 1, minWidth: 0, textAlign: "right", color: "var(--fx-text-tertiary)" }}
        >
          {rescanPending ? "" : scanStatus(state, language, t)}
        </span>
        <Button variant="ghost" disabled={rescanPending} busy={rescanPending} onClick={onRescan}>
          <RefreshIcon />
          {rescanPending ? t("rescanningTools", "Scanning…") : t("rescanTools", "Rescan")}
        </Button>
      </SectionHeader>
      {(failed || actionError) && (
        <Notice tone="danger">
          {actionError ??
            t("toolDiscoveryFailed", "Tool discovery failed. Existing selections were not changed; try rescanning.")}
        </Notice>
      )}
      {state?.stateReadOnly && (
        <Notice tone="warning">
          {t(
            "toolStateReadOnly",
            "These tool settings were written by a newer Pi Desktop. This version will not modify or delete them.",
          )}
        </Notice>
      )}
      {state && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(3, minmax(0, 1fr))",
            gap: "var(--space-3)",
          }}
        >
          {TOOL_CATEGORIES.map((category) => (
            <CategoryCard key={category.id} category={category.id} state={state} t={t} />
          ))}
        </div>
      )}
      {state?.projectSummary?.length ? (
        <div style={{ display: "grid", gap: 2 }}>
          <div className="type-label-medium" style={{ color: "var(--fx-text-secondary)" }}>
            {t("toolProjectRequirements", "Current project")}
          </div>
          {state.projectSummary.map((line) => (
            <div key={line} className="type-mono-label" style={{ color: "var(--fx-text-tertiary)" }}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CategoryCard({ category, state, t }: { category: ToolCategoryId; state: PublicToolchainState; t: Translate }) {
  const capabilities = countedCapabilities(TOOL_CATEGORIES.find((entry) => entry.id === category)!.capabilities, state);
  const tones = capabilities.map((capability) => healthTone(state.capabilities[capability]?.health ?? "missing"));
  const ready = tones.filter((tone) => tone === "success").length;
  const danger = tones.filter((tone) => tone === "danger").length;
  const warning = tones.filter((tone) => tone === "warning").length;
  const tone = danger ? "danger" : warning ? "warning" : "success";
  const summary = danger
    ? t("toolCountMissing", "{count} missing").replace("{count}", String(danger))
    : warning
      ? t("toolCountCheck", "{count} to check").replace("{count}", String(warning))
      : t("toolCountAllGood", "All good");
  return (
    <div
      style={{
        display: "grid",
        alignContent: "start",
        gap: "var(--space-3-5)",
        padding: "var(--space-4)",
        border: `1px solid ${tone === "success" ? "var(--fx-line-default)" : toneBorderColor(tone)}`,
        borderRadius: "var(--radius-menu)",
        background: "var(--fx-surface-raised)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <LogoTile category={category} size="small" />
        <span className="type-body-large-medium" style={{ color: "var(--fx-text-primary)" }}>
          {categoryTitle(category, t)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
        <span className="type-title-hero" style={{ color: "var(--fx-text-primary)" }}>
          {ready}
        </span>
        <span className="type-body-large" style={{ color: "var(--fx-text-tertiary)" }}>
          / {capabilities.length}
        </span>
        <span
          className="type-label-default"
          style={{
            flex: 1,
            textAlign: "right",
            color: tone === "success" ? "var(--fx-text-secondary)" : toneTextColor(tone),
          }}
        >
          {summary}
        </span>
      </div>
      <div aria-hidden="true" style={{ display: "flex", gap: 3 }}>
        {tones.map((barTone, index) => (
          <span
            key={capabilities[index]}
            style={{ flex: 1, height: 4, borderRadius: 2, background: toneColor(barTone) }}
          />
        ))}
      </div>
    </div>
  );
}

export function categoryTitle(category: ToolCategoryId, t: Translate, short = false): string {
  switch (category) {
    case "javascript":
      return t("toolGroupJavaScript", "JavaScript");
    case "python":
      return t("toolGroupPython", "Python");
    case "cli":
      return short ? t("toolGroupCliShort", "Command line") : t("toolGroupCli", "Command line tools");
  }
}

function scanStatus(state: PublicToolchainState | null, language: string, t: Translate): string {
  if (!state) return t("toolCategoryScanning", "Scanning…");
  if (!state.coreReady) return t("toolDiscoveryStarting", "Tool discovery is starting…");
  if (!state.lastScanAt) return "";
  const scannedAt = new Date(state.lastScanAt);
  const minutes = Math.max(0, Math.floor((Date.now() - scannedAt.getTime()) / 60_000));
  if (minutes < 1) return t("toolScannedJustNow", "Scanned just now");
  if (minutes < 60) return t("toolScannedMinutesAgo", "Scanned {count} min ago").replace("{count}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("toolScannedHoursAgo", "Scanned {count} h ago").replace("{count}", String(hours));
  const days = Math.floor(hours / 24);
  if (days < 7) return t("toolScannedDaysAgo", "Scanned {count} d ago").replace("{count}", String(days));
  return t("toolScannedOn", "Scanned {date}").replace(
    "{date}",
    new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(scannedAt),
  );
}
