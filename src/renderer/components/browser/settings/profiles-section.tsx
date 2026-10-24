import { useI18n } from "@/i18n";
import type { BrowserDataType, BrowserProfileInfo } from "../../../../contract/browser";
import { Badge, Button } from "../../form-controls";
import { SettingGroup } from "../../settings/setting-row";
import { BrowserIcon } from "../browser-icons";
import { ActionMenu } from "./action-menu";
import {
  ActionsRow,
  TextPromptDialog,
  formatMessage,
  profileModeLabel,
  useTextPrompt,
  type BrowserSettingsModel,
  type Translate,
} from "./shared";

export function ProfilesSection({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { prompt, requestPrompt, respondToPrompt } = useTextPrompt();
  const { state, settings, advancedEnabled, refresh, report } = model;
  const standardMode = settings.panel.saveLoginState ? "persistent" : "ephemeral";

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

  const newProfileMenu = (
    <ActionMenu
      label={t("browserNewProfile", "New Profile")}
      items={[
        {
          key: "standard",
          label: formatMessage(t("browserNewModeProfile", "New {mode} Profile"), {
            mode: profileModeLabel(t, standardMode),
          }),
          onSelect: () => void create(standardMode),
        },
        {
          key: "advanced",
          label: t("browserNewAdvancedProfile", "New advanced Profile"),
          disabled: !advancedEnabled,
          onSelect: () => void create("unsafe"),
        },
      ]}
      trigger={(props) => (
        <Button {...props}>
          <BrowserIcon name="plus" size={14} strokeWidth={2} />
          {t("browserNewProfile", "New Profile")}
        </Button>
      )}
    />
  );

  return (
    <>
      <SettingGroup title={t("browserProfilesData", "Profiles and site data")} action={newProfileMenu}>
        {state.profiles.map((profile) => {
          const builtIn = profile.id === "temporary";
          return (
            <ActionsRow key={profile.id} style={rowStyle}>
              <span aria-hidden style={avatarStyle}>
                <BrowserIcon name={profile.mode === "unsafe" ? "flask-conical" : "user-round"} size={15} />
              </span>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                <span className="type-body-large-medium" style={{ color: "var(--fx-text-primary)" }}>
                  {profile.name}
                </span>
                <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
                  {profileSummary(t, profile, state.tabs.filter((tab) => tab.profileId === profile.id).length)}
                </span>
              </div>
              <Badge tone={profile.mode === "unsafe" ? "warning" : "neutral"}>
                {profileModeLabel(t, profile.mode)}
              </Badge>
              <Button variant="ghost" onClick={() => clear(profile.id, "all")}>
                {t("browserClearData", "Clear data")}
              </Button>
              <ActionMenu
                label={formatMessage(t("browserProfileMoreActions", "More actions for {name}"), {
                  name: profile.name,
                })}
                items={[
                  {
                    key: "rename",
                    label: t("browserRename", "Rename"),
                    disabled: builtIn,
                    onSelect: () => void rename(profile),
                  },
                  {
                    key: "delete",
                    label: t("browserDelete", "Delete"),
                    danger: true,
                    disabled: builtIn,
                    onSelect: () => remove(profile),
                  },
                ]}
                trigger={(props) => (
                  <button
                    {...props}
                    type="button"
                    className="browser-icon-button"
                    style={moreButtonStyle}
                    title={t("browserMoreActions", "More")}
                    aria-label={formatMessage(t("browserProfileMoreActions", "More actions for {name}"), {
                      name: profile.name,
                    })}
                  >
                    <BrowserIcon name="ellipsis" size={16} strokeWidth={2} />
                  </button>
                )}
              />
            </ActionsRow>
          );
        })}
      </SettingGroup>
      {prompt && <TextPromptDialog prompt={prompt} cancelLabel={t("cancel", "Cancel")} onRespond={respondToPrompt} />}
    </>
  );
}

function profileSummary(t: Translate, profile: BrowserProfileInfo, tabCount: number): string {
  const lifetime =
    profile.mode === "persistent"
      ? t("browserProfileKeepsLogin", "Keeps you signed in")
      : profile.mode === "unsafe"
        ? t("browserProfileThisLaunch", "This launch only")
        : t("browserProfileClearsOnClose", "Cleared when closed");
  const usage =
    tabCount === 0
      ? t("browserProfileUnused", "Not in use")
      : tabCount === 1
        ? t("browserOneTab", "1 tab")
        : formatMessage(t("browserTabsCount", "{count} tabs"), { count: tabCount });
  return `${lifetime} · ${usage}`;
}

const rowStyle = { flexWrap: "nowrap", gap: "14px", padding: "12px 20px" } as const;
const avatarStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  width: "32px",
  height: "32px",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-control)",
  background: "var(--fx-surface-card)",
  color: "var(--fx-text-secondary)",
} as const;
const moreButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "24px",
  height: "24px",
  margin: "0 -4px",
  padding: 0,
  border: "none",
  borderRadius: "var(--radius-chip)",
  color: "var(--fx-text-tertiary)",
  cursor: "pointer",
} as const;
