import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { browserErrorMessage as messageOf } from "../browser-error-message";
import { BrowserIcon } from "../browser-icons";
import type {
  BrowserHeaderRule,
  BrowserHeaderRuleDirection,
  BrowserPageSnippetSummary,
  BrowserProfileInfo,
} from "../../../../contract/browser";
import { Button, Toggle } from "../../form-controls";
import { SettingGroup } from "../../settings/setting-row";
import {
  ActionsRow,
  InputRow,
  NoticeRow,
  RowSpacer,
  SelectRow,
  ToggleRow,
  formatBytes,
  formatMessage,
  headerOperationLabel,
  profileModeLabel,
  type BrowserSettingsModel,
} from "./shared";

export function DeveloperOptions({
  model,
  snippets,
}: {
  model: BrowserSettingsModel;
  snippets: BrowserPageSnippetSummary[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const profiles = useMemo(
    () => model.state.profiles.filter((profile) => profile.mode !== "unsafe" || model.advancedEnabled),
    [model.state.profiles, model.advancedEnabled],
  );
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        style={{ justifySelf: "start", gap: 6, padding: "0 8px", margin: "0 -8px", color: "var(--fx-text-secondary)" }}
      >
        <span
          style={{
            display: "flex",
            transform: open ? "rotate(90deg)" : undefined,
            transition: "transform var(--duration-quick) var(--ease-smooth-out)",
          }}
        >
          <BrowserIcon name="chevron-right" size={14} strokeWidth={2} />
        </span>
        {t("browserDeveloperOptions", "Developer options")}
      </Button>
      {open && (
        <div id={panelId} style={{ display: "grid", gap: 28 }}>
          <HeaderRulesSection profiles={profiles} enabled={model.advancedEnabled} setError={model.setError} />
          <SnippetSection snippets={snippets} refresh={model.refresh} setError={model.setError} />
        </div>
      )}
    </div>
  );
}

function HeaderRulesSection({
  profiles,
  enabled,
  setError,
}: {
  profiles: BrowserProfileInfo[];
  enabled: boolean;
  setError: (value: string) => void;
}) {
  const { t } = useI18n();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "temporary");
  const [direction, setDirection] = useState<BrowserHeaderRuleDirection>("request");
  const [rules, setRules] = useState<BrowserHeaderRule[]>([]);
  const [urlPattern, setUrlPattern] = useState("https://example.com/*");
  const [resourceTypes, setResourceTypes] = useState("");
  const [header, setHeader] = useState("x-pi-browser");
  const [operation, setOperation] = useState<BrowserHeaderRule["operation"]>("set");
  const [value, setValue] = useState("");
  const [storeSecurely, setStoreSecurely] = useState(false);
  const isAuthorization = header.trim().toLowerCase() === "authorization";

  const load = useCallback(async () => {
    if (!profileId) return;
    try {
      setRules(await window.piBridge.browserGetHeaderRules(profileId, direction));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [direction, profileId, setError]);

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === profileId)) setProfileId(profiles[0]?.id ?? "temporary");
  }, [profileId, profiles]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: BrowserHeaderRule[]) => {
    try {
      await window.piBridge.browserSetHeaderRules(profileId, direction, next);
      setRules(next);
      setError("");
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const add = async () => {
    try {
      const normalizedHeader = header.trim().toLowerCase();
      const secretRef =
        operation !== "remove" && (storeSecurely || isAuthorization)
          ? await window.piBridge.browserStoreHeaderSecret(value)
          : undefined;
      const types = resourceTypes
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const rule: BrowserHeaderRule = {
        id: `rule-${Date.now().toString(36)}`,
        enabled: true,
        profileId,
        urlPattern: urlPattern.trim(),
        ...(types.length ? { resourceTypes: types } : {}),
        header: normalizedHeader,
        operation,
        ...(operation === "remove" ? {} : secretRef ? { secretRef } : { value }),
      };
      await window.piBridge.browserSetHeaderRules(profileId, direction, [...rules, rule]);
      setRules([...rules, rule]);
      setValue("");
      setStoreSecurely(false);
      setError("");
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  return (
    <SettingGroup title={t("browserHeaderRules", "Advanced header rules")}>
      <NoticeRow>
        {t(
          "browserHeaderRulesDescription",
          "Rules are scoped to a Profile, URL pattern, and optional Chromium resource types. Secret values are write-only and stored with Electron safeStorage.",
        )}
      </NoticeRow>
      <SelectRow label={t("browserProfile", "Profile")} value={profileId} onChange={setProfileId}>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} ({profileModeLabel(t, profile.mode)})
          </option>
        ))}
      </SelectRow>
      <SelectRow
        label={t("browserDirection", "Direction")}
        value={direction}
        onChange={(next) => setDirection(next as BrowserHeaderRuleDirection)}
      >
        <option value="request">{t("browserRequest", "Request")}</option>
        <option value="response">{t("browserResponse", "Response")}</option>
      </SelectRow>
      {!enabled && (
        <NoticeRow tone="warning">
          {t(
            "browserEnableHeaderCapability",
            "Enable the matching Advanced header override capability before editing these rules.",
          )}
        </NoticeRow>
      )}
      {rules.map((rule) => (
        <ActionsRow key={rule.id} style={{ flexWrap: "nowrap" }}>
          <Toggle
            checked={rule.enabled}
            disabled={!enabled}
            onChange={(event) =>
              void save(
                rules.map((candidate) =>
                  candidate.id === rule.id ? { ...candidate, enabled: event.target.checked } : candidate,
                ),
              )
            }
            aria-label={formatMessage(t("browserEnableRule", "Enable {header} rule"), { header: rule.header })}
          />
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
            <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
              {headerOperationLabel(t, rule.operation)} {rule.header}{" "}
              {rule.secretRef ? t("browserSecureValue", "(secure value)") : (rule.value ?? "")}
            </span>
            <span
              className="type-mono-label"
              style={{ color: "var(--fx-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {rule.urlPattern}
            </span>
          </div>
          <Button
            variant="ghost"
            disabled={!enabled}
            onClick={() =>
              void (async () => {
                if (rule.secretRef) await window.piBridge.browserRemoveHeaderSecret(rule.secretRef);
                await save(rules.filter((candidate) => candidate.id !== rule.id));
              })()
            }
          >
            {t("browserDelete", "Delete")}
          </Button>
        </ActionsRow>
      ))}
      <InputRow label={t("browserUrlPattern", "URL pattern")} value={urlPattern} onChange={setUrlPattern} />
      <InputRow
        label={t("browserResourceTypes", "Resource types (optional, comma separated)")}
        value={resourceTypes}
        onChange={setResourceTypes}
      />
      <InputRow label={t("browserHeader", "Header")} value={header} onChange={setHeader} />
      <SelectRow
        label={t("browserOperation", "Operation")}
        value={operation}
        onChange={(next) => setOperation(next as BrowserHeaderRule["operation"])}
      >
        <option value="set">{t("browserOperationSet", "Set")}</option>
        <option value="append">{t("browserOperationAppend", "Append")}</option>
        <option value="remove">{t("browserOperationRemove", "Remove")}</option>
      </SelectRow>
      {operation !== "remove" && (
        <>
          <InputRow
            label={t("browserHeaderValue", "Value (never reloaded when stored securely)")}
            value={value}
            type={storeSecurely || isAuthorization ? "password" : "text"}
            autoComplete="off"
            onChange={setValue}
          />
          <ToggleRow
            label={t("browserStoreValueSecurely", "Store this value securely")}
            checked={storeSecurely || isAuthorization}
            disabled={isAuthorization}
            onChange={setStoreSecurely}
          />
        </>
      )}
      <ActionsRow>
        <RowSpacer />
        <Button
          disabled={
            !enabled || !profileId || !urlPattern.trim() || !header.trim() || (operation !== "remove" && !value)
          }
          onClick={() => void add()}
        >
          {t("browserAddHeaderRule", "Add header rule")}
        </Button>
      </ActionsRow>
    </SettingGroup>
  );
}

function SnippetSection({
  snippets,
  refresh,
  setError,
}: {
  snippets: BrowserPageSnippetSummary[];
  refresh: () => Promise<void>;
  setError: (value: string) => void;
}) {
  const { t } = useI18n();
  const run = (task: () => Promise<unknown>) =>
    void task()
      .then(refresh)
      .catch((cause) => setError(messageOf(cause)));
  return (
    <SettingGroup title={t("browserJavascriptExperience", "JavaScript experience library")}>
      <NoticeRow>
        {t(
          "browserJavascriptExperienceNotice",
          "Only successful scripts saved with remember=true and an explicit purpose appear here. Saved code is never executed automatically.",
        )}
      </NoticeRow>
      {snippets.map((snippet) => (
        <ActionsRow key={snippet.id} style={{ flexWrap: "nowrap" }}>
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
            <span
              className="type-body-large-medium"
              style={{ color: snippet.enabled ? "var(--fx-text-primary)" : "var(--fx-text-tertiary)" }}
            >
              {snippet.label}
            </span>
            <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
              {snippet.host}
              {formatMessage(t("browserJavascriptExperienceUsage", "{path} · {size} · used {count} times"), {
                path: snippet.pathPattern,
                size: formatBytes(snippet.codeBytes),
                count: snippet.useCount,
              })}
            </span>
          </div>
          <Button
            variant="ghost"
            onClick={() => run(() => window.piBridge.browserSetPageSnippetEnabled(snippet.id, !snippet.enabled))}
          >
            {snippet.enabled ? t("browserDisable", "Disable") : t("browserEnable", "Enable")}
          </Button>
          <Button variant="ghost" onClick={() => run(() => window.piBridge.browserDeletePageSnippet(snippet.id))}>
            {t("browserDelete", "Delete")}
          </Button>
        </ActionsRow>
      ))}
      <ActionsRow>
        <RowSpacer />
        <Button
          variant="danger"
          disabled={snippets.length === 0}
          onClick={() => run(() => window.piBridge.browserClearPageSnippets())}
        >
          {t("browserClearJavascriptExperience", "Clear JavaScript experiences")}
        </Button>
      </ActionsRow>
    </SettingGroup>
  );
}
