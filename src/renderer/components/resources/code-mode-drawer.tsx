import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import type { CodemodeMode, CodemodeSettingsResult } from "@contract/types";
import { Check, Copy, Info, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { CodemodeSettingsController } from "@/lib/codemode-settings";
import { Button } from "../form-controls";
import { CodeModeError, CodeModeIcon, CodeModeToggle } from "./code-mode-shared";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CodeModeDrawer({
  environmentId,
  environmentLabel,
  controller,
  onClose,
  onOpenFile,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  controller: CodemodeSettingsController;
  onClose: () => void;
  onOpenFile?: (filePath: string, environmentId: EnvironmentId) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [openedEnvironment] = useState(environmentId);
  const [entered, setEntered] = useState(false);
  const remote = environmentId !== PRIMARY_ENVIRONMENT_ID;
  const available = controller.state === "ready" && Boolean(controller.settings?.availability.available);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const returnFocus = returnFocusRef.current;
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (openedEnvironment !== environmentId) onClose();
  }, [openedEnvironment, environmentId, onClose]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !element.matches(":disabled") && !element.closest('[hidden], [inert], [aria-hidden="true"]'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      panel.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
      event.preventDefault();
      first.focus();
    }
  }

  if (openedEnvironment !== environmentId) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[1000] flex justify-end bg-[var(--fx-surface-scrim)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`flex h-full w-[480px] max-w-full flex-col border-0 border-l border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-main)] shadow-[var(--shadow-dialog)] outline-none transition-transform duration-[var(--duration-glide)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none ${entered ? "translate-x-0" : "translate-x-[100%]"}`}
      >
        <header className="flex shrink-0 items-center gap-[12px] border-0 border-b border-solid border-[var(--fx-line-subtle)] p-[20px] pl-[24px]">
          <CodeModeIcon active={available && Boolean(controller.settings?.enabled)} />
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 id={titleId} className="type-title-dialog m-0 truncate text-[var(--fx-text-primary)]">
              {t("codemodeTitle", "Code Mode")}
            </h2>
            <div className="type-meta-default flex min-w-0 items-center gap-[6px] text-[var(--fx-text-tertiary)]">
              <span className="shrink-0">
                {remote
                  ? t("codemodeRemoteScope", "Built-in plugin · Remote")
                  : t("codemodeLocalScope", "Built-in plugin · This computer")}
              </span>
              {remote && (
                <span
                  className={`type-mono-meta truncate rounded-[var(--radius-chip)] px-[6px] py-[1px] ${available ? "bg-[var(--fx-accent-blue-soft)] text-[var(--fx-accent-blue-text)]" : "bg-[var(--fx-surface-subtle)] text-[var(--fx-text-secondary)]"}`}
                  title={environmentLabel}
                >
                  • {environmentLabel}
                </span>
              )}
            </div>
          </div>
          <CodeModeToggle controller={controller} />
          <button
            ref={closeRef}
            type="button"
            className="ui-button type-body-medium size-[32px] shrink-0 px-0"
            data-variant="ghost"
            aria-label={t("close", "Close")}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto p-[24px]">
          <p className="type-body-relaxed m-0 text-[var(--fx-text-body)]">
            {t(
              "codemodeIntro",
              "Allow AI to write and run scripts in an isolated sandbox, calling multiple tools in sequence or parallel to reduce back-and-forth waiting.",
            )}
          </p>
          <CodeModeError controller={controller} />
          {controller.state === "loading" ? (
            <div
              role="status"
              className="type-body-default flex items-center gap-[8px] text-[var(--fx-text-secondary)]"
            >
              <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              {remote ? t("codemodeLoadingRemote", "Fetching remote settings…") : t("codemodeLoading", "Loading…")}
            </div>
          ) : controller.state === "error" ? (
            <div className="flex flex-col items-start gap-[12px]">
              <p className="type-body-medium m-0 text-[var(--fx-text-primary)]">
                {t("codemodeConnectionError", "Unable to connect to this environment")}
              </p>
              <p className="type-body-default m-0 text-[var(--fx-text-secondary)]">
                {t(
                  "codemodeConnectionHint",
                  "Check the connection, then try again. Your saved settings have not been changed.",
                )}
              </p>
              <Recheck controller={controller} />
            </div>
          ) : !available ? (
            <Unavailable remote={remote} controller={controller} />
          ) : controller.settings ? (
            <Available
              environmentId={environmentId}
              environmentLabel={environmentLabel}
              controller={controller}
              settings={controller.settings}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Recheck({ controller }: { controller: CodemodeSettingsController }) {
  const { t } = useI18n();
  return (
    <Button disabled={controller.saving} onClick={() => void controller.reload()}>
      <RefreshCw size={14} aria-hidden="true" />
      {t("codemodeRecheck", "Check again")}
    </Button>
  );
}

function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-[12px] border-0 border-b border-solid border-[var(--fx-line-subtle)] py-[11px] last:border-b-0">
      <dt className="type-label-default w-[84px] shrink-0 text-[var(--fx-text-tertiary)]">{label}</dt>
      <dd className="type-label-default m-0 min-w-0 flex-1 text-[var(--fx-text-secondary)]">{children}</dd>
    </div>
  );
}

function Unavailable({ remote, controller }: { remote: boolean; controller: CodemodeSettingsController }) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex items-start gap-[10px] rounded-[var(--radius-card)] bg-[var(--fx-status-warning-soft)] p-[16px] text-[var(--fx-status-warning-text)]">
        <TriangleAlert size={16} aria-hidden="true" className="mt-[2px] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-[10px]">
          <h3 className="type-body-medium m-0">
            {remote
              ? t("codemodeUnsupportedRemoteTitle", "This server doesn't support Code Mode yet")
              : t("codemodeUnsupportedLocalTitle", "This environment doesn't support Code Mode yet")}
          </h3>
          <p className="type-body-relaxed m-0">
            {remote
              ? t(
                  "codemodeUnsupportedRemoteBody",
                  "The remote service is outdated or missing the runtime sandbox. Update and reconnect to enable Code Mode.",
                )
              : t(
                  "codemodeUnsupportedLocalBody",
                  "The runtime sandbox component was not detected. Check that the app is fully installed, then try again.",
                )}
          </p>
          <Recheck controller={controller} />
        </div>
      </div>
      <dl className="m-0">
        <MetadataRow label={t("codemodeCurrentStatus", "Current status")}>
          {t("codemodeSandboxMissing", "No sandbox detected; this capability will not be offered to the model")}
        </MetadataRow>
        <MetadataRow label={t("codemodeTroubleshoot", "Troubleshooting")}>
          {remote
            ? t("codemodeTroubleshootRemote", "Update the remote service, then click “Check again” above")
            : t("codemodeTroubleshootLocal", "Check the app installation, then click “Check again” above")}
        </MetadataRow>
      </dl>
    </>
  );
}

function Available({
  environmentId,
  environmentLabel,
  controller,
  settings,
  onOpenFile,
}: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  controller: CodemodeSettingsController;
  settings: CodemodeSettingsResult;
  onOpenFile?: (filePath: string, environmentId: EnvironmentId) => void;
}) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const modeGroup = useId();
  const remote = environmentId !== PRIMARY_ENVIRONMENT_ID;
  const override = settings.projectOverride;

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [copyState]);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(settings.configPath);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  const modes: { value: CodemodeMode; title: string; description: string }[] = [
    {
      value: "on",
      title: t("codemodeCoexistTitle", "Coexist with regular tools"),
      description: t(
        "codemodeCoexistDescription",
        "Use tools directly for simple reads and writes, and scripts for batch processing or filtering data. Reliable and fast.",
      ),
    },
    {
      value: "only",
      title: t("codemodeOnlyTitle", "Call tools only through scripts · Experimental"),
      description: t(
        "codemodeOnlyDescription",
        "Run everything through scripts to save context when many tools are available. Suited to complex tasks and capable models.",
      ),
    },
  ];

  return (
    <>
      {settings.enabled ? (
        <>
          {override && (
            <div className="flex flex-col items-start gap-[8px] rounded-[var(--radius-card)] bg-[var(--fx-status-warning-soft)] p-[14px] text-[var(--fx-status-warning-text)]">
              <p className="type-body-default m-0">
                {t(
                  "codemodeOverrideWarning",
                  "The open project overrides the global settings. Changes here won't apply to that project yet.",
                )}
              </p>
              {onOpenFile && (
                <Button
                  variant="ghost"
                  className="h-auto px-0 text-[var(--fx-accent-blue-text)]"
                  onClick={() => onOpenFile(override.filePath, environmentId)}
                >
                  {t("codemodeOpenProjectConfig", "Open project settings →")}
                </Button>
              )}
            </div>
          )}
          <fieldset disabled={controller.saving} className="m-0 min-w-0 border-0 p-0">
            <legend className="type-label-medium mb-[8px] p-0 text-[var(--fx-text-secondary)]">
              {t("codemodeRunMode", "Execution mode")}
            </legend>
            <div className="overflow-hidden rounded-[var(--radius-menu)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-card)]">
              {modes.map((mode) => (
                <label
                  key={mode.value}
                  className={`flex cursor-pointer items-start gap-[12px] border-0 border-t border-solid border-[var(--fx-line-subtle)] px-[16px] py-[14px] first:border-t-0 ${settings.mode === mode.value ? "bg-[var(--fx-accent-blue-soft)]" : "bg-[var(--fx-surface-hover-clear)]"}`}
                >
                  <input
                    type="radio"
                    name={modeGroup}
                    value={mode.value}
                    checked={settings.mode === mode.value}
                    onChange={() => void controller.setMode(mode.value)}
                    className="mt-[2px] size-[16px] shrink-0 accent-[var(--fx-accent-blue-fill)]"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
                    <span className="type-body-medium flex flex-wrap items-center gap-[8px] text-[var(--fx-text-primary)]">
                      {mode.title}
                      {mode.value === "on" && (
                        <span className="type-meta-default rounded-[var(--radius-chip)] bg-[var(--fx-surface-raised)] px-[6px] py-[2px] text-[var(--fx-text-secondary)]">
                          {t("codemodeRecommended", "Recommended")}
                        </span>
                      )}
                    </span>
                    <span className="type-label-default text-[var(--fx-text-secondary)]">{mode.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ) : (
        <div className="type-label-default flex items-start gap-[10px] rounded-[var(--radius-card)] bg-[var(--fx-surface-inset)] px-[16px] py-[14px] text-[var(--fx-text-secondary)]">
          <Info size={16} aria-hidden="true" className="mt-[2px] shrink-0" />
          {t(
            "codemodeDisabledHint",
            "Turn on the switch at the top right to choose “Coexist with regular tools” or “Call tools only through scripts”.",
          )}
        </div>
      )}
      <dl className="m-0">
        <MetadataRow
          label={remote ? t("codemodeEffectiveScope", "Applies to") : t("codemodeEffectiveWhen", "Takes effect")}
        >
          {remote
            ? t("codemodeRemoteScopeDetail", "Only {environmentLabel}; shared with the command line").replace(
                "{environmentLabel}",
                environmentLabel,
              )
            : settings.enabled
              ? t("codemodeEffectiveNext", "From the next message; automated tasks are unaffected")
              : t(
                  "codemodeEffectiveAfterEnable",
                  "After enabling, from the next message; automated tasks are unaffected",
                )}
        </MetadataRow>
        <MetadataRow label={t("codemodeConfigFile", "Configuration file")}>
          <span className="flex min-w-0 items-center gap-[8px]">
            <span className="type-mono-label min-w-0 flex-1 break-all">{settings.configPath}</span>
            <Button
              variant="ghost"
              className="size-[28px] shrink-0 px-0"
              aria-label={t("codemodeCopyPath", "Copy configuration path")}
              onClick={() => void copyPath()}
            >
              {copyState === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </Button>
          </span>
          {copyState !== "idle" && (
            <span role="status">
              {copyState === "copied"
                ? t("codemodeConfigCopied", "Copied")
                : t("codemodeConfigCopyFailed", "Couldn't copy the path")}
            </span>
          )}
        </MetadataRow>
      </dl>
    </>
  );
}
