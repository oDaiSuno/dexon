import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { EnvironmentView } from "@contract/environment";
import type { ProbeReport } from "@contract/environment-commands";
import { useI18n } from "@/i18n";
import { workspaceStore } from "@/lib/workspace-store";
import { Button } from "../../form-controls";
import { ModelDialogShell } from "../../models/model-dialog-shell";
import { createServerDraft, toEnvironmentDraft } from "./server-draft";
import { ServerForm } from "./server-form";
import { ServerTestReport } from "./server-test-report";
import { ServerActionError, ServerFooter, ServerIcon, serverStackStyle } from "./server-ui";
import { useServerActions } from "./use-server-actions";

export function EditServerDialog({
  view,
  onClose,
  onRemove,
  focusField,
  suggestedValue,
}: {
  view: EnvironmentView;
  onClose: () => void;
  onRemove?: () => void;
  focusField?: "remoteStateDir";
  suggestedValue?: string;
}) {
  const { t } = useI18n();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [testTokenRequired, setTestTokenRequired] = useState(false);
  const [focusedField, setFocusedField] = useState(focusField);
  const workspace = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const spaces = workspace.spaces.filter((space) => space.environmentId === view.id);
  const [draft, setDraft] = useState(() => {
    const initial = createServerDraft(view);
    return initial.kind === "ssh" && focusField && suggestedValue
      ? { ...initial, remoteStateDir: suggestedValue }
      : initial;
  });
  const { run, pending, error } = useServerActions();
  const testConnection = async () => {
    if (!formRef.current?.reportValidity()) return;
    setReport(null);
    const storedWebSocket =
      draft.kind === "websocket" &&
      view.target.kind === "websocket" &&
      draft.url.trim() === view.target.url &&
      !draft.authToken;
    if (draft.kind === "websocket" && !draft.authToken && !storedWebSocket) {
      setTestTokenRequired(true);
      return;
    }
    setTestTokenRequired(false);
    const result = await run({
      type: "test",
      subject: storedWebSocket ? { environmentId: view.id } : { draft: toEnvironmentDraft(draft) },
    });
    if (result.ok) setReport(result.value);
  };
  const save = async (reconnect: boolean) => {
    if (!formRef.current?.reportValidity()) return;
    const result = await run({ type: "update", environmentId: view.id, draft: toEnvironmentDraft(draft) });
    if (!result.ok) return;
    if (reconnect) {
      const connected = await run({ type: "connect", environmentId: view.id });
      if (!connected.ok) return;
    }
    onClose();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(false);
  };
  return (
    <ModelDialogShell
      width={624}
      dirty={JSON.stringify(draft) !== JSON.stringify(createServerDraft(view))}
      title={t("serversEditTitle", "Edit remote server")}
      subtitle={view.label}
      leading={<ServerIcon />}
      divided
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <ServerFooter
          leading={
            onRemove && (
              <Button
                variant="ghost"
                disabled={Boolean(pending)}
                onClick={onRemove}
                style={{ color: "var(--fx-status-danger)" }}
              >
                {t("serversRemove", "Remove")}
              </Button>
            )
          }
        >
          <Button onClick={onClose} disabled={Boolean(pending)}>
            {t("cancel", "Cancel")}
          </Button>
          <Button disabled={Boolean(pending)} onClick={() => void save(true)}>
            {t("serversSaveReconnect", "Save and reconnect")}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={Boolean(pending)} busy={pending === "update"}>
            {t("serversSave", "Save changes")}
          </Button>
        </ServerFooter>
      }
    >
      <div style={serverStackStyle}>
        <form ref={formRef} id={formId} onSubmit={submit} autoComplete="off">
          <fieldset disabled={Boolean(pending)} style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
            <ServerForm
              draft={draft}
              onChange={(next) => {
                setDraft(next);
                setReport(null);
                setTestTokenRequired(false);
              }}
              editing
              focusField={focusedField}
            />
          </fieldset>
        </form>
        <div>
          <Button disabled={Boolean(pending)} busy={pending === "test"} onClick={() => void testConnection()}>
            {t("serversTestConnection", "Test connection")}
          </Button>
        </div>
        {report && (
          <ServerTestReport
            report={report}
            view={{ ...view, label: draft.label, target: toEnvironmentDraft(draft).target }}
            onEdit={(_field, value) => {
              if (draft.kind === "ssh") {
                setDraft({ ...draft, remoteStateDir: value });
                setFocusedField("remoteStateDir");
                setReport(null);
              }
            }}
          />
        )}
        <section
          className="type-label-default"
          style={{
            padding: "var(--space-3)",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-card)",
            background: "var(--fx-surface-card)",
            color: "var(--fx-text-secondary)",
          }}
        >
          {workspace.loaded
            ? t("serversMountedCount", "{count} mounted project spaces").replace("{count}", String(spaces.length))
            : t("serversMountedUnknown", "Mounted project spaces are still loading.")}
          {spaces.length > 0 && (
            <ul
              className="type-mono-meta"
              style={{ paddingLeft: "var(--space-4)", marginBottom: 0, overflowWrap: "anywhere" }}
            >
              {spaces.map((space) => (
                <li key={space.key}>{space.displayPath}</li>
              ))}
            </ul>
          )}
        </section>
        <ServerActionError
          error={
            testTokenRequired
              ? t(
                  "serversTestTokenRequired",
                  "Enter the access token to test a changed WebSocket address. Saving with a blank token keeps the saved token.",
                )
              : error
          }
        />
      </div>
    </ModelDialogShell>
  );
}
