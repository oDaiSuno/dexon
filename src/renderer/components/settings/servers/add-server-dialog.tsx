import { useId, useState, type FormEvent } from "react";
import type { DiscoveredSshHost } from "@contract/environment-commands";
import type { EnvironmentView } from "@contract/environment";
import { useI18n } from "@/i18n";
import { useEnvironmentsSnapshot } from "@/lib/environment-registry";
import { presentConnection } from "@/lib/connection-presentation";
import { Button } from "../../form-controls";
import { ModelDialogShell } from "../../models/model-dialog-shell";
import { createServerDraft, toEnvironmentDraft } from "./server-draft";
import { ServerForm } from "./server-form";
import { SshHostList } from "./ssh-host-list";
import { ProvisioningSteps } from "./provisioning-steps";
import { ServerDiagnosisCard } from "./server-diagnosis-card";
import { ServerActionError, ServerFooter, ServerIcon, ServerTabs, serverStackStyle } from "./server-ui";
import { useServerActions } from "./use-server-actions";

export type AddServerTab = "ssh-config" | "manual";

export function AddServerDialog({
  initialTab = "ssh-config",
  onClose,
  onOpenProject,
  onEdit,
}: {
  initialTab?: AddServerTab;
  onClose: () => void;
  onOpenProject?: (environmentId: string) => void;
  onEdit?: (view: EnvironmentView, field: "remoteStateDir", suggestedValue: string) => void;
}) {
  const { t } = useI18n();
  const formId = useId();
  const { environments } = useEnvironmentsSnapshot();
  const { run, pending, error } = useServerActions();
  const [tab, setTab] = useState<AddServerTab>(initialTab);
  const [draft, setDraft] = useState(createServerDraft);
  const [created, setCreated] = useState<EnvironmentView | null>(null);
  const current = environments.find((view) => view.id === created?.id) ?? created;
  const presentation = current ? presentConnection(current, Date.now()) : null;
  const dirty = !created && JSON.stringify(draft) !== JSON.stringify(createServerDraft());

  const connectHost = async (host: DiscoveredSshHost) => {
    const result = await run({
      type: "add",
      draft: { label: host.alias, target: { kind: "ssh", sshAlias: host.alias } },
      connect: true,
    });
    if (result.ok) setCreated(result.value);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void run({ type: "add", draft: toEnvironmentDraft(draft), connect: true }).then((result) => {
      if (result.ok) {
        setCreated(result.value);
        setDraft(createServerDraft());
      }
    });
  };

  return (
    <ModelDialogShell
      width={tab === "ssh-config" ? 660 : 624}
      dirty={Boolean(dirty)}
      title={t("serversAddTitle", "Add remote server")}
      subtitle={t(
        "serversAddSubtitle",
        "Choose a local SSH host or enter connection details to connect and deploy the remote service.",
      )}
      leading={<ServerIcon />}
      divided
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <ServerFooter
          leading={
            tab === "manual" && !created ? (
              <Button variant="ghost" disabled={Boolean(pending)} onClick={() => setTab("ssh-config")}>
                {t("serversBackToSsh", "Back to SSH hosts")}
              </Button>
            ) : undefined
          }
        >
          <Button onClick={onClose} disabled={Boolean(pending)}>
            {created || tab === "ssh-config" ? t("close", "Close") : t("cancel", "Cancel")}
          </Button>
          {!created && tab === "manual" && (
            <Button type="submit" form={formId} variant="primary" disabled={Boolean(pending)} busy={pending === "add"}>
              {t("serversAddConnect", "Add and connect")}
            </Button>
          )}
          {current && presentation?.canSend && onOpenProject && (
            <Button variant="primary" onClick={() => onOpenProject(current.id)}>
              {t("serversOpenProject", "Open project")}
            </Button>
          )}
        </ServerFooter>
      }
    >
      <div style={serverStackStyle}>
        {!created && (
          <ServerTabs
            label={t("serversAddSource", "Server source")}
            value={tab}
            disabled={Boolean(pending)}
            options={[
              { value: "ssh-config", label: t("serversSshConfigTab", "From local SSH config (recommended)") },
              { value: "manual", label: t("serversManualTab", "Enter connection details") },
            ]}
            onChange={setTab}
          />
        )}
        {current && presentation ? (
          <section style={{ display: "grid", gap: "var(--space-3)" }} aria-live="polite">
            <strong className="type-body-medium">{current.label}</strong>
            <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
              {presentation.canSend
                ? t("serversAddedConnected", "The server is connected. You can now open a remote project.")
                : t(
                    "serversAddedPreparing",
                    "The server has been added. Connection and remote setup continue in the background.",
                  )}
            </p>
            <ProvisioningSteps presentation={presentation} />
            {presentation.diagnosis && onEdit && (
              <ServerDiagnosisCard
                context="connection"
                diagnosis={presentation.diagnosis}
                view={current}
                onEdit={(field, value) => onEdit(current, field, value)}
              />
            )}
          </section>
        ) : tab === "ssh-config" ? (
          <SshHostList
            busy={Boolean(pending)}
            onConnect={(host) => void connectHost(host)}
            onManual={() => setTab("manual")}
          />
        ) : (
          <form id={formId} onSubmit={submit} autoComplete="off">
            <fieldset disabled={Boolean(pending)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <ServerForm draft={draft} onChange={setDraft} />
            </fieldset>
          </form>
        )}
        <ServerActionError error={error} />
      </div>
    </ModelDialogShell>
  );
}
