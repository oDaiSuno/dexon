import type { ActionCall, ChannelSendSpec, HttpRequestSpec, ScriptRunSpec, StepSpec } from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { Button, Field, NativeSelect, TextInput } from "../form-controls";
import { useAutomationWorkspace } from "./automation-context";
import { AutomationIcon } from "./automation-icons";
import {
  EditorDurationField,
  EditorEffectField,
  EditorJsonField,
  EditorSecretPicker,
  EditorTextField,
} from "./editor-controls";

export interface EditorActionProps {
  environmentId: string;
  secretNames: readonly string[] | null;
  earlierSteps?: readonly StepSpec[];
  readOnly?: boolean;
}

export function EditorHttpFields({
  value,
  onChange,
  environmentId,
  secretNames,
  earlierSteps = [],
  readOnly = false,
}: EditorActionProps & { value: HttpRequestSpec; onChange: (value: HttpRequestSpec) => void }) {
  const { t } = useI18n();
  const { openVault } = useAutomationWorkspace();
  const secretHeaders = value.secretHeaders ?? {};
  const updateHeader = (previous: string, header: string, name: string) => {
    const next = Object.fromEntries(Object.entries(secretHeaders).filter(([key]) => key !== previous));
    if (header) next[header] = name;
    onChange({ ...value, secretHeaders: next });
  };
  return (
    <>
      <Field label={t("autoPageEditorHttpMethod", "HTTP method")}>
        <NativeSelect
          value={value.method ?? "GET"}
          onChange={(event) => onChange({ ...value, method: event.target.value as HttpRequestSpec["method"] })}
        >
          {(readOnly ? ["GET", "HEAD"] : ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).map((method) => (
            <option key={method}>{method}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("autoPageEditorHttpOrigin", "Origin (no path or credentials)")}>
        <TextInput
          mono
          value={value.url.origin}
          onChange={(origin) => onChange({ ...value, url: { ...value.url, origin } })}
        />
      </Field>
      <EditorTextField
        label={t("autoPageEditorHttpPath", "Request path")}
        value={value.url.path ?? "/"}
        onChange={(path) => onChange({ ...value, url: { ...value.url, path } })}
        steps={earlierSteps}
      />
      <EditorJsonField
        label={t("autoPageEditorHttpQuery", "Query parameters (JSON)")}
        value={value.url.query}
        shape="object"
        onChange={(query) => onChange({ ...value, url: { ...value.url, query } })}
      />
      <EditorJsonField
        label={t("autoPageEditorHttpHeaders", "Public headers (JSON; never paste secrets)")}
        value={value.headers}
        shape="object"
        onChange={(headers) => onChange({ ...value, headers })}
      />
      <section className="auto-page-editor-section">
        <h4 className="type-label-medium">{t("autoPageEditorSecretHeaders", "Secret headers (names only)")}</h4>
        {Object.entries(secretHeaders).map(([header, name], index) => (
          <div className="auto-page-editor-secret-header" key={index}>
            <Field label={t("autoPageEditorHeaderName", "Header name")}>
              <TextInput mono value={header} onChange={(next) => updateHeader(header, next, name)} />
            </Field>
            <Field label={t("autoPageEditorSecretName", "Secret name")}>
              <TextInput mono value={name} onChange={(next) => updateHeader(header, header, next)} />
            </Field>
            <NativeSelect
              aria-label={t("autoPageEditorPickSecret", "Choose a stored secret")}
              value=""
              onChange={(event) => {
                if (event.target.value) updateHeader(header, header, event.target.value);
              }}
            >
              <option value="">{t("autoPageEditorPickSecret", "Choose a stored secret")}</option>
              {(secretNames ?? []).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="ghost"
              aria-label={t("autoPageEditorRemoveHeader", "Remove header")}
              onClick={() => updateHeader(header, "", "")}
            >
              <AutomationIcon name="trash" />
            </Button>
          </div>
        ))}
        <div className="auto-page-editor-inline">
          <Button
            onClick={() => {
              let header = "Authorization";
              while (header in secretHeaders) header += "-X";
              onChange({ ...value, secretHeaders: { ...secretHeaders, [header]: "" } });
            }}
          >
            <AutomationIcon name="plus" />
            {t("autoPageEditorAddHeader", "Add secret header")}
          </Button>
          <Button variant="ghost" onClick={() => openVault(environmentId, true)}>
            <AutomationIcon name="key" />
            {t("autoPageEditorAddSecret", "Add a secret on this host")}
          </Button>
        </div>
      </section>
      <EditorJsonField
        variables
        label={t("autoPageEditorHttpBody", "Request body (JSON)")}
        value={value.body}
        onChange={(body) => onChange({ ...value, body })}
      />
      <EditorJsonField
        label={t("autoPageEditorHttpStatuses", "Expected HTTP statuses (JSON array)")}
        value={value.expectStatus}
        shape="numbers"
        onChange={(expectStatus) => onChange({ ...value, expectStatus })}
      />
      <EditorDurationField
        label={t("autoPageEditorActionTimeout", "Action timeout")}
        value={value.timeout}
        onChange={(timeout) => onChange({ ...value, timeout })}
      />
      {!readOnly && <EditorEffectField value={value.effect} onChange={(effect) => onChange({ ...value, effect })} />}
    </>
  );
}

export function EditorScriptFields({
  value,
  onChange,
  environmentId,
  secretNames,
  readOnly = false,
}: EditorActionProps & { value: ScriptRunSpec; onChange: (value: ScriptRunSpec) => void }) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t("autoPageEditorScriptPath", "Script path (inside the working directory)")}>
        <TextInput mono value={value.path} onChange={(path) => onChange({ ...value, path })} />
      </Field>
      <EditorJsonField
        variables
        label={t("autoPageEditorScriptArgs", "Script arguments (JSON)")}
        value={value.args}
        onChange={(args) => onChange({ ...value, args })}
      />
      <EditorSecretPicker
        environmentId={environmentId}
        names={secretNames}
        selected={value.secrets ?? []}
        onChange={(secrets) => onChange({ ...value, secrets })}
      />
      <EditorDurationField
        label={t("autoPageEditorActionTimeout", "Action timeout")}
        value={value.timeout}
        onChange={(timeout) => onChange({ ...value, timeout })}
      />
      {!readOnly && (
        <EditorEffectField
          value={value.effect}
          onChange={(effect) => onChange({ ...value, effect: effect ?? "unsafe" })}
        />
      )}
    </>
  );
}

export function EditorChannelFields({
  value,
  onChange,
  earlierSteps = [],
}: {
  value: ChannelSendSpec;
  onChange: (value: ChannelSendSpec) => void;
  earlierSteps?: readonly StepSpec[];
}) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t("autoPageEditorAccountId", "Channel account ID")}>
        <TextInput
          mono
          value={value.to.accountId}
          onChange={(accountId) => onChange({ ...value, to: { ...value.to, accountId } })}
        />
      </Field>
      <Field label={t("autoPageEditorPeerId", "Recipient ID")}>
        <TextInput
          mono
          value={value.to.peerId}
          onChange={(peerId) => onChange({ ...value, to: { ...value.to, peerId } })}
        />
      </Field>
      <EditorTextField
        label={t("autoPageEditorMessage", "Message")}
        value={value.text}
        onChange={(text) => onChange({ ...value, text })}
        steps={earlierSteps}
        multiline
      />
      <Field label={t("autoPageEditorMessageFormat", "Message format")}>
        <NativeSelect
          value={value.format ?? "text"}
          onChange={(event) => onChange({ ...value, format: event.target.value === "markdown" ? "markdown" : "text" })}
        >
          <option value="text">{t("autoPageEditorPlainText", "Plain text")}</option>
          <option value="markdown">{t("autoPageEditorMarkdown", "Markdown")}</option>
        </NativeSelect>
      </Field>
      <EditorJsonField
        variables
        label={t("autoPageEditorAttachments", "Attachments (JSON)")}
        value={value.attachments}
        onChange={(attachments) => onChange({ ...value, attachments })}
      />
    </>
  );
}

export function EditorActionFields({
  call,
  onChange,
  ...props
}: EditorActionProps & { call: ActionCall; onChange: (call: ActionCall) => void }) {
  if (call.action === "http.request")
    return (
      <EditorHttpFields
        {...props}
        value={call.with}
        onChange={(value) => onChange({ action: "http.request", with: value })}
      />
    );
  if (call.action === "script.run")
    return (
      <EditorScriptFields
        {...props}
        value={call.with}
        onChange={(value) => onChange({ action: "script.run", with: value })}
      />
    );
  return (
    <EditorChannelFields
      value={call.with}
      onChange={(value) => onChange({ action: "channel.send", with: value })}
      earlierSteps={props.earlierSteps}
    />
  );
}
