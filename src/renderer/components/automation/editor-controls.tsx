import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Duration, EffectDecl, StepSpec, Text } from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { Button, Check, Field, NativeSelect, NumInput, TextInput } from "../form-controls";
import { useAutomationWorkspace } from "./automation-context";
import { AutomationIcon } from "./automation-icons";
import { editorJson, editorRecord } from "./editor-model";

export const EditorValidityContext = createContext<(id: string, invalid: boolean) => void>(() => {});
export const EditorVariablesContext = createContext<readonly StepSpec[]>([]);

function useEditorValidity(invalid: boolean) {
  const id = useId();
  const update = useContext(EditorValidityContext);
  useEffect(() => {
    update(id, invalid);
    return () => update(id, false);
  }, [id, invalid, update]);
}

export function EditorJsonField<T>({
  label,
  value,
  onChange,
  shape = "value",
  optional = true,
  variables = false,
}: {
  label: string;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  shape?: "value" | "object" | "array" | "strings" | "numbers" | "condition";
  optional?: boolean;
  variables?: boolean;
}) {
  const { t } = useI18n();
  const steps = useContext(EditorVariablesContext);
  const input = useRef<HTMLTextAreaElement>(null);
  const source = editorJson(value);
  const accepted = useRef(source);
  const [text, setText] = useState(source);
  const [invalid, setInvalid] = useState(false);
  useEditorValidity(invalid);
  useEffect(() => {
    if (source !== accepted.current) {
      accepted.current = source;
      setText(source);
      setInvalid(false);
    }
  }, [source]);
  const change = (next: string) => {
    setText(next);
    try {
      if (!next.trim() && optional) {
        accepted.current = "";
        setInvalid(false);
        onChange(undefined);
        return;
      }
      const parsed: unknown = JSON.parse(next);
      const valid =
        shape === "value" ||
        (shape === "object" && editorRecord(parsed)) ||
        (shape === "array" && Array.isArray(parsed)) ||
        (shape === "strings" && Array.isArray(parsed) && parsed.every((entry: unknown) => typeof entry === "string")) ||
        (shape === "numbers" && Array.isArray(parsed) && parsed.every((entry: unknown) => typeof entry === "number")) ||
        (shape === "condition" &&
          editorRecord(parsed) &&
          ("all" in parsed || "any" in parsed || "not" in parsed || "ref" in parsed));
      if (!valid) throw new Error("shape");
      accepted.current = editorJson(parsed);
      setInvalid(false);
      onChange(parsed as T);
    } catch {
      setInvalid(true);
    }
  };
  return (
    <div className="auto-page-editor-field">
      <label className="type-label-default">
        {label}
        <textarea
          ref={input}
          aria-label={label}
          value={text}
          onChange={(event) => change(event.target.value)}
          aria-invalid={invalid}
          spellCheck={false}
          className="ui-input auto-page-editor-json type-mono-code"
          rows={5}
        />
      </label>
      {variables && (
        <NativeSelect
          aria-label={t("autoPageEditorInsertJsonVariable", "Insert a JSON variable reference")}
          value=""
          onChange={(event) => {
            if (!event.target.value) return;
            const reference = JSON.stringify({ $ref: event.target.value });
            const start = input.current?.selectionStart ?? text.length;
            const end = input.current?.selectionEnd ?? text.length;
            change(text.slice(0, start) + reference + text.slice(end));
            input.current?.focus();
          }}
        >
          <option value="">{t("autoPageEditorInsertJsonVariable", "Insert a JSON variable reference")}</option>
          {["input", "trigger.id", "run.id", "task.name", ...steps.map((step) => `steps.${step.id}.output`)].map(
            (path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ),
          )}
        </NativeSelect>
      )}
      {invalid && (
        <p role="alert" className="auto-page-editor-error type-label-default">
          {t("autoPageEditorJsonInvalid", "Enter valid JSON with the expected shape.")}
        </p>
      )}
    </div>
  );
}

export function EditorDurationField({
  label,
  value,
  onChange,
  optional = true,
}: {
  label: string;
  value?: Duration;
  onChange: (value: Duration | undefined) => void;
  optional?: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(value ?? "");
  const [invalid, setInvalid] = useState(false);
  useEditorValidity(invalid);
  useEffect(() => {
    setText(value ?? "");
    setInvalid(false);
  }, [value]);
  return (
    <div className="auto-page-editor-field">
      <Field label={label}>
        <TextInput
          mono
          value={text}
          placeholder={t("autoPageEditorDurationHint", "Examples: 30s, 5m, 2h, 1d")}
          onChange={(next) => {
            setText(next);
            const valid = /^\d+(?:\.\d+)?[smhd]$/.test(next);
            setInvalid(!valid && !(optional && !next));
            if (valid) onChange(next as Duration);
            else if (!next && optional) onChange(undefined);
          }}
        />
      </Field>
      {invalid && (
        <p role="alert" className="auto-page-editor-error type-label-default">
          {t("autoPageEditorDurationInvalid", "Use a number followed by s, m, h or d.")}
        </p>
      )}
    </div>
  );
}

export function EditorNumberField({
  label,
  value,
  onChange,
  minimum = 1,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  minimum?: number;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const invalid = !!text && (!Number.isSafeInteger(Number(text)) || Number(text) < minimum);
  useEditorValidity(invalid);
  useEffect(() => {
    setText(value === undefined ? "" : String(value));
  }, [value]);
  return (
    <div className="auto-page-editor-field">
      <Field label={label}>
        <NumInput
          value={text}
          onChange={(next) => {
            setText(next);
            if (!next) onChange(undefined);
            else if (Number.isSafeInteger(Number(next)) && Number(next) >= minimum) onChange(Number(next));
          }}
        />
      </Field>
      {invalid && (
        <p className="auto-page-editor-error type-label-default">
          {t("autoPageEditorNumberInvalid", "Enter a whole number within the allowed range.")}
        </p>
      )}
    </div>
  );
}

export function EditorTextField({
  label,
  value,
  onChange,
  steps = [],
  multiline = false,
}: {
  label: string;
  value: Text;
  onChange: (value: Text) => void;
  steps?: readonly StepSpec[];
  multiline?: boolean;
}) {
  const { t } = useI18n();
  const template = typeof value !== "string";
  const text = template ? value.$tmpl : value;
  const change = (next: string) => onChange(template ? { $tmpl: next } : next);
  return (
    <div className="auto-page-editor-field">
      <Field label={label}>
        {multiline ? (
          <textarea
            aria-label={label}
            className="ui-input auto-page-editor-textarea type-body-default"
            rows={5}
            value={text}
            onChange={(event) => change(event.target.value)}
          />
        ) : (
          <TextInput value={text} onChange={change} />
        )}
      </Field>
      <div className="auto-page-editor-inline">
        <Check
          label={t("autoPageEditorTemplate", "Text template")}
          checked={template}
          onChange={(enabled) => onChange(enabled ? { $tmpl: text } : text)}
        />
        <NativeSelect
          aria-label={t("autoPageEditorInsertVariable", "Insert a variable")}
          value=""
          onChange={(event) => {
            if (event.target.value) onChange({ $tmpl: `${text}{{${event.target.value}}}` });
          }}
        >
          <option value="">{t("autoPageEditorInsertVariable", "Insert a variable")}</option>
          {["input", "trigger.id", "run.id", "task.name", ...steps.map((step) => `steps.${step.id}.output`)].map(
            (path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ),
          )}
        </NativeSelect>
      </div>
    </div>
  );
}

export function EditorVariableReference({ steps }: { steps: readonly StepSpec[] }) {
  const { t } = useI18n();
  const [path, setPath] = useState("input");
  const { notify } = useAutomationWorkspace();
  return (
    <details className="auto-page-editor-advanced">
      <summary className="type-label-medium">
        {t("autoPageEditorReferenceHelp", "Use variables in JSON fields")}
      </summary>
      <NativeSelect value={path} onChange={(event) => setPath(event.target.value)}>
        {["input", "trigger.id", "run.id", "task.name", ...steps.map((step) => `steps.${step.id}.output`)].map(
          (entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ),
        )}
      </NativeSelect>
      <code className="type-mono-code">{JSON.stringify({ $ref: path })}</code>
      <Button
        onClick={() => {
          void navigator.clipboard
            .writeText(JSON.stringify({ $ref: path }))
            .then(() => notify(t("autoPageEditorReferenceCopied", "Variable reference copied.")))
            .catch(() => notify(t("autoPageEditorCopyFailed", "Could not copy. Select and copy the reference above.")));
        }}
      >
        {t("autoPageEditorCopyReference", "Copy reference")}
      </Button>
    </details>
  );
}

export function EditorSecretPicker({
  environmentId,
  names,
  selected,
  onChange,
}: {
  environmentId: string;
  names: readonly string[] | null;
  selected: readonly string[];
  onChange: (value: readonly string[]) => void;
}) {
  const { t } = useI18n();
  const { openVault } = useAutomationWorkspace();
  const source = selected.join(", ");
  const [text, setText] = useState(source);
  const accepted = useRef(source);
  useEffect(() => {
    if (source !== accepted.current) {
      accepted.current = source;
      setText(source);
    }
  }, [source]);
  return (
    <div className="auto-page-editor-field">
      <span className="type-label-medium">{t("autoPageEditorSecretReferences", "Secret references")}</span>
      <TextInput
        mono
        value={text}
        onChange={(value) => {
          setText(value);
          const next = value
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);
          accepted.current = next.join(", ");
          onChange(next);
        }}
        placeholder={t("autoPageEditorSecretNamesHint", "Names only, separated by commas")}
      />
      <NativeSelect
        aria-label={t("autoPageEditorPickSecret", "Choose a stored secret")}
        value=""
        onChange={(event) => {
          if (event.target.value) onChange([...new Set([...selected, event.target.value])]);
        }}
      >
        <option value="">{t("autoPageEditorPickSecret", "Choose a stored secret")}</option>
        {(names ?? []).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </NativeSelect>
      <Button variant="ghost" onClick={() => openVault(environmentId, true)}>
        <AutomationIcon name="key" />
        {t("autoPageEditorAddSecret", "Add a secret on this host")}
      </Button>
    </div>
  );
}

export function EditorEffectField({
  value,
  onChange,
}: {
  value?: EffectDecl;
  onChange: (value: EffectDecl | undefined) => void;
}) {
  const { t } = useI18n();
  const mode = value === undefined ? "" : typeof value === "string" ? value : "idempotent";
  return (
    <div className="auto-page-editor-field">
      <Field label={t("autoPageEditorEffect", "External effects")}>
        <NativeSelect
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            onChange(
              next === "read" || next === "unsafe"
                ? next
                : next === "idempotent"
                  ? { idempotent: { window: "1h" } }
                  : undefined,
            );
          }}
        >
          <option value="">{t("autoPageEditorDefaultEffect", "Infer from tools or action")}</option>
          <option value="read">{t("autoPageEditorReadOnly", "Read only")}</option>
          <option value="unsafe">{t("autoPageEditorUnsafe", "May change external state")}</option>
          <option value="idempotent">{t("autoPageEditorIdempotent", "Safe to repeat within a window")}</option>
        </NativeSelect>
      </Field>
      {typeof value === "object" && (
        <Field label={t("autoPageEditorIdempotencyWindow", "Repeat-safety window (or forever)")}>
          <TextInput
            mono
            value={value.idempotent.window}
            onChange={(next) => onChange({ idempotent: { window: next as Duration | "forever" } })}
          />
        </Field>
      )}
    </div>
  );
}

export function EditorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="auto-page-editor-section">
      <h3 className="type-heading">{title}</h3>
      {children}
    </section>
  );
}
