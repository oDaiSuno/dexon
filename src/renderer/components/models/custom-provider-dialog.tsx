import { useState } from "react";
import { Button } from "../form-controls";
import { useI18n } from "@/i18n";
import {
  deleteModelEntry,
  deleteProviderEntry,
  nextCustomProviderName,
  saveModelEntry,
  saveProviderEntry,
  type ProviderEntry,
} from "@/lib/models-config-state";
import { ModelDialog } from "./model-dialog";
import { ModelDialogShell, useSaveNotice } from "./model-dialog-shell";
import { DialogFooter } from "./models-footer";
import { ChannelTestRow } from "./channel-test-row";
import { useChannelStatus } from "./channel-status";
import { ProviderDetail } from "./provider-detail";
import { DialogLogoTile, EditableDialogTitle, HeaderStatus } from "./provider-dialog-parts";
import { useProviderLabels } from "./provider-tree";
import { modelSelectionOf, type ModelsConfigEditor } from "./use-models-config";

export function CustomProviderDialog({
  editor,
  originalName,
  onClose,
}: {
  editor: ModelsConfigEditor;
  originalName: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const labels = useProviderLabels(editor.modelPreferences);
  const channelStatus = useChannelStatus();
  const [initial] = useState(() => ({
    name: originalName ?? nextCustomProviderName(editor.config),
    entry: {
      ...((originalName !== null && editor.config.providers?.[originalName]) || {}),
      api: (originalName !== null && editor.config.providers?.[originalName]?.api) || "openai-completions",
    },
  }));
  const [name, setName] = useState(initial.name);
  const [entry, setEntry] = useState<ProviderEntry>(initial.entry);
  const [modelTarget, setModelTarget] = useState<{ index: number | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { notice, setNotice, report } = useSaveNotice(editor.loadModelsConfig);
  const dirty = name !== initial.name || JSON.stringify(entry) !== JSON.stringify(initial.entry);
  const models = entry.models ?? [];

  const save = async () => {
    const result = saveProviderEntry(editor.config, originalName, name, entry);
    if (!result.ok) {
      setNotice({ tone: "danger", text: result.error });
      return;
    }
    const persisted = await editor.persist(result.config);
    report(persisted);
    if (persisted.ok) onClose();
  };

  const remove = async () => {
    if (originalName === null) return;
    setDeleting(true);
    const persisted = await editor.persist(deleteProviderEntry(editor.config, originalName));
    setDeleting(false);
    report(persisted);
    if (persisted.ok) onClose();
  };

  const confirmRemove = () =>
    setNotice({
      tone: "danger",
      text: t("modelDeleteProviderConfirm", "Delete “{name}”? This takes effect immediately.").replace(
        "{name}",
        originalName ?? name,
      ),
      action: (
        <>
          <Button variant="ghost" onClick={() => setNotice(null)}>
            {t("cancel", "Cancel")}
          </Button>
          <Button variant="danger" onClick={() => void remove()}>
            {t("delete", "Delete")}
          </Button>
        </>
      ),
    });

  const editingModel = modelTarget && (modelTarget.index === null ? { id: "" } : (models[modelTarget.index] ?? null));

  return (
    <>
      <ModelDialogShell
        width={560}
        divided
        dirty={dirty}
        title={<EditableDialogTitle value={name.trim() || initial.name} onCommit={setName} />}
        subtitle={labels.customMeta(entry)}
        leading={<DialogLogoTile id={name} />}
        trailing={
          originalName === null ? undefined : <HeaderStatus {...channelStatus.status(editor.channels[originalName])} />
        }
        notice={notice}
        onClose={onClose}
        footer={
          <DialogFooter
            padding="var(--space-3) var(--space-4) var(--space-3) var(--space-3)"
            deleteLabel={originalName === null ? undefined : t("modelDeleteProvider", "Delete channel")}
            onDelete={confirmRemove}
            onCancel={onClose}
            onSave={() => void save()}
            saving={editor.saving && !deleting}
            deleting={deleting}
            saveDisabled={!dirty || !editor.configVersion}
          />
        }
      >
        <div style={{ padding: "20px 20px 8px" }}>
          <ProviderDetail
            savedName={originalName}
            provider={entry}
            onChange={setEntry}
            modelSelection={modelSelectionOf(editor)}
            onOpenModel={(index) => setModelTarget({ index })}
            onAddModel={() => setModelTarget({ index: null })}
            connectionTest={
              originalName === null ? undefined : (
                <ChannelTestRow
                  channel={editor.channels[originalName]}
                  onTest={() => editor.testChannel(originalName)}
                  blockedReason={dirty ? t("modelSaveBeforeTest", "Save your changes before testing") : undefined}
                />
              )
            }
          />
        </div>
      </ModelDialogShell>
      {modelTarget && editingModel && (
        <ModelDialog
          providerName={name.trim() || initial.name}
          provider={entry}
          model={editingModel}
          isNew={modelTarget.index === null}
          onSave={(model) => {
            setEntry((current) => saveModelEntry(current, modelTarget.index, model));
            setModelTarget(null);
          }}
          onDelete={() => {
            if (modelTarget.index !== null) {
              const index = modelTarget.index;
              setEntry((current) => deleteModelEntry(current, index));
            }
            setModelTarget(null);
          }}
          onClose={() => setModelTarget(null)}
        />
      )}
    </>
  );
}
