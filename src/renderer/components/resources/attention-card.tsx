import type { ReactNode } from "react";
import type { PluginPackageInfo } from "@/lib/api-types";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { packageKey } from "../plugins/plugin-shared";
import { packageDisplayName } from "./overview-model";
import { TriangleAlertIcon } from "./overview-icons";

export function AttentionCard({
  packages,
  busyKey,
  error,
  children,
  onReinstall,
}: {
  packages: PluginPackageInfo[];
  busyKey: string | null;
  error: string | null;
  children?: ReactNode;
  onReinstall: (pkg: PluginPackageInfo) => void;
}) {
  const { t } = useI18n();
  if (packages.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-[12px]">
      <ul
        aria-label={t("resourcesAttention", "Needs attention")}
        className="m-0 flex w-full list-none flex-col overflow-hidden rounded-[var(--radius-resource-tile)] border border-solid border-[var(--fx-status-warning-border)] bg-[var(--fx-status-warning-soft)] p-0"
      >
        {packages.map((pkg, index) => {
          const busy = busyKey === `install:${packageKey(pkg)}`;
          return (
            <li
              key={packageKey(pkg)}
              className={`flex w-full items-center gap-[12px] py-[12px] pr-[12px] pl-[16px]${index > 0 ? " border-t border-solid border-[var(--fx-status-warning-border)]" : ""}`}
            >
              <TriangleAlertIcon size={16} className="text-[var(--fx-status-warning)]" />
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="type-body-medium text-[var(--fx-text-primary)]">
                  {t("resourcesMissingTitle", "{name} can't be found").replace("{name}", packageDisplayName(pkg))}
                </span>
                <span className="type-label-default text-[var(--fx-text-secondary)]">
                  {t(
                    "resourcesMissingDescription",
                    "Its install folder was deleted, so what it provides is unavailable for now.",
                  )}
                </span>
              </div>
              <Button busy={busy} disabled={busyKey !== null} onClick={() => onReinstall(pkg)}>
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
