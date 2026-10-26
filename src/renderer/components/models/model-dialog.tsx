import { useState } from "react";
import { useI18n } from "@/i18n";
import type { ModelEntry, ProviderEntry } from "@/lib/models-config-state";
import { ModelDetail } from "./model-detail";
import { ModelDialogShell } from "./model-dialog-shell";
import { ModelTestButton, ModelTestStatus, useModelConnectionTest } from "./model-connection-test";
import { DialogFooter } from "./models-footer";

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

export function useModelMeta() {
  const { t } = useI18n();
  return (model: ModelEntry) =>
    [
      model.contextWindow ? compactTokens(model.contextWindow) : null,
      model.reasoning ? t("modelReasoningShort", "reasoning") : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

export function ModelDialog({
  providerName,
  provider,
  model,
  isNew,
  onSave,
  onDelete,
  onClose,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  isNew: boolean;
  onSave: (model: ModelEntry) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ModelEntry>(model);
  const test = useModelConnectionTest({ providerName, provider, model: draft });
  const dirty = JSON.stringify(draft) !== JSON.stringify(model);

  return (
    <ModelDialogShell
      width={520}
      elevated
      layer={1}
      dirty={dirty}
      title={t("modelConfigure", "Configure model")}
      subtitle={`${providerName} · ${draft.id.trim() || t("modelNewModel", "new model")}`}
      onClose={onClose}
      footer={
        <DialogFooter
          padding="var(--space-3) var(--space-5) var(--space-3) var(--space-4)"
          deleteLabel={isNew ? undefined : t("modelRemove", "Delete model")}
          deleteDanger
          onDelete={onDelete}
          leading={<ModelTestStatus state={test.state} summary={test.summary} />}
          actions={<ModelTestButton state={test.state} disabled={test.disabled} onTest={() => void test.run()} />}
          onCancel={onClose}
          onSave={() => onSave(draft)}
          saving={false}
          saveDisabled={!draft.id.trim()}
        />
      }
    >
      <div style={{ padding: "var(--space-4) var(--space-5) var(--space-5)" }}>
        <ModelDetail model={draft} onChange={setDraft} />
      </div>
    </ModelDialogShell>
  );
}
