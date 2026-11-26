import type { TaskSpec } from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { Check, Field, NativeSelect } from "../form-controls";
import { EditorJsonField, EditorNumberField, EditorTextField } from "./editor-controls";

export function EditorTaskSettings({ spec, onChange }: { spec: TaskSpec; onChange: (spec: TaskSpec) => void }) {
  const { t } = useI18n();
  const concurrency = spec.concurrency ?? {};
  const lane = concurrency.lane;
  return (
    <details className="auto-page-editor-advanced">
      <summary className="type-label-medium">{t("autoPageEditorTaskAdvanced", "Advanced task settings")}</summary>
      <EditorJsonField
        label={t("autoPageEditorInputSchema", "Manual run input schema (JSON)")}
        value={spec.inputSchema}
        shape="object"
        onChange={(inputSchema) => onChange({ ...spec, inputSchema })}
      />
      <EditorNumberField
        label={t("autoPageEditorMaxExecuting", "Maximum simultaneous runs")}
        value={concurrency.maxExecuting}
        onChange={(maxExecuting) => onChange({ ...spec, concurrency: { ...concurrency, maxExecuting } })}
      />
      <Check
        label={t("autoPageEditorUseLane", "Limit runs sharing a concurrency key")}
        checked={!!lane}
        onChange={(enabled) =>
          onChange({
            ...spec,
            concurrency: { ...concurrency, lane: enabled ? { capacity: 1, overflow: "queue" } : undefined },
          })
        }
      />
      {lane && (
        <>
          <EditorTextField
            label={t("autoPageEditorLaneKey", "Concurrency key (optional text template)")}
            value={lane.key ?? ""}
            onChange={(key) => onChange({ ...spec, concurrency: { ...concurrency, lane: { ...lane, key } } })}
          />
          <EditorNumberField
            label={t("autoPageEditorLaneCapacity", "Runs allowed per key")}
            value={lane.capacity}
            onChange={(capacity) =>
              onChange({ ...spec, concurrency: { ...concurrency, lane: { ...lane, capacity: capacity ?? 0 } } })
            }
          />
          <Field label={t("autoPageEditorOverflow", "When the concurrency key is full")}>
            <NativeSelect
              value={lane.overflow}
              onChange={(event) =>
                onChange({
                  ...spec,
                  concurrency: {
                    ...concurrency,
                    lane: {
                      ...lane,
                      overflow:
                        event.target.value === "skip" ? "skip" : event.target.value === "latest" ? "latest" : "queue",
                    },
                  },
                })
              }
            >
              <option value="queue">{t("autoPageEditorOverflowQueue", "Queue incoming runs")}</option>
              <option value="skip">{t("autoPageEditorOverflowSkip", "Skip incoming runs")}</option>
              <option value="latest">{t("autoPageEditorOverflowLatest", "Keep only the latest pending run")}</option>
            </NativeSelect>
          </Field>
          <EditorNumberField
            label={t("autoPageEditorMaxPending", "Maximum pending runs per key")}
            minimum={0}
            value={lane.maxPending}
            onChange={(maxPending) =>
              onChange({ ...spec, concurrency: { ...concurrency, lane: { ...lane, maxPending } } })
            }
          />
        </>
      )}
    </details>
  );
}
