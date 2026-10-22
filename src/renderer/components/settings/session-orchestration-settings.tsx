import { useEffect, useId, useState } from "react";
import { useI18n } from "@/i18n";
import { listModels } from "@/lib/api-client";
import {
  DEFAULT_SESSION_ORCHESTRATION_SETTINGS,
  SESSION_ORCHESTRATION_LIMITS,
  SESSION_THINKING_LEVELS,
  normalizeSessionOrchestrationSettings,
  type SessionOrchestrationSettings as Settings,
  type SessionThinkingLevel,
} from "@shared/session-orchestration";
import { SettingRow, selectClassName, selectStyle } from "./setting-row";
import { Toggle } from "../form-controls";

interface ModelOption {
  provider: string;
  id: string;
  name: string;
}

function modelValue(model: ModelOption): string {
  return `${model.provider}:${model.id}`;
}

export function SessionOrchestrationSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SESSION_ORCHESTRATION_SETTINGS });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [limitDraft, setLimitDraft] = useState(String(DEFAULT_SESSION_ORCHESTRATION_SETTINGS.maxRunning));
  const [models, setModels] = useState<ModelOption[]>([]);
  const enableControlId = useId();
  const limitControlId = useId();
  const modelControlId = useId();
  const thinkingControlId = useId();
  const allowUserSessionsControlId = useId();

  useEffect(() => {
    let disposed = false;
    void window.piBridge
      .getUiState()
      .then((state) => {
        if (disposed) return;
        const loaded = normalizeSessionOrchestrationSettings(state?.sessionOrchestration);
        setSettings(loaded);
        setLimitDraft(String(loaded.maxRunning));
      })
      .catch(() => {
        if (!disposed) setLoadFailed(true);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    void listModels()
      .then((catalogue) => {
        if (disposed) return;
        setModels(
          (catalogue?.models ?? []).map((model) => ({
            provider: model.provider,
            id: model.id,
            name: catalogue?.nameMap?.[`${model.provider}:${model.id}`] ?? model.name ?? model.id,
          })),
        );
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  const save = (next: Settings): void => {
    const previous = settings;
    setSettings(next);
    setLimitDraft(String(next.maxRunning));
    setSaveFailed(false);
    void window.piBridge.setUiState({ sessionOrchestration: next }).catch(() => {
      setSettings(previous);
      setLimitDraft(String(previous.maxRunning));
      setSaveFailed(true);
    });
  };

  const commitLimit = (): void => {
    const parsed = Number(limitDraft);
    const inRange =
      Number.isInteger(parsed) &&
      parsed >= SESSION_ORCHESTRATION_LIMITS.maxRunningMin &&
      parsed <= SESSION_ORCHESTRATION_LIMITS.maxRunningMax;
    if (!inRange || parsed === settings.maxRunning) {
      setLimitDraft(String(settings.maxRunning));
      return;
    }
    save({ ...settings, maxRunning: parsed });
  };

  const enabled = settings.enabled;

  return (
    <section style={{ maxWidth: 620 }}>
      <h2 style={{ margin: 0, fontSize: "var(--text-body-lg)", color: "var(--text)" }}>
        {t("sessionCollaboration", "Session collaboration")}
      </h2>
      <p style={{ margin: "8px 0 16px", fontSize: "var(--text-label)", lineHeight: 1.6, color: "var(--text-dim)" }}>
        {t(
          "sessionCollaborationDescription",
          "Let a session's Agent open, message, wait for and close other sessions. Each one is a normal session you can watch or take over.",
        )}
      </p>
      <SettingRow label={t("sessionCollaborationEnable", "Enable session collaboration")} controlId={enableControlId}>
        <label
          htmlFor={enableControlId}
          style={{
            width: 36,
            height: 36,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          <Toggle
            id={enableControlId}
            checked={enabled}
            disabled={loading}
            onChange={(event) => save({ ...settings, enabled: event.target.checked })}
          />
        </label>
      </SettingRow>

      {enabled && (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <SettingRow
            label={t("sessionCollaborationMaxRunning", "Maximum running sessions")}
            controlId={limitControlId}
          >
            <input
              id={limitControlId}
              type="number"
              inputMode="numeric"
              min={SESSION_ORCHESTRATION_LIMITS.maxRunningMin}
              max={SESSION_ORCHESTRATION_LIMITS.maxRunningMax}
              step={1}
              value={limitDraft}
              onChange={(event) => setLimitDraft(event.target.value)}
              onBlur={commitLimit}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitLimit();
              }}
              style={{
                width: 88,
                minHeight: 36,
                padding: "8px 12px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: "var(--text-body)",
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
              }}
            />
          </SettingRow>
          <SettingRow label={t("sessionCollaborationModel", "Session model")} controlId={modelControlId}>
            <select
              id={modelControlId}
              value={settings.model ? `${settings.model.provider}:${settings.model.modelId}` : ""}
              onChange={(event) => {
                const chosen = models.find((model) => modelValue(model) === event.target.value);
                save({ ...settings, model: chosen ? { provider: chosen.provider, modelId: chosen.id } : null });
              }}
              className={selectClassName}
              style={selectStyle}
            >
              <option value="">{t("sessionCollaborationSameAsCreator", "Same as creator")}</option>
              {models.map((model) => (
                <option key={modelValue(model)} value={modelValue(model)}>
                  {model.name}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label={t("sessionCollaborationThinking", "Thinking level")} controlId={thinkingControlId}>
            <select
              id={thinkingControlId}
              value={settings.thinkingLevel ?? ""}
              onChange={(event) =>
                save({ ...settings, thinkingLevel: (event.target.value || null) as SessionThinkingLevel | null })
              }
              className={selectClassName}
              style={selectStyle}
            >
              <option value="">{t("sessionCollaborationSameAsCreator", "Same as creator")}</option>
              {SESSION_THINKING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {thinkingLevelLabel(level, t)}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            label={t("sessionCollaborationAllowUserSessions", "Allow messaging any session")}
            controlId={allowUserSessionsControlId}
          >
            <label
              htmlFor={allowUserSessionsControlId}
              style={{ width: 36, height: 36, display: "grid", placeItems: "center", flexShrink: 0, cursor: "pointer" }}
            >
              <Toggle
                id={allowUserSessionsControlId}
                checked={settings.allowUserSessions}
                onChange={(event) => save({ ...settings, allowUserSessions: event.target.checked })}
              />
            </label>
          </SettingRow>
        </div>
      )}

      {loadFailed && (
        <p
          role="alert"
          style={{ margin: "8px 0 0", fontSize: "var(--text-label)", lineHeight: 1.55, color: "var(--danger)" }}
        >
          {t(
            "sessionCollaborationLoadFailed",
            "Session collaboration settings could not be loaded. The feature stays off.",
          )}
        </p>
      )}
      {saveFailed && (
        <p
          role="alert"
          style={{ margin: "8px 0 0", fontSize: "var(--text-label)", lineHeight: 1.55, color: "var(--danger)" }}
        >
          {t(
            "sessionCollaborationSaveFailed",
            "Session collaboration settings could not be saved. The previous setting was restored.",
          )}
        </p>
      )}
    </section>
  );
}

function thinkingLevelLabel(level: SessionThinkingLevel, t: (key: string, fallback: string) => string): string {
  switch (level) {
    case "off":
      return t("thinkingOff", "Off");
    case "minimal":
      return t("thinkingMinimal", "Minimal");
    case "low":
      return t("thinkingLow", "Low");
    case "medium":
      return t("thinkingMedium", "Medium");
    case "high":
      return t("thinkingHigh", "High");
    case "xhigh":
      return t("thinkingXHigh", "Extra high");
    default:
      return t("thinkingMax", "Max");
  }
}
