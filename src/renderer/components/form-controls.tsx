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
} from "react";

const FieldControlIdContext = createContext<string | undefined>(undefined);

function useFieldControlId(): string | undefined {
  return useContext(FieldControlIdContext);
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const controlId = useId();

  return (
    <FieldControlIdContext.Provider value={controlId}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor={controlId} style={{ fontSize: "var(--text-label)", color: "var(--text-muted)" }}>
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
      className={className ? `ui-button ${className}` : "ui-button"}
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
  return (
    <span className="ui-badge" data-tone={tone}>
      {children}
    </span>
  );
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
      className="ui-input"
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
  const [visible, setVisible] = useState(false);
  const controlId = useFieldControlId();

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        id={controlId}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="ui-input"
        data-mono={mono || undefined}
        style={{ paddingRight: 40 }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide API key" : "Show API key"}
        title={visible ? "Hide API key" : "Show API key"}
        style={{
          position: "absolute",
          right: 2,
          top: "50%",
          transform: "translateY(-50%)",
          width: 32,
          height: 32,
          borderRadius: "var(--radius-control)",
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visible ? (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
            <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
            <path d="M1 1l22 22" />
          </svg>
        ) : (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
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
      className="ui-input"
    />
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
  const controlId = useFieldControlId();

  return (
    <select
      id={controlId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="ui-select"
      data-empty={!value || undefined}
    >
      {!required && <option value="">— inherit / none —</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 32,
        cursor: "pointer",
        fontSize: "var(--text-body)",
        color: "var(--text)",
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
      style={{
        fontSize: "var(--text-meta)",
        fontWeight: "var(--weight-medium)",
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}
