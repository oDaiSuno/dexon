import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

export type ChoiceOption<T extends string> = { value: T; disabled?: boolean };

export function ChoiceRow({
  label,
  description,
  layout,
  note,
  children,
}: {
  label: string;
  description: string;
  layout: "center" | "top" | "stacked";
  note?: ReactNode;
  children: (ids: { labelId: string; descriptionId: string }) => ReactNode;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div
      className="ui-setting-row"
      data-divider="true"
      style={
        layout === "stacked"
          ? stackedRowStyle
          : { ...inlineRowStyle, alignItems: layout === "top" ? "flex-start" : "center" }
      }
    >
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
        <span id={labelId} className="type-body-large-medium" style={{ color: "var(--fx-text-primary)" }}>
          {label}
        </span>
        <p
          id={descriptionId}
          className="type-body-relaxed"
          style={{ margin: 0, color: "var(--fx-text-tertiary)", textWrap: "pretty" }}
        >
          {description}
        </p>
        {note}
      </div>
      {children({ labelId, descriptionId })}
    </div>
  );
}

export function useRovingRadio<T extends string>(options: ChoiceOption<T>[], value: T, onChange: (value: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    for (let offset = 1; offset <= options.length; offset += 1) {
      const next = (focusIndex + step * offset + options.length * offset) % options.length;
      if (options[next].disabled) continue;
      onChange(options[next].value);
      refs.current[next]?.focus();
      return;
    }
  };

  const radioProps = (index: number) => ({
    ref: (element: HTMLButtonElement | null) => {
      refs.current[index] = element;
    },
    type: "button" as const,
    role: "radio" as const,
    "aria-checked": options[index].value === value,
    "aria-disabled": options[index].disabled || undefined,
    tabIndex: index === focusIndex ? 0 : -1,
  });

  return { onKeyDown, radioProps };
}

const inlineRowStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-5)",
  padding: "var(--space-4) var(--space-5)",
  background: "var(--fx-surface-raised)",
};

const stackedRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "var(--space-3-5)",
  padding: "var(--space-4) var(--space-5)",
  background: "var(--fx-surface-raised)",
};
