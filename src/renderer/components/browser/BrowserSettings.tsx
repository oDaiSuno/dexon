import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { EnvironmentScopeBar, usePageEnvironmentScope } from "../settings/environment-scope-bar";
import { useI18n } from "@/i18n";
import { browserErrorMessage as messageOf } from "./browser-error-message";
import type { BrowserPageSnippetSummary, BrowserRendererState, BrowserSettingsPatch } from "../../../contract/browser";
import { SettingNote } from "../settings/setting-row";
import { TextPromptDialog, useTextPrompt, type BrowserSettingsModel } from "./settings/shared";
import { BrowserHero } from "./settings/browser-hero";
import { BasicsSection } from "./settings/basics-section";
import { NetworkSection } from "./settings/network-section";
import { AgentSection } from "./settings/agent-section";
import { DownloadsProxySection } from "./settings/downloads-proxy-section";
import { ProfilesSection } from "./settings/profiles-section";
import { DiagnosticsSection } from "./settings/diagnostics-section";
import { DeveloperOptions } from "./settings/developer-section";

const ADVANCED_PHRASE = "ENABLE ADVANCED BROWSER";

export function BrowserSettings({
  sessionId,
  environmentId = PRIMARY_ENVIRONMENT_ID,
  onScopeChange,
}: {
  sessionId: string | null;
  environmentId?: EnvironmentId;
  onScopeChange?: (id: EnvironmentId) => void;
}) {
  const [scope, selectScope] = usePageEnvironmentScope(environmentId, onScopeChange);
  return (
    <LocalBrowserSettings
      sessionId={environmentId === PRIMARY_ENVIRONMENT_ID ? sessionId : null}
      focusedEnvironmentId={scope}
      onViewLocal={() => selectScope(PRIMARY_ENVIRONMENT_ID)}
    />
  );
}

function LocalBrowserSettings({
  sessionId,
  focusedEnvironmentId,
  onViewLocal,
}: {
  sessionId: string | null;
  focusedEnvironmentId: EnvironmentId;
  onViewLocal: () => void;
}) {
  const { language, t } = useI18n();
  const [state, setState] = useState<BrowserRendererState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [snippets, setSnippets] = useState<BrowserPageSnippetSummary[]>([]);
  const { prompt, requestPrompt, respondToPrompt } = useTextPrompt();

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextSnippets] = await Promise.all([
        window.piBridge.browserGetState(),
        window.piBridge.browserListPageSnippets(),
      ]);
      setState(nextState);
      setSnippets(nextSnippets);
      setError("");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: BrowserSettingsPatch) => {
      setBusy(true);
      setError("");
      try {
        const needsConfirmation =
          patch.advancedBrowserMode?.enabled === true && !state?.settings.settings.advancedBrowserMode.enabled;
        if (needsConfirmation) {
          const phrase = await requestPrompt({
            title: t("browserEnableAdvanced", "Enable Advanced Browser Mode"),
            message: t(
              "browserAdvancedPrompt",
              "This enables JavaScript, identity overrides, trusted input, network bodies and write replay, security-header removal, certificate bypass, and unrestricted CDP together. Type ENABLE ADVANCED BROWSER to continue.",
            ),
            requiredValue: ADVANCED_PHRASE,
            confirmLabel: t("browserContinue", "Continue"),
          });
          if (phrase === null) return;
          if (phrase !== ADVANCED_PHRASE) {
            setError(t("browserAdvancedPromptMismatch", "Advanced Browser confirmation phrase did not match."));
            return;
          }
        }
        const proof = needsConfirmation
          ? await window.piBridge.browserRequestConfirmation("advanced-browser-mode", patch, language)
          : undefined;
        if (needsConfirmation && !proof) return;
        await window.piBridge.browserUpdateSettings(patch, proof ?? undefined);
        await refresh();
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
    [language, refresh, requestPrompt, state, t],
  );

  const model = useMemo<BrowserSettingsModel | null>(() => {
    if (!state) return null;
    const report = (cause: unknown) => setError(messageOf(cause));
    return {
      state,
      settings: state.settings.settings,
      advancedEnabled: state.settings.runtime.advancedBrowserModeEnabled,
      update,
      setState,
      setError,
      report,
      refresh,
      run: (task) => void task().then(refresh).catch(report),
    };
  }, [refresh, state, update]);

  return (
    <>
      <div style={scrollStyle}>
        <div style={{ ...contentStyle, opacity: busy ? 0.72 : 1 }}>
          <EnvironmentScopeBar
            mode="local-only"
            focusedEnvironmentId={focusedEnvironmentId}
            onViewLocal={onViewLocal}
          />
          {focusedEnvironmentId !== PRIMARY_ENVIRONMENT_ID && (
            <h2 className="type-body-large-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
              {t("schemeCLocalBrowserSettings", "Browser settings on this computer")}
            </h2>
          )}
          {model ? (
            <>
              <BrowserHero model={model} />
              {error && <SettingNote alert>{error}</SettingNote>}
              <BasicsSection model={model} />
              <NetworkSection model={model} />
              <AgentSection model={model} sessionId={sessionId} />
              <DownloadsProxySection model={model} label={t("browserDownloadsProxy", "Downloads and proxy")} />
              <ProfilesSection model={model} />
              <DiagnosticsSection model={model} />
              <DeveloperOptions model={model} snippets={snippets} />
            </>
          ) : (
            <div className="type-body-default" style={{ color: "var(--fx-text-secondary)" }}>
              {error || t("browserLoadingSettings", "Loading Browser settings…")}
            </div>
          )}
        </div>
      </div>
      {prompt && <TextPromptDialog prompt={prompt} cancelLabel={t("cancel", "Cancel")} onRespond={respondToPrompt} />}
    </>
  );
}

const scrollStyle: CSSProperties = {
  width: "100%",
  overflowY: "auto",
  padding: "var(--space-6) var(--space-6) var(--space-10)",
};
const contentStyle: CSSProperties = { maxWidth: 760, margin: "0 auto", display: "grid", gap: "var(--space-7)" };
