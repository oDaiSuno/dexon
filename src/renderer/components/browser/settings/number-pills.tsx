import { useEffect, useId, useState } from "react";
import { ChoiceRow } from "./choice-row";

export type NumberPillSpec = {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onCommit: (value: number) => void;
};

export function NumberPillsRow({
  label,
  description,
  invalidMessage,
  fields,
}: {
  label: string;
  description: string;
  invalidMessage: (field: NumberPillSpec) => string;
  fields: NumberPillSpec[];
}) {
  const errorId = useId();
  const [invalidLabel, setInvalidLabel] = useState<string | null>(null);
  const invalidField = fields.find((field) => field.label === invalidLabel);
  return (
    <ChoiceRow
      label={label}
      description={description}
      layout="center"
      note={
        invalidField && (
          <p
            id={errorId}
            role="alert"
            className="type-label-default"
            style={{ margin: 0, color: "var(--fx-status-danger)" }}
          >
            {invalidMessage(invalidField)}
          </p>
        )
      }
    >
      {({ labelId }) => (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
          {fields.map((field) => (
            <NumberPill
              key={field.label}
              rowLabelId={labelId}
              errorId={errorId}
              field={field}
              invalid={invalidLabel === field.label}
              onValidity={(valid) =>
                setInvalidLabel((current) => (valid ? (current === field.label ? null : current) : field.label))
              }
            />
          ))}
        </div>
      )}
    </ChoiceRow>
  );
}

function NumberPill({
  rowLabelId,
  errorId,
  field,
  invalid,
  onValidity,
}: {
  rowLabelId: string;
  errorId: string;
  field: NumberPillSpec;
  invalid: boolean;
  onValidity: (valid: boolean) => void;
}) {
  const inputId = useId();
  const labelId = useId();
  const unitId = useId();
  const [draft, setDraft] = useState(String(field.value));

  useEffect(() => {
    setDraft(String(field.value));
  }, [field.value]);

  const commit = () => {
    const next = Number(draft);
    const valid = draft.trim() !== "" && Number.isInteger(next) && next >= field.min && next <= field.max;
    onValidity(valid);
    if (valid && next !== field.value) field.onCommit(next);
  };

  return (
    <label htmlFor={inputId} className="ui-number-pill" data-invalid={invalid || undefined}>
      <span id={labelId} className="type-label-default">
        {field.label}
      </span>
      <span className="ui-number-pill-value type-mono-body">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          step={1}
          value={draft}
          aria-labelledby={[rowLabelId, labelId, field.unit ? unitId : ""].filter(Boolean).join(" ")}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        {field.unit && <span id={unitId}> {field.unit}</span>}
      </span>
    </label>
  );
}
