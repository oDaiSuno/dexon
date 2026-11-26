import { useId, useState } from "react";
import type { Json, JsonSchema } from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { Button, Field, NativeSelect, TextInput } from "@/components/form-controls";
import { JsonBlock } from "./automation-atoms";

function isObject(value: Json | undefined): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function drawerSchemaDefault(schema?: JsonSchema | null): Json {
  if (!schema) return null;
  if (schema.default !== undefined) return schema.default;
  if (schema.type === "object" || isObject(schema.properties)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    return Object.fromEntries(
      Object.entries(properties).flatMap(([name, field]) =>
        isObject(field) && field.default !== undefined ? [[name, field.default]] : [],
      ),
    );
  }
  return null;
}

export function DrawerSchemaInput({
  schema,
  value,
  onChange,
  label,
  disabled = false,
}: {
  schema?: JsonSchema | null;
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [jsonMode, setJsonMode] = useState(false);
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const properties = schema && isObject(schema.properties) ? schema.properties : null;
  const fields = properties ? Object.entries(properties) : [];
  let current: Record<string, Json> | null = null;
  try {
    const parsed: Json = value.trim() ? JSON.parse(value) : {};
    if (isObject(parsed)) current = parsed;
  } catch {
    current = null;
  }
  const simple =
    fields.length > 0 &&
    fields.every(
      ([, field]) =>
        isObject(field) &&
        !field.anyOf &&
        !field.oneOf &&
        !field.allOf &&
        !field.not &&
        (["string", "number", "integer", "boolean"].includes(String(field.type)) || Array.isArray(field.enum)),
    );
  const showFields = simple && current !== null && !jsonMode;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const updateField = (name: string, next: Json | undefined) => {
    const entries = Object.entries(current ?? {}).filter(([key]) => key !== name);
    if (next !== undefined) entries.push([name, next]);
    onChange(JSON.stringify(Object.fromEntries(entries), null, 2));
  };

  return (
    <section className="auto-page-json-input">
      <div className="auto-page-section-heading">
        <label htmlFor={showFields ? undefined : id} className="type-label-medium">
          {label}
        </label>
        {simple && (
          <Button
            variant="ghost"
            disabled={disabled || (!showFields && current === null)}
            onClick={() => {
              setNumberDrafts({});
              setJsonMode(showFields);
            }}
          >
            {showFields ? t("autoPageDrawerEditJson", "Edit JSON") : t("autoPageDrawerEditFields", "Edit fields")}
          </Button>
        )}
      </div>
      <fieldset className="auto-page-fieldset" disabled={disabled}>
        {showFields ? (
          fields.map(([name, raw]) => {
            const field = raw as JsonSchema;
            const existing = current && Object.hasOwn(current, name) ? current[name] : undefined;
            const numeric = field.type === "number" || field.type === "integer";
            const fieldValue =
              numeric && Object.hasOwn(numberDrafts, name)
                ? numberDrafts[name]
                : existing === undefined
                  ? ""
                  : String(existing);
            const fieldLabel = `${typeof field.title === "string" ? field.title : name}${required.includes(name) ? " *" : ""}`;
            const enumValues = Array.isArray(field.enum) ? field.enum : null;
            return (
              <div key={name} className="auto-page-schema-field">
                <Field label={fieldLabel}>
                  {enumValues ? (
                    <NativeSelect
                      value={existing === undefined ? "" : JSON.stringify(existing)}
                      onChange={(event) =>
                        updateField(name, event.target.value ? (JSON.parse(event.target.value) as Json) : undefined)
                      }
                    >
                      <option value="">{t("autoPageDrawerNotSet", "Not set")}</option>
                      {enumValues.map((option, index) => (
                        <option key={index} value={JSON.stringify(option)}>
                          {typeof option === "string" ? option : JSON.stringify(option)}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : field.type === "boolean" ? (
                    <NativeSelect
                      value={existing === undefined ? "" : String(existing)}
                      onChange={(event) =>
                        updateField(name, event.target.value ? event.target.value === "true" : undefined)
                      }
                    >
                      <option value="">{t("autoPageDrawerNotSet", "Not set")}</option>
                      <option value="true">{t("autoPageDrawerYes", "Yes")}</option>
                      <option value="false">{t("autoPageDrawerNo", "No")}</option>
                    </NativeSelect>
                  ) : (
                    <TextInput
                      value={fieldValue}
                      mono={field.type !== "string"}
                      onChange={(text) => {
                        if (numeric) setNumberDrafts((prior) => ({ ...prior, [name]: text }));
                        if (!text && field.type !== "string") updateField(name, undefined);
                        else if (numeric) {
                          const number = Number(text);
                          updateField(name, text.trim() && Number.isFinite(number) ? number : text);
                        } else updateField(name, text);
                      }}
                    />
                  )}
                </Field>
                {typeof field.description === "string" && (
                  <p className="auto-page-muted type-label-default">{field.description}</p>
                )}
              </div>
            );
          })
        ) : (
          <textarea
            id={id}
            className="auto-page-textarea type-mono-code"
            rows={7}
            value={value}
            onChange={(event) => {
              setNumberDrafts({});
              onChange(event.target.value);
            }}
            spellCheck={false}
          />
        )}
      </fieldset>
      {schema && (
        <details className="auto-page-schema-details">
          <summary className="type-label-medium">{t("autoPageDrawerInputSchema", "Input schema")}</summary>
          <JsonBlock value={schema} />
        </details>
      )}
    </section>
  );
}
