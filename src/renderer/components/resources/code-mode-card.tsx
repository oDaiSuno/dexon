import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { useId } from "react";
import { useI18n } from "@/i18n";
import type { CodemodeSettingsController } from "@/lib/codemode-settings";
import { CodeModeIcon, CodeModeToggle } from "./code-mode-shared";

export function CodeModeCard({
  environmentId,
  controller,
  onOpen,
}: {
  environmentId: EnvironmentId;
  controller: CodemodeSettingsController;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const descriptionId = useId();
  const statusId = useId();
  const { state, settings } = controller;
  const remote = environmentId !== PRIMARY_ENVIRONMENT_ID;
  const loading = state === "loading";
  const available = state === "ready" && settings?.availability.available;
  const enabled = Boolean(available && settings?.enabled);
  const status = loading
    ? remote
      ? t("codemodeLoadingRemote", "Fetching remote settings…")
      : t("codemodeLoading", "Loading…")
    : state === "error"
      ? t("codemodeLoadFailed", "Couldn't load settings")
      : !available
        ? remote
          ? t("codemodeUpdateRemote", "Remote service update needed")
          : t("codemodeUnavailable", "Unavailable in this environment")
        : !enabled
          ? t("codemodeDisabled", "Not enabled")
          : settings?.mode === "only"
            ? t("codemodeOnlyStatus", "Script-only mode")
            : t("codemodeCoexistStatus", "Coexist mode");

  return (
    <div className="relative flex w-full min-w-0 items-center gap-[16px] rounded-[var(--radius-resource-card)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)] p-[16px] transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:bg-[var(--fx-surface-raised-hover)] motion-reduce:transition-none">
      <button
        type="button"
        aria-label={t("codemodeTitle", "Code Mode")}
        aria-describedby={`${statusId} ${descriptionId}`}
        onClick={onOpen}
        className="absolute inset-0 cursor-pointer rounded-[var(--radius-resource-card)] border-0 bg-[var(--fx-surface-hover-clear)]"
      />
      <CodeModeIcon active={enabled} />
      <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex h-[20px] min-w-0 items-center gap-[8px]">
          <span className="type-body-large-medium shrink-0 text-[var(--fx-text-primary)]">
            {t("codemodeTitle", "Code Mode")}
          </span>
          <span
            id={statusId}
            role="status"
            className={`flex h-[20px] min-w-0 items-center gap-[6px] ${
              enabled && settings?.mode === "only"
                ? "type-mono-meta rounded-[var(--radius-segment)] bg-[var(--fx-accent-blue-soft)] px-[6px] text-[var(--fx-accent-blue-text)]"
                : "type-label-default text-[var(--fx-text-secondary)]"
            }`}
          >
            {loading ? (
              <LoaderCircle size={12} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
            ) : !available ? (
              <span
                aria-hidden="true"
                className="size-[6px] shrink-0 rounded-[var(--radius-pill)] bg-[var(--fx-status-warning)]"
              />
            ) : !enabled ? (
              <span aria-hidden="true">•</span>
            ) : null}
            <span className="truncate">{status}</span>
          </span>
        </span>
        <span id={descriptionId} className="type-body-default truncate text-[var(--fx-text-secondary)]">
          {t(
            "codemodeCardDescription",
            "Let AI run scripts in an isolated sandbox to call tools in parallel or sequence",
          )}
        </span>
      </span>
      <span className="pointer-events-none relative flex shrink-0 items-center gap-[12px]">
        {available || loading ? (
          <CodeModeToggle controller={controller} />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="type-label-medium pointer-events-auto cursor-pointer border-0 bg-[var(--fx-surface-hover-clear)] p-0 text-[var(--fx-status-warning-text)]"
          >
            {t("codemodeViewReason", "View reason")}
          </button>
        )}
        <ChevronRight size={15} aria-hidden="true" className="pointer-events-none text-[var(--fx-text-tertiary)]" />
      </span>
    </div>
  );
}
