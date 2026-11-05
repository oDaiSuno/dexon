import { useId, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { PRIMARY_ENVIRONMENT_ID, type AddEnvironmentInput, type EnvironmentView } from "@contract/environment";
import { useI18n } from "@/i18n";
import {
  addRemoteEnvironment,
  connectRemoteEnvironment,
  disconnectRemoteEnvironment,
  removeRemoteEnvironment,
  useEnvironments,
} from "@/lib/environment-registry";
import { Badge, Button, NativeSelect } from "../form-controls";
import { SettingGroup, SettingNote, SettingRow } from "./setting-row";

type ConnectionKind = AddEnvironmentInput["target"]["kind"];
type EnvironmentField = InputHTMLAttributes<HTMLInputElement> & { name: string; label: string };

export function EnvironmentSettingsSection() {
  const { t } = useI18n();
  const environments = useEnvironments();
  const controlId = useId();
  const [kind, setKind] = useState<ConnectionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const busyRef = useRef(false);
  const canAdd = typeof window.piBridge?.addEnvironment === "function";
  const statuses: Record<EnvironmentView["status"]["phase"], string> = {
    connected: t("environmentConnected", "Connected"),
    connecting: t("environmentConnecting", "Connecting"),
    backoff: t("environmentBackoff", "Retrying"),
    blocked: t("environmentBlocked", "Blocked"),
    offline: t("environmentOffline", "Offline"),
    available: t("environmentAvailable", "Available"),
  };
  const fields: EnvironmentField[] = [
    { name: "label", label: t("environmentLabel", "Environment name"), required: true },
    ...(kind === "ssh"
      ? [
          { name: "sshAlias", label: t("environmentSshAlias", "SSH alias"), required: true },
          { name: "hostname", label: t("environmentHostname", "Hostname (optional)") },
          { name: "user", label: t("environmentUser", "User (optional)") },
          { name: "port", label: t("environmentPort", "Port (optional)"), type: "number", min: 1, max: 65535, step: 1 },
        ]
      : [
          {
            name: "url",
            label: t("environmentWebSocketUrl", "WebSocket URL"),
            type: "url",
            required: true,
            pattern: "wss?://.+",
          },
          { name: "authToken", label: t("environmentAuthToken", "Authentication token (optional)"), type: "password" },
        ]),
  ];

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!kind || !canAdd || busyRef.current || !event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const input: AddEnvironmentInput = {
      label: value("label"),
      target:
        kind === "ssh"
          ? {
              kind: "ssh",
              sshAlias: value("sshAlias"),
              hostname: value("hostname") || undefined,
              user: value("user") || undefined,
              port: value("port") ? Number(value("port")) : undefined,
            }
          : { kind: "websocket", url: value("url") },
    };
    if (kind === "websocket") {
      input.authToken = String(data.get("authToken") ?? "") || undefined;
      data.delete("authToken");
      const tokenField = form.elements.namedItem("authToken");
      if (tokenField instanceof HTMLInputElement) tokenField.value = "";
    }
    if (!input.label || (input.target.kind === "ssh" && !input.target.sshAlias)) {
      setFailed(true);
      return;
    }
    void run(async () => {
      await addRemoteEnvironment(input);
      setKind(null);
    });
  };

  return (
    <SettingGroup
      title={t("environmentSettings", "Development environments")}
      action={
        canAdd &&
        !kind && (
          <Button
            disabled={busy}
            onClick={() => {
              setFailed(false);
              setKind("ssh");
            }}
          >
            {t("environmentAdd", "Add environment")}
          </Button>
        )
      }
      notes={
        failed && (
          <SettingNote alert>
            {t("environmentActionFailed", "The environment action failed. Check the connection details and try again.")}
          </SettingNote>
        )
      }
    >
      {environments.map((environment) => {
        const primary = environment.id === PRIMARY_ENVIRONMENT_ID || environment.target.kind === "primary";
        const phase = environment.status.phase;
        const active = phase === "connected" || phase === "connecting" || phase === "backoff";
        const statusId = `${controlId}-${environment.id}`;
        return (
          <SettingRow
            key={environment.id}
            label={environment.label}
            description={
              environment.target.kind === "ssh"
                ? environment.target.sshAlias
                : environment.target.kind === "websocket"
                  ? environment.target.url
                  : t("environmentPrimaryDescription", "This device")
            }
            controlId={statusId}
          >
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)" }}>
              <output id={statusId}>
                <Badge tone={phase === "connected" ? "success" : phase === "blocked" ? "danger" : "muted"}>
                  {statuses[phase]}
                </Badge>
              </output>
              {!primary && (
                <>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        active ? disconnectRemoteEnvironment(environment.id) : connectRemoteEnvironment(environment.id),
                      )
                    }
                  >
                    {active ? t("environmentDisconnect", "Disconnect") : t("environmentConnect", "Connect")}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!(await removeRemoteEnvironment(environment.id)).ok) setFailed(true);
                      })
                    }
                  >
                    {t("environmentRemove", "Remove")}
                  </Button>
                </>
              )}
            </div>
          </SettingRow>
        );
      })}
      {canAdd && kind && (
        <form onSubmit={submit} autoComplete="off">
          <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <SettingRow label={t("environmentConnectionType", "Connection type")} controlId={`${controlId}-kind`}>
              <NativeSelect
                id={`${controlId}-kind`}
                value={kind}
                onChange={(event) => setKind(event.target.value as ConnectionKind)}
              >
                <option value="ssh">{t("environmentSsh", "SSH")}</option>
                <option value="websocket">{t("environmentWebSocket", "WebSocket")}</option>
              </NativeSelect>
            </SettingRow>
            {fields.map(({ label, ...field }) => (
              <SettingRow key={field.name} label={label} controlId={`${controlId}-${field.name}`}>
                <input
                  {...field}
                  id={`${controlId}-${field.name}`}
                  className="ui-input type-body-default"
                  autoComplete="off"
                  spellCheck={false}
                />
              </SettingRow>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-2)",
                padding: "var(--space-4) var(--space-5)",
              }}
            >
              <Button
                onClick={() => {
                  setKind(null);
                  setFailed(false);
                }}
              >
                {t("cancel", "Cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={busy} busy={busy}>
                {t("environmentAdd", "Add environment")}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </SettingGroup>
  );
}
