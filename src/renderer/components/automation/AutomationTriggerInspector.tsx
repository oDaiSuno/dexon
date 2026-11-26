import type { ProbeCall, ScheduleTriggerSpec, TriggerSpec, WatchTriggerSpec } from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { Button, Check, Field, NativeSelect, TextInput } from "../form-controls";
import { AutomationIcon } from "./automation-icons";
import { EditorHttpFields, EditorScriptFields } from "./editor-action-fields";
import { EditorDurationField, EditorJsonField, EditorNumberField, EditorSection } from "./editor-controls";
import { editorNewTrigger, editorUniqueId } from "./editor-model";

interface TriggerInspectorProps {
  triggers: readonly TriggerSpec[];
  onChange: (triggers: readonly TriggerSpec[]) => void;
  environmentId: string;
  secretNames: readonly string[] | null;
}

export function AutomationTriggerInspector({ triggers, onChange, environmentId, secretNames }: TriggerInspectorProps) {
  const { t } = useI18n();
  const replace = (index: number, trigger: TriggerSpec) =>
    onChange(triggers.map((entry, current) => (current === index ? trigger : entry)));
  const manual = triggers.some((trigger) => trigger.kind === "manual");
  return (
    <div className="auto-page-editor-inspector-content">
      <EditorSection title={t("autoPageEditorTriggers", "Trigger settings")}>
        <Check
          label={t("autoPageEditorAllowManual", "Allow manual runs")}
          checked={manual}
          onChange={(enabled) =>
            onChange(
              enabled
                ? [...triggers, editorNewTrigger("manual", editorUniqueId("manual", triggers))]
                : triggers.filter((trigger) => trigger.kind !== "manual"),
            )
          }
        />
        <p className="auto-page-editor-muted type-label-default">
          {t("autoPageEditorTriggerHint", "Schedules and monitors start only after this revision is enabled.")}
        </p>
      </EditorSection>
      {triggers.map((trigger, index) => (
        <section className="auto-page-editor-trigger-card" key={index}>
          <div className="auto-page-editor-inline">
            <h3 className="type-heading">
              {trigger.kind === "manual"
                ? t("autoPageEditorManual", "Manual")
                : trigger.kind === "schedule"
                  ? t("autoPageEditorSchedule", "Schedule")
                  : t("autoPageEditorWatch", "Monitor")}
            </h3>
            <Button
              variant="ghost"
              aria-label={t("autoPageEditorDeleteTrigger", "Delete trigger")}
              onClick={() => onChange(triggers.filter((_, current) => current !== index))}
            >
              <AutomationIcon name="trash" />
            </Button>
          </div>
          <Field label={t("autoPageEditorTriggerId", "Trigger ID")}>
            <TextInput mono value={trigger.id} onChange={(id) => replace(index, { ...trigger, id })} />
          </Field>
          {trigger.kind === "schedule" && (
            <ScheduleFields trigger={trigger} onChange={(next) => replace(index, next)} />
          )}
          {trigger.kind === "watch" && (
            <WatchFields
              trigger={trigger}
              onChange={(next) => replace(index, next)}
              environmentId={environmentId}
              secretNames={secretNames}
            />
          )}
        </section>
      ))}
      <div className="auto-page-editor-inline">
        <Button
          onClick={() => onChange([...triggers, editorNewTrigger("schedule", editorUniqueId("schedule", triggers))])}
        >
          <AutomationIcon name="plus" />
          {t("autoPageEditorAddSchedule", "Add schedule")}
        </Button>
        <Button onClick={() => onChange([...triggers, editorNewTrigger("watch", editorUniqueId("watch", triggers))])}>
          <AutomationIcon name="plus" />
          {t("autoPageEditorAddWatch", "Add monitor")}
        </Button>
      </div>
    </div>
  );
}

function ScheduleFields({
  trigger,
  onChange,
}: {
  trigger: ScheduleTriggerSpec;
  onChange: (trigger: ScheduleTriggerSpec) => void;
}) {
  const { t } = useI18n();
  const cron = "cron" in trigger;
  return (
    <>
      <Field label={t("autoPageEditorScheduleType", "Schedule type")}>
        <NativeSelect
          value={cron ? "cron" : "every"}
          onChange={(event) => {
            const base = {
              id: trigger.id,
              kind: "schedule" as const,
              catchup: trigger.catchup,
              catchupWindow: trigger.catchupWindow,
              input: trigger.input,
            };
            onChange(
              event.target.value === "cron" ? { ...base, cron: "0 9 * * *", tz: "UTC" } : { ...base, every: "1h" },
            );
          }}
        >
          <option value="cron">{t("autoPageEditorCron", "Calendar (cron)")}</option>
          <option value="every">{t("autoPageEditorInterval", "Fixed interval")}</option>
        </NativeSelect>
      </Field>
      {cron ? (
        <>
          <Field label={t("autoPageEditorCronExpression", "Cron expression")}>
            <TextInput mono value={trigger.cron} onChange={(value) => onChange({ ...trigger, cron: value })} />
          </Field>
          <Field label={t("autoPageEditorTimezone", "Time zone")}>
            <TextInput mono value={trigger.tz ?? "UTC"} onChange={(tz) => onChange({ ...trigger, tz })} />
          </Field>
        </>
      ) : (
        <EditorDurationField
          label={t("autoPageEditorEvery", "Run every")}
          value={trigger.every}
          optional={false}
          onChange={(every) => {
            if (every) onChange({ ...trigger, every });
          }}
        />
      )}
      <Field label={t("autoPageEditorCatchup", "When a scheduled time was missed")}>
        <NativeSelect
          value={trigger.catchup ?? "skip"}
          onChange={(event) => onChange({ ...trigger, catchup: event.target.value === "once" ? "once" : "skip" })}
        >
          <option value="skip">{t("autoPageEditorCatchupSkip", "Skip missed runs")}</option>
          <option value="once">{t("autoPageEditorCatchupOnce", "Catch up once within the window")}</option>
        </NativeSelect>
      </Field>
      <EditorDurationField
        label={t("autoPageEditorCatchupWindow", "Catch-up window")}
        value={trigger.catchupWindow}
        onChange={(catchupWindow) => onChange({ ...trigger, catchupWindow })}
      />
      <EditorJsonField
        label={t("autoPageEditorTriggerInput", "Run input (literal JSON)")}
        value={trigger.input}
        onChange={(input) => onChange({ ...trigger, input })}
      />
    </>
  );
}

function WatchFields({
  trigger,
  onChange,
  environmentId,
  secretNames,
}: {
  trigger: WatchTriggerSpec;
  onChange: (trigger: WatchTriggerSpec) => void;
  environmentId: string;
  secretNames: readonly string[] | null;
}) {
  const { t } = useI18n();
  const mode = trigger.mode;
  const probeChange = (probe: ProbeCall) => onChange({ ...trigger, probe });
  return (
    <>
      <EditorDurationField
        label={t("autoPageEditorWatchEvery", "Check every (minimum 30s)")}
        value={trigger.every}
        optional={false}
        onChange={(every) => {
          if (every) onChange({ ...trigger, every });
        }}
      />
      <Field label={t("autoPageEditorProbeType", "Read-only probe")}>
        <NativeSelect
          value={trigger.probe.action}
          onChange={(event) =>
            probeChange(
              event.target.value === "script.run"
                ? { action: "script.run", with: { path: "scripts/probe.sh", effect: "read" } }
                : {
                    action: "http.request",
                    with: { method: "GET", url: { origin: "https://example.com" }, effect: "read" },
                  },
            )
          }
        >
          <option value="http.request">{t("autoPageEditorHttpProbe", "HTTP request")}</option>
          <option value="script.run">{t("autoPageEditorScriptProbe", "Local script")}</option>
        </NativeSelect>
      </Field>
      {trigger.probe.action === "http.request" ? (
        <EditorHttpFields
          readOnly
          value={trigger.probe.with}
          environmentId={environmentId}
          secretNames={secretNames}
          onChange={(value) =>
            probeChange({
              action: "http.request",
              with: { ...value, method: value.method === "HEAD" ? "HEAD" : "GET", effect: "read" },
            })
          }
        />
      ) : (
        <EditorScriptFields
          readOnly
          value={trigger.probe.with}
          environmentId={environmentId}
          secretNames={secretNames}
          onChange={(value) => probeChange({ action: "script.run", with: { ...value, effect: "read" } })}
        />
      )}
      <Field label={t("autoPageEditorWatchMode", "Monitor mode")}>
        <NativeSelect
          value={mode.type}
          onChange={(event) =>
            onChange({
              ...trigger,
              mode:
                event.target.value === "items"
                  ? { type: "items", itemsPath: "items", keyPath: "id", emit: { startRun: {} } }
                  : { type: "threshold", healthy: { ref: "probe.ok", op: "eq", value: true }, consecutive: 1 },
            })
          }
        >
          <option value="threshold">{t("autoPageEditorThreshold", "Health threshold")}</option>
          <option value="items">{t("autoPageEditorItems", "New matching items")}</option>
        </NativeSelect>
      </Field>
      {mode.type === "threshold" ? (
        <>
          <EditorJsonField
            label={t("autoPageEditorHealthy", "Healthy condition (probe.ok / probe.output)")}
            value={mode.healthy}
            shape="condition"
            optional={false}
            onChange={(healthy) => {
              if (healthy) onChange({ ...trigger, mode: { ...mode, healthy } });
            }}
          />
          <EditorNumberField
            label={t("autoPageEditorConsecutive", "Consecutive unhealthy checks before firing")}
            value={mode.consecutive}
            onChange={(consecutive) => onChange({ ...trigger, mode: { ...mode, consecutive: consecutive ?? 0 } })}
          />
          <EditorDurationField
            label={t("autoPageEditorCooldown", "Cooldown after firing")}
            value={mode.cooldown}
            onChange={(cooldown) => onChange({ ...trigger, mode: { ...mode, cooldown } })}
          />
          <EditorDurationField
            label={t("autoPageEditorThresholdStale", "Threshold stale-reset gap")}
            value={mode.staleResetGap}
            onChange={(staleResetGap) => onChange({ ...trigger, mode: { ...mode, staleResetGap } })}
          />
        </>
      ) : (
        <>
          <Field label={t("autoPageEditorItemsPath", "Items path in probe output")}>
            <TextInput
              mono
              value={mode.itemsPath}
              onChange={(itemsPath) => onChange({ ...trigger, mode: { ...mode, itemsPath } })}
            />
          </Field>
          <Field label={t("autoPageEditorItemKeyPath", "Unique item key path")}>
            <TextInput
              mono
              value={mode.keyPath}
              onChange={(keyPath) => onChange({ ...trigger, mode: { ...mode, keyPath } })}
            />
          </Field>
          <Field label={t("autoPageEditorCursorPath", "Cursor path (optional)")}>
            <TextInput
              mono
              value={mode.cursorPath ?? ""}
              onChange={(cursorPath) =>
                onChange({ ...trigger, mode: { ...mode, cursorPath: cursorPath || undefined } })
              }
            />
          </Field>
          <EditorDurationField
            label={t("autoPageEditorDedupeWindow", "Item deduplication window")}
            value={mode.dedupeWindow}
            onChange={(dedupeWindow) => onChange({ ...trigger, mode: { ...mode, dedupeWindow } })}
          />
          <EditorJsonField
            label={t("autoPageEditorItemMatch", "Item filter condition (item / item.*)")}
            value={mode.match}
            shape="condition"
            onChange={(match) => onChange({ ...trigger, mode: { ...mode, match } })}
          />
          <Field label={t("autoPageEditorItemEmission", "For each new matching item")}>
            <NativeSelect
              value={"startRun" in mode.emit ? "run" : "signal"}
              onChange={(event) =>
                onChange({
                  ...trigger,
                  mode: { ...mode, emit: event.target.value === "signal" ? { emitSignal: "ready" } : { startRun: {} } },
                })
              }
            >
              <option value="run">{t("autoPageEditorStartRun", "Start a run")}</option>
              <option value="signal">{t("autoPageEditorEmitSignal", "Emit a signal")}</option>
            </NativeSelect>
          </Field>
          {"startRun" in mode.emit ? (
            <EditorJsonField
              label={t("autoPageEditorItemInput", "Run input (JSON; item references allowed)")}
              value={mode.emit.startRun.input}
              onChange={(input) => onChange({ ...trigger, mode: { ...mode, emit: { startRun: { input } } } })}
            />
          ) : (
            <>
              <Field label={t("autoPageEditorSignalName", "Signal name")}>
                <TextInput
                  value={mode.emit.emitSignal}
                  onChange={(emitSignal) =>
                    onChange({ ...trigger, mode: { ...mode, emit: { ...mode.emit, emitSignal } } })
                  }
                />
              </Field>
              <EditorJsonField
                label={t("autoPageEditorSignalPayload", "Signal payload (JSON)")}
                value={mode.emit.payload}
                onChange={(payload) => {
                  if ("emitSignal" in mode.emit)
                    onChange({ ...trigger, mode: { ...mode, emit: { ...mode.emit, payload } } });
                }}
              />
            </>
          )}
        </>
      )}
      <EditorDurationField
        label={t("autoPageEditorStaleReset", "Reset monitor state after a stale gap")}
        value={trigger.staleResetGap}
        onChange={(staleResetGap) => onChange({ ...trigger, staleResetGap })}
      />
    </>
  );
}
