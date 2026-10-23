import { useState } from "react";
import { Button } from "../form-controls";
import { useI18n } from "@/i18n";
import {
  deleteModelEntry,
  deleteProviderEntry,
  nextCustomProviderName,
  saveModelEntry,
  saveProviderEntry,
  type ModelEntry,
  type ProviderEntry,
} from "@/lib/models-config-state";
import { ModelDialog, useModelMeta } from "./model-dialog";
import { ModelDialogShell, useSaveNotice } from "./model-dialog-shell";
import { DialogFooter } from "./models-footer";
import { ProviderDetail } from "./provider-detail";
import { ProviderLogoTile } from "./provider-icon";
import { useProviderLabels } from "./provider-tree";
import type { ModelsConfigEditor } from "./use-models-config";

const rowHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "var(--fx-surface-hover-clear)";
  },
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  border: "none",
  borderRadius: "var(--radius-control)",
  background: "var(--fx-surface-hover-clear)",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
};

function ProviderModelList({
  models,
  onOpen,
  onAdd,
}: {
  models: ModelEntry[];
  onOpen: (index: number) => void;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  const metaOf = useModelMeta();
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h3 className="type-body-large-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
        {t("models", "Models")}
      </h3>
      <div style={{ display: "grid" }}>
        {models.map((model, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onOpen(index)}
            {...rowHover}
            style={{
              ...rowStyle,
              height: 44,
              padding: "0 var(--space-2) 0 var(--space-1)",
              boxShadow: index > 0 ? "inset 0 1px 0 var(--fx-line-default)" : undefined,
            }}
          >
            <span
              className="type-mono-body"
              style={{
                flex: 1,
                minWidth: 0,
                color: model.id ? "var(--fx-text-primary)" : "var(--fx-text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {model.id || t("modelNewModel", "new model")}
            </span>
            <span className="type-body-default" style={{ color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>
              {metaOf(model)}
            </span>
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        {...rowHover}
        style={{ ...rowStyle, gap: 8, height: 40, padding: "0 var(--space-1)", color: "var(--fx-text-secondary)" }}
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="type-body-default">{t("modelAddModel", "Add model")}</span>
      </button>
    </section>
  );
}

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
        title={name.trim() || initial.name}
        subtitle={labels.customMeta(entry)}
        leading={<ProviderLogoTile id={name} />}
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
        <div
          style={{
            display: "grid",
            gap: "var(--space-6)",
            padding: "var(--space-5) var(--space-5) var(--space-2)",
          }}
        >
          <ProviderDetail name={name} provider={entry} onNameChange={setName} onChange={setEntry} />
          <ProviderModelList
            models={models}
            onOpen={(index) => setModelTarget({ index })}
            onAdd={() => setModelTarget({ index: null })}
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
