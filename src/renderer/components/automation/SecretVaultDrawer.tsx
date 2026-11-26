import { useCallback, useEffect, useRef, useState } from "react";
import { isAutomationSecretName } from "@shared/automation/secret-name";
import { useI18n } from "@/i18n";
import { Button, Field, NativeSelect, SecretTextInput, TextInput } from "@/components/form-controls";
import { useAutomationWorkspace } from "./automation-context";
import { EmptyState, HostChip, OfflineHostNotice } from "./automation-atoms";
import { AutomationIcon } from "./automation-icons";
import { SlideOverDrawer } from "./SlideOverDrawer";
import { drawerError } from "./drawer-utils";

type Confirmation = { kind: "set" | "delete"; name: string } | null;

export function SecretVaultDrawer({
  environmentId,
  locked = false,
  onClose,
}: {
  environmentId?: string;
  locked?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { hosts, command, notify, nativeConsentPending } = useAutomationWorkspace();
  const fallbackHostId =
    hosts.find((host) => host.environment.id === "primary")?.environment.id ?? hosts[0]?.environment.id ?? "";
  const [selectedHost, setSelectedHost] = useState(environmentId ?? fallbackHostId);
  const [names, setNames] = useState<readonly string[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [loading, setLoading] = useState(false);
  const [namesReady, setNamesReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const online = hosts.some((host) => host.environment.id === selectedHost && host.status === "online");
  const blocked = busy || loading || !online || nativeConsentPending !== null;
  const disabled = blocked || !namesReady;
  const targetName = editing ?? name;

  const loadNames = useCallback(async () => {
    if (!selectedHost || !online) return;
    const token = ++generation.current;
    setLoading(true);
    setNamesReady(false);
    setError(null);
    try {
      const result = await command(
        { type: "list-secret-names", environmentId: selectedHost },
        t("autoPageDrawerListSecretsConsent", "Read secret names"),
      );
      if (generation.current === token) {
        setNames([...result.names].sort());
        setNamesReady(true);
      }
    } catch (err) {
      if (generation.current === token) setError(drawerError(err));
    } finally {
      if (generation.current === token) setLoading(false);
    }
  }, [command, online, selectedHost, t]);

  useEffect(() => {
    setNames([]);
    setNamesReady(false);
    setName("");
    setValue("");
    setEditing(null);
    setConfirmation(null);
    setError(null);
    setLoading(false);
    void loadNames();
    return () => {
      generation.current += 1;
    };
  }, [loadNames]);

  useEffect(() => {
    if (pending.current) return;
    if (environmentId && locked && environmentId !== selectedHost) setSelectedHost(environmentId);
    else if (!selectedHost && fallbackHostId) setSelectedHost(fallbackHostId);
  }, [environmentId, fallbackHostId, locked, selectedHost]);

  const validate = () => {
    if (!isAutomationSecretName(targetName)) {
      setError(
        t(
          "autoPageDrawerSecretNameInvalid",
          "Use 1–80 lowercase letters, numbers, dots, underscores or hyphens for the name.",
        ),
      );
      return false;
    }
    if (!value.length || new TextEncoder().encode(value).byteLength > 65_536) {
      setError(t("autoPageDrawerSecretValueInvalid", "Enter a non-empty secret value no larger than 64 KiB."));
      return false;
    }
    return true;
  };
  const write = async (operation: Exclude<Confirmation, null>) => {
    if (pending.current || disabled || (operation.kind === "set" && !validate())) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (operation.kind === "delete") {
        await command(
          { type: "delete-secret", environmentId: selectedHost, name: operation.name },
          t("autoPageDrawerDeleteSecretConsent", "Delete secret"),
        );
        setNames((prior) => prior.filter((candidate) => candidate !== operation.name));
        notify(t("autoPageDrawerSecretDeleted", "Secret deleted."));
      } else {
        await command(
          { type: "set-secret", environmentId: selectedHost, name: operation.name, value },
          t("autoPageDrawerSetSecretConsent", "Save secret"),
        );
        setNames((prior) => [...new Set([...prior, operation.name])].sort());
        notify(t("autoPageDrawerSecretSaved", "Secret saved."));
      }
      setName("");
      setValue("");
      setEditing(null);
      setConfirmation(null);
    } catch (err) {
      setError(drawerError(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const save = () => {
    if (disabled || !validate()) return;
    if (names.includes(targetName)) setConfirmation({ kind: "set", name: targetName });
    else void write({ kind: "set", name: targetName });
  };
  const beginEdit = (secretName: string) => {
    setEditing(secretName);
    setName("");
    setValue("");
    setConfirmation(null);
    setError(null);
  };
  const reset = () => {
    setEditing(null);
    setName("");
    setValue("");
    setConfirmation(null);
    setError(null);
  };

  return (
    <SlideOverDrawer
      title={t("autoPageDrawerVaultTitle", "Secret vault")}
      onClose={() => {
        if (!pending.current && nativeConsentPending === null) onClose();
      }}
    >
      <div className="auto-page-drawer-stack">
        <p className="auto-page-muted type-body-relaxed">
          {t(
            "autoPageDrawerVaultHelp",
            "Secrets belong to one host. Only their names can be read; saved values are never shown or sent back to this page.",
          )}
        </p>
        <Field label={t("autoPageDrawerHost", "Host")}>
          <NativeSelect
            value={selectedHost}
            disabled={locked || busy || nativeConsentPending !== null}
            onChange={(event) => setSelectedHost(event.target.value)}
          >
            {!hosts.length && <option value="">{t("autoPageDrawerNoHosts", "No hosts available")}</option>}
            {hosts.map((host) => (
              <option key={host.environment.id} value={host.environment.id}>
                {host.environment.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {selectedHost && (
          <>
            <HostChip environmentId={selectedHost} />
            <OfflineHostNotice environmentId={selectedHost} />
          </>
        )}
        <section className="auto-page-vault-list">
          <div className="auto-page-section-heading">
            <h2 className="type-heading">{t("autoPageDrawerSavedSecrets", "Saved secrets")}</h2>
            <Button variant="ghost" disabled={blocked} onClick={() => void loadNames()}>
              {t("autoPageDrawerRefresh", "Refresh")}
            </Button>
          </div>
          {loading ? (
            <p role="status" className="auto-page-muted type-body-default">
              {t("autoPageDrawerLoadingSecrets", "Loading secret names…")}
            </p>
          ) : names.length ? (
            names.map((secretName) => (
              <div key={secretName} className="auto-page-vault-row">
                <span className="auto-page-secret-name type-mono-label">
                  <AutomationIcon name="key" />
                  {secretName}
                </span>
                <div className="auto-page-actions">
                  <Button variant="ghost" disabled={disabled} onClick={() => beginEdit(secretName)}>
                    {t("autoPageDrawerUpdateSecret", "Update")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    aria-label={t("autoPageDrawerDeleteNamedSecret", "Delete secret {name}").replace(
                      "{name}",
                      secretName,
                    )}
                    onClick={() => {
                      setConfirmation({ kind: "delete", name: secretName });
                      setError(null);
                    }}
                  >
                    <AutomationIcon name="trash" />
                  </Button>
                </div>
              </div>
            ))
          ) : online && !error ? (
            <EmptyState>{t("autoPageDrawerNoSecrets", "No saved secrets on this host.")}</EmptyState>
          ) : null}
        </section>
        {confirmation ? (
          <section className="auto-page-confirmation" aria-live="polite">
            <h2 className="type-heading">
              {confirmation.kind === "delete"
                ? t("autoPageDrawerDeleteSecretTitle", "Delete this secret?")
                : t("autoPageDrawerReplaceSecretTitle", "Replace this secret?")}
            </h2>
            <p className="type-mono-label">{confirmation.name}</p>
            <p className="auto-page-warning type-body-relaxed">
              {confirmation.kind === "delete"
                ? t(
                    "autoPageDrawerDeleteSecretWarning",
                    "Tasks using this secret may fail. The saved value cannot be recovered after deletion.",
                  )
                : t(
                    "autoPageDrawerReplaceSecretWarning",
                    "The existing value will be permanently replaced for every task using this name on this host.",
                  )}
            </p>
            <div className="auto-page-actions">
              <Button disabled={busy} onClick={() => setConfirmation(null)}>
                {t("autoPageDrawerCancel", "Cancel")}
              </Button>
              <Button
                variant={confirmation.kind === "delete" ? "danger" : "primary"}
                busy={busy}
                disabled={disabled}
                onClick={() => void write(confirmation)}
              >
                {confirmation.kind === "delete"
                  ? t("autoPageDrawerConfirmSecretDelete", "Delete secret permanently")
                  : t("autoPageDrawerConfirmSecretReplace", "Replace secret")}
              </Button>
            </div>
          </section>
        ) : (
          <section className="auto-page-vault-editor">
            <div className="auto-page-section-heading">
              <h2 className="type-heading">
                {editing
                  ? t("autoPageDrawerUpdateSecretTitle", "Update secret")
                  : t("autoPageDrawerAddSecretTitle", "Add secret")}
              </h2>
              {editing && (
                <Button variant="ghost" disabled={busy} onClick={reset}>
                  {t("autoPageDrawerAddAnotherSecret", "Add another")}
                </Button>
              )}
            </div>
            <fieldset className="auto-page-fieldset" disabled={disabled}>
              {editing ? (
                <p className="type-mono-label">{editing}</p>
              ) : (
                <Field label={t("autoPageDrawerSecretName", "Secret name")}>
                  <TextInput
                    value={name}
                    onChange={setName}
                    mono
                    placeholder={t("autoPageDrawerSecretNamePlaceholder", "service.api-key")}
                  />
                </Field>
              )}
              <Field label={t("autoPageDrawerSecretValue", "New secret value")}>
                <SecretTextInput
                  value={value}
                  onChange={setValue}
                  mono
                  placeholder={t("autoPageDrawerSecretValuePlaceholder", "Enter a new value")}
                />
              </Field>
            </fieldset>
            <p className="auto-page-muted type-label-default">
              {t(
                "autoPageDrawerSecretWriteOnly",
                "Leave this page to discard the unsaved value. Existing values cannot be revealed.",
              )}
            </p>
            <div className="auto-page-actions">
              <Button variant="primary" busy={busy} disabled={disabled || !targetName || !value} onClick={save}>
                {editing || names.includes(name)
                  ? t("autoPageDrawerReviewSecretUpdate", "Review update")
                  : t("autoPageDrawerSaveSecret", "Save secret")}
              </Button>
            </div>
          </section>
        )}
        {error && (
          <p role="alert" className="auto-page-error type-body-default">
            {error}
          </p>
        )}
      </div>
    </SlideOverDrawer>
  );
}
