import { Code2, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Toggle } from "../form-controls";
import type { CodemodeSettingsController } from "@/lib/codemode-settings";

export function CodeModeIcon({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none flex size-[40px] shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-solid ${
        active
          ? "border-[var(--fx-accent-blue-border)] bg-[var(--fx-accent-blue-soft)] text-[var(--fx-accent-blue-text)]"
          : "border-[var(--fx-line-default)] bg-[var(--fx-surface-card)] text-[var(--fx-text-secondary)]"
      }`}
    >
      <Code2 size={18} strokeWidth={1.75} />
    </span>
  );
}

export function CodeModeToggle({ controller }: { controller: CodemodeSettingsController }) {
  const { t } = useI18n();
  return (
    <Toggle
      className="pointer-events-auto"
      aria-label={t("codemodeToggle", "Enable Code Mode")}
      checked={
        controller.state === "ready" &&
        Boolean(controller.settings?.availability.available && controller.settings.enabled)
      }
      disabled={controller.state !== "ready" || !controller.settings?.availability.available || controller.saving}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => void controller.toggleEnabled(event.target.checked)}
    />
  );
}

export function CodeModeError({ controller }: { controller: CodemodeSettingsController }) {
  const { t } = useI18n();
  if (!controller.errorMessage) return null;
  return (
    <div
      role="alert"
      className="type-body-default flex items-center gap-[8px] rounded-[var(--radius-control)] bg-[var(--fx-status-danger-soft)] px-[12px] py-[8px] text-[var(--fx-status-danger-text)]"
    >
      <span className="min-w-0 flex-1 break-words">
        {t("codemodeRequestFailed", "Couldn't update Code Mode: {message}").replace(
          "{message}",
          controller.errorMessage,
        )}
      </span>
      <Button
        variant="ghost"
        aria-label={t("codemodeDismissError", "Dismiss error")}
        className="size-[28px] shrink-0 px-0"
        onClick={controller.dismissError}
      >
        <X size={14} aria-hidden="true" />
      </Button>
    </div>
  );
}
