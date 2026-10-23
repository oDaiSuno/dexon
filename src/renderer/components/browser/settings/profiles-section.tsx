import { useI18n } from "@/i18n";
import type { BrowserDataType, BrowserProfileInfo } from "../../../../contract/browser";
import { Button } from "../../form-controls";
import { SettingGroup } from "../../settings/setting-row";
import {
  ActionsRow,
  TextPromptDialog,
  formatMessage,
  profileModeLabel,
  proxyModeLabel,
  useTextPrompt,
  type BrowserSettingsModel,
} from "./shared";

export function ProfilesSection({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { prompt, requestPrompt, respondToPrompt } = useTextPrompt();
  const { state, settings, advancedEnabled, refresh, report } = model;
  const saveLoginState = settings.panel.saveLoginState;

  const create = async (mode: BrowserProfileInfo["mode"]) => {
    const name = await requestPrompt({
      title: t("browserNewProfileTitle", "Create Browser Profile"),
      message: t("browserProfileName", "Profile name"),
      confirmLabel: t("browserCreate", "Create"),
    });
    if (!name) return;
    try {
      await window.piBridge.browserCreateProfile({ name, mode });
      await refresh();
    } catch (cause) {
      report(cause);
    }
  };
  const clear = (profileId: string, dataType: BrowserDataType) =>
    model.run(() => window.piBridge.browserClearProfileData(profileId, dataType));
  const rename = async (profile: BrowserProfileInfo) => {
    const name = await requestPrompt({
      title: t("browserRenameProfileTitle", "Rename Browser Profile"),
      message: t("browserNewProfileName", "New Profile name"),
      defaultValue: profile.name,
      confirmLabel: t("rename", "Rename"),
    });
    if (!name || name === profile.name) return;
    try {
      await window.piBridge.browserRenameProfile(profile.id, name);
      await refresh();
    } catch (cause) {
      report(cause);
    }
  };
  const remove = (profile: BrowserProfileInfo) => {
    const question = formatMessage(t("browserDeleteProfileConfirm", "Delete Browser Profile “{name}”?"), {
      name: profile.name,
    });
    if (window.confirm(question)) model.run(() => window.piBridge.browserDeleteProfile(profile.id));
  };

  return (
    <>
      <SettingGroup title={t("browserProfilesData", "Profiles and site data")}>
        {state.profiles.map((profile) => (
          <ActionsRow key={profile.id} style={{ flexWrap: "nowrap", padding: "var(--space-3) var(--space-5)" }}>
            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
              <span className="type-body-large-medium" style={{ color: "var(--fx-text-primary)" }}>
                {profile.name}
              </span>
              <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
                {profileModeLabel(t, profile.mode)} · {t("browserProxyMode", "Proxy mode")}{" "}
                {proxyModeLabel(t, profile.proxyMode)}
              </span>
            </div>
            <Button variant="ghost" onClick={() => clear(profile.id, "all")}>
              {t("browserClearData", "Clear data")}
            </Button>
            {profile.id !== "temporary" && (
              <>
                <Button variant="ghost" onClick={() => void rename(profile)}>
                  {t("browserRename", "Rename")}
                </Button>
                <Button variant="ghost" onClick={() => remove(profile)}>
                  {t("browserDelete", "Delete")}
                </Button>
              </>
            )}
          </ActionsRow>
        ))}
        <ActionsRow>
          <Button onClick={() => void create(saveLoginState ? "persistent" : "ephemeral")}>
            {formatMessage(t("browserNewProfile", "New Profile ({mode})"), {
              mode: saveLoginState ? profileModeLabel(t, "persistent") : t("browserModeEphemeral", "temporary"),
            })}
          </Button>
          <Button disabled={!advancedEnabled} onClick={() => void create("unsafe")}>
            {t("browserNewAdvancedProfile", "New advanced Profile")}
          </Button>
        </ActionsRow>
      </SettingGroup>
      {prompt && <TextPromptDialog prompt={prompt} cancelLabel={t("cancel", "Cancel")} onRespond={respondToPrompt} />}
    </>
  );
}
