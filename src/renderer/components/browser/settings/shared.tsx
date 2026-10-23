import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { useI18n } from "@/i18n";
import type {
  BrowserHeaderRule,
  BrowserProfileInfo,
  BrowserRendererState,
  BrowserSettingsPatch,
} from "../../../../contract/browser";
import { Button, NativeSelect, Toggle } from "../../form-controls";
import { SettingRow, toggleHitAreaStyle } from "../../settings/setting-row";

export type Translate = ReturnType<typeof useI18n>["t"];
export type BrowserSettingsData = BrowserRendererState["settings"]["settings"];

export type BrowserSettingsModel = {
  state: BrowserRendererState;
  settings: BrowserSettingsData;
  advancedEnabled: boolean;
  update: (patch: BrowserSettingsPatch) => Promise<void>;
  setState: (next: BrowserRendererState) => void;
  setError: (message: string) => void;
  report: (cause: unknown) => void;
  refresh: () => Promise<void>;
  run: (task: () => Promise<unknown>) => void;
};

export function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1_024 * 1_024) return `${Math.round(value / 1_024)} KiB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MiB`;
}

export function withSettings<K extends "navigation" | "proxy" | "advancedBrowserMode">(
  state: BrowserRendererState,
  key: K,
  patch: Partial<BrowserSettingsData[K]>,
): BrowserRendererState {
  const settings = state.settings.settings;
  return {
    ...state,
    settings: { ...state.settings, settings: { ...settings, [key]: { ...settings[key], ...patch } } },
  };
}

export function profileModeLabel(t: Translate, mode: BrowserProfileInfo["mode"]): string {
  switch (mode) {
    case "persistent":
      return t("browserModePersistent", "persistent");
    case "unsafe":
      return t("browserModeAdvanced", "advanced");
    default:
      return t("browserModeEphemeral", "temporary");
  }
}

export function permissionLabel(t: Translate, permission: "none" | "read" | "interact" | "advanced"): string {
  switch (permission) {
    case "read":
      return t("browserPermissionRead", "Read");
    case "interact":
      return t("browserPermissionInteract", "Interact");
    case "advanced":
      return t("browserPermissionAdvanced", "Advanced Browser Mode");
    default:
      return t("browserPermissionNone", "None");
  }
}

export function proxyModeLabel(t: Translate, mode: BrowserProfileInfo["proxyMode"]): string {
  switch (mode) {
    case "direct":
      return t("browserProxyDirect", "Direct");
    case "custom":
      return t("browserProxyCustom", "Custom");
    default:
      return t("browserProxySystem", "System");
  }
}

export function headerOperationLabel(t: Translate, operation: BrowserHeaderRule["operation"]): string {
  switch (operation) {
    case "append":
      return t("browserOperationAppend", "Append");
    case "remove":
      return t("browserOperationRemove", "Remove");
    default:
      return t("browserOperationSet", "Set");
  }
}

export const cardStyle: CSSProperties = {
  display: "grid",
  background: "var(--fx-surface-raised)",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-dialog)",
  overflow: "hidden",
};

const plainRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "var(--space-2)",
  padding: "var(--space-4) var(--space-5)",
  background: "var(--fx-surface-raised)",
};

export function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const controlId = useId();
  return (
    <SettingRow label={label} description={description} controlId={controlId}>
      <label htmlFor={controlId} style={{ ...toggleHitAreaStyle, cursor: disabled ? "not-allowed" : "pointer" }}>
        <Toggle
          id={controlId}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    </SettingRow>
  );
}

export function SelectRow({
  label,
  description,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  description?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const controlId = useId();
  return (
    <SettingRow label={label} description={description} controlId={controlId}>
      <NativeSelect id={controlId} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {children}
      </NativeSelect>
    </SettingRow>
  );
}

export function InputRow({
  label,
  description,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  mono = true,
  readOnly,
  autoComplete,
  width = 240,
  trailing,
}: {
  label: string;
  description?: string;
  value: string;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  mono?: boolean;
  readOnly?: boolean;
  autoComplete?: string;
  width?: number;
  trailing?: ReactNode;
}) {
  const controlId = useId();
  const field = (
    <input
      id={controlId}
      type={type}
      className={mono ? "ui-input type-mono-label" : "ui-input type-body-default"}
      style={{ width, flexShrink: 1, minWidth: 0 }}
      value={value}
      readOnly={readOnly}
      autoComplete={autoComplete}
      spellCheck={false}
      placeholder={placeholder}
      onChange={(event) => onChange?.(event.target.value)}
      onBlur={(event) => onBlur?.(event.target.value)}
    />
  );
  return (
    <SettingRow label={label} description={description} controlId={controlId}>
      {trailing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
          {field}
          {trailing}
        </div>
      ) : (
        field
      )}
    </SettingRow>
  );
}

export type NumberFieldSpec = {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
};

export function NumberRow({
  label,
  description,
  fields,
}: {
  label: string;
  description?: string;
  fields: NumberFieldSpec[];
}) {
  const baseId = useId();
  return (
    <SettingRow label={label} description={description} controlId={`${baseId}-0`}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
        {fields.map((field, index) => (
          <input
            key={field.label}
            id={`${baseId}-${index}`}
            type="number"
            className="ui-input type-mono-label"
            style={{ width: 96 }}
            aria-label={fields.length > 1 ? field.label : undefined}
            min={field.min}
            max={field.max}
            defaultValue={field.value}
            onBlur={(event) => field.onCommit(Number(event.target.value))}
          />
        ))}
      </div>
    </SettingRow>
  );
}

export function ValueRow({
  label,
  description,
  value,
  children,
}: {
  label: string;
  description?: string;
  value: string;
  children?: ReactNode;
}) {
  const controlId = useId();
  return (
    <SettingRow label={label} description={description} controlId={controlId}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexShrink: 0 }}>
        <output id={controlId} className="type-mono-body" style={{ color: "var(--fx-text-secondary)" }}>
          {value}
        </output>
        {children}
      </div>
    </SettingRow>
  );
}

export function ActionsRow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="ui-setting-row" data-divider style={{ ...plainRowStyle, ...style }}>
      {children}
    </div>
  );
}

export function NoticeRow({ tone = "muted", children }: { tone?: "muted" | "warning"; children: ReactNode }) {
  return (
    <div
      className="ui-setting-row type-body-default"
      data-divider
      style={{
        ...plainRowStyle,
        padding: "var(--space-3) var(--space-5)",
        background: tone === "warning" ? "var(--fx-status-warning-soft)" : "var(--fx-surface-raised)",
        color: tone === "warning" ? "var(--fx-text-secondary)" : "var(--fx-text-tertiary)",
      }}
    >
      {children}
    </div>
  );
}

export function RowSpacer() {
  return <span aria-hidden style={{ flex: 1 }} />;
}

export type TextPromptOptions = {
  title: string;
  message: string;
  defaultValue?: string;
  requiredValue?: string;
  confirmLabel: string;
};

export function useTextPrompt() {
  const [prompt, setPrompt] = useState<TextPromptOptions | null>(null);
  const resolverRef = useRef<((value: string | null) => void) | null>(null);

  const requestPrompt = useCallback((nextPrompt: TextPromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolverRef.current?.(null);
      resolverRef.current = resolve;
      setPrompt(nextPrompt);
    });
  }, []);

  const respondToPrompt = useCallback((value: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPrompt(null);
    resolve?.(value);
  }, []);

  useEffect(
    () => () => {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve?.(null);
    },
    [],
  );

  return { prompt, requestPrompt, respondToPrompt };
}

export function TextPromptDialog({
  prompt,
  cancelLabel,
  onRespond,
}: {
  prompt: TextPromptOptions;
  cancelLabel: string;
  onRespond: (value: string | null) => void;
}) {
  const [value, setValue] = useState(prompt.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const canSubmit = value.trim().length > 0 && (!prompt.requiredValue || value === prompt.requiredValue);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      role="presentation"
      style={promptBackdropStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget) onRespond(null);
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-text-prompt-title"
        style={promptDialogStyle}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onRespond(value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onRespond(null);
            return;
          }
          if (event.key !== "Tab") return;
          const dialog = dialogRef.current;
          if (!dialog) return;
          const focusable = Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div id="browser-text-prompt-title" className="type-title-dialog" style={{ color: "var(--fx-text-primary)" }}>
          {prompt.title}
        </div>
        <div className="type-body-relaxed" style={{ color: "var(--fx-text-secondary)" }}>
          {prompt.message}
        </div>
        {prompt.requiredValue && (
          <code className="type-mono-label" style={confirmationPhraseStyle}>
            {prompt.requiredValue}
          </code>
        )}
        <input
          ref={inputRef}
          className="ui-input type-body-default"
          aria-label={prompt.message}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button onClick={() => onRespond(null)}>{cancelLabel}</Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {prompt.confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

const promptBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-5)",
  background: "var(--fx-surface-scrim)",
};
const promptDialogStyle: CSSProperties = {
  width: "min(480px, 100%)",
  display: "grid",
  gap: "var(--space-3)",
  padding: "var(--space-5)",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-dialog)",
  background: "var(--fx-surface-raised)",
  boxShadow: "var(--shadow-dialog)",
};
const confirmationPhraseStyle: CSSProperties = {
  display: "block",
  width: "fit-content",
  padding: "var(--space-1) var(--space-2)",
  borderRadius: "var(--radius-control)",
  background: "var(--fx-surface-inset)",
  color: "var(--fx-text-primary)",
  userSelect: "all",
};
