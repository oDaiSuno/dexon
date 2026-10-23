/**
 * Shared form controls for settings-style panels, styled by styles/controls.css
 * after the Framer "Controls/*" components.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { useI18n } from "@/i18n";

const FieldControlIdContext = createContext<string | undefined>(undefined);

function useFieldControlId(): string | undefined {
  return useContext(FieldControlIdContext);
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export type FieldLabelSize = "label" | "body";

const fieldLabelClass: Record<FieldLabelSize, string> = {
  label: "type-label-default",
  body: "type-body-default",
};

export function Field({
  label,
  labelSize = "label",
  children,
}: {
  label: ReactNode;
  labelSize?: FieldLabelSize;
  children: ReactNode;
}) {
  const controlId = useId();

  return (
    <FieldControlIdContext.Provider value={controlId}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor={controlId} className={fieldLabelClass[labelSize]} style={{ color: "var(--fx-text-secondary)" }}>
          {label}
        </label>
        {children}
      </div>
    </FieldControlIdContext.Provider>
  );
}

export type ButtonVariant = "secondary" | "primary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  busy,
  type = "button",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      {...props}
      type={type}
      className={className ? `ui-button type-body-medium ${className}` : "ui-button type-body-medium"}
      data-variant={variant === "secondary" ? undefined : variant}
      aria-busy={busy || undefined}
    />
  );
}

export function Toggle({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <input {...props} type="checkbox" role="switch" className={className ? `ui-toggle ${className}` : "ui-toggle"} />
  );
}

export type BadgeTone = "success" | "warning" | "danger" | "running" | "muted" | "neutral" | "accent";

export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  const textClass = tone === "neutral" || tone === "accent" ? "type-mono-meta" : "type-label-medium";

  return (
    <span className={`ui-badge ${textClass}`} data-tone={tone}>
      {children}
    </span>
  );
}

function inputClassName(mono?: boolean): string {
  return mono ? "ui-input type-mono-label" : "ui-input type-body-default";
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const controlId = useFieldControlId();

  return (
    <input
      id={controlId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputClassName(mono)}
      data-mono={mono || undefined}
    />
  );
}

export function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: CSSProperties;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const controlId = useFieldControlId();
  const revealLabel = visible ? t("secretInputHide", "Hide API key") : t("secretInputShow", "Show API key");

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", ...style }}>
      <input
        id={controlId}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={inputClassName(mono)}
        data-mono={mono || undefined}
        style={{ flex: 1, minWidth: 0 }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={revealLabel}
        title={revealLabel}
        className="ui-input-reveal"
        style={{ width: 32, height: 32 }}
      >
        {visible ? (
          <svg {...iconProps}>
            <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
            <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
            <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
            <path d="m2 2 20 20" />
          </svg>
        ) : (
          <svg {...iconProps}>
            <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function NumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const controlId = useFieldControlId();

  return (
    <input
      id={controlId}
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputClassName(true)}
      data-mono
    />
  );
}

export function NativeSelect({ id, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const controlId = useFieldControlId();

  return (
    <span className="ui-select-field">
      <select
        {...props}
        id={id ?? controlId}
        className={className ? `ui-select type-body-default ${className}` : "ui-select type-body-default"}
      >
        {children}
      </select>
      <svg {...iconProps} className="ui-select-icon">
        <path d="m7 15 5 5 5-5" />
        <path d="m7 9 5-5 5 5" />
      </svg>
    </span>
  );
}

export function Select({
  value,
  onChange,
  options,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  required?: boolean;
}) {
  const { t } = useI18n();

  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} data-empty={!value || undefined}>
      {!required && <option value="">{t("selectUseDefault", "Use default")}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </NativeSelect>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="type-body-medium"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 32,
        cursor: "pointer",
        color: "var(--fx-text-primary)",
      }}
    >
      <Toggle checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div
      className="type-meta-caps"
      style={{
        color: "var(--fx-text-tertiary)",
        textTransform: "uppercase",
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}
