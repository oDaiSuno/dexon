import type { ReactNode } from "react";
import type { PluginPackageInfo } from "@/lib/api-types";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { packageKey } from "../plugins/plugin-shared";
import { packageDisplayName } from "./overview-model";
import { RefreshCwIcon, TriangleAlertIcon } from "./overview-icons";

export function AttentionCard({
  updated,
  missing,
  busyKey,
  error,
  canReload,
  children,
  onReinstall,
  onReload,
}: {
  updated: PluginPackageInfo[];
  missing: PluginPackageInfo[];
  busyKey: string | null;
  error: string | null;
  canReload: boolean;
  children?: ReactNode;
  onReinstall: (pkg: PluginPackageInfo) => void;
  onReload: () => void;
}) {
  const { t } = useI18n();
  if (updated.length === 0 && missing.length === 0) return null;
  const rows = [
    ...updated.map((pkg) => ({ key: `updated:${packageKey(pkg)}`, pkg, kind: "updated" as const })),
    ...missing.map((pkg) => ({ key: `missing:${packageKey(pkg)}`, pkg, kind: "missing" as const })),
  ];
  return (
    <div className="flex w-full flex-col gap-[12px]">
      <ul
        role="list"
        aria-label={t("resourcesAttention", "Needs attention")}
        className="m-0 flex w-full list-none flex-col overflow-hidden rounded-[var(--radius-resource-tile)] border border-solid border-[var(--fx-status-warning-border)] bg-[var(--fx-status-warning-soft)] p-0"
      >
        {rows.map((row, index) => {
          const divider = index > 0 ? " border-t border-solid border-[var(--fx-status-warning-border)]" : "";
          if (row.kind === "updated") {
            const busy = busyKey === "reload";
            return (
              <li
                key={row.key}
                className={`flex w-full items-center gap-[12px] py-[12px] pr-[12px] pl-[16px]${divider}`}
              >
                <RefreshCwIcon size={16} className="text-[var(--fx-status-warning)]" />
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="type-body-medium text-[var(--fx-text-primary)]">
                    {t("resourcesUpdatedTitle", "{name} updated to {version}")
                      .replace("{name}", packageDisplayName(row.pkg))
                      .replace("{version}", row.pkg.pendingReloadVersion ?? "")}
                  </span>
                  <span className="type-label-default text-[var(--fx-text-secondary)]">
                    {t("resourcesUpdatedDescription", "Takes effect after you reload the current session.")}
                  </span>
                </div>
                <Button
                  busy={busy}
                  disabled={!canReload || busyKey !== null}
                  title={
                    canReload
                      ? t("pluginReloadCurrentSession", "Reload current session")
                      : t("pluginOpenSessionToReload", "Open a session to reload")
                  }
                  onClick={onReload}
                >
                  {busy ? t("pluginReloading", "Reloading…") : t("pluginReloadSession", "Reload session")}
                </Button>
              </li>
            );
          }
          const busy = busyKey === `install:${packageKey(row.pkg)}`;
          return (
            <li key={row.key} className={`flex w-full items-center gap-[12px] py-[12px] pr-[12px] pl-[16px]${divider}`}>
              <TriangleAlertIcon size={16} className="text-[var(--fx-status-warning)]" />
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="type-body-medium text-[var(--fx-text-primary)]">
                  {t("resourcesMissingTitle", "{name} can't be found").replace("{name}", packageDisplayName(row.pkg))}
                </span>
                <span className="type-label-default text-[var(--fx-text-secondary)]">
                  {t(
                    "resourcesMissingDescription",
                    "Its install folder was deleted, so what it provides is unavailable for now.",
                  )}
                </span>
              </div>
              <Button busy={busy} disabled={busyKey !== null} onClick={() => onReinstall(row.pkg)}>
                {busy ? t("resourcesReinstalling", "Reinstalling…") : t("resourcesReinstall", "Reinstall")}
              </Button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="type-label-default m-0 text-[var(--fx-status-danger)]">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
