import { useId, useMemo } from "react";
import type { ChannelAccountConfig } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button, NativeSelect, Toggle } from "../../form-controls";
import { SettingRow, SettingValue, toggleHitAreaStyle } from "../../settings/setting-row";
import { TOOL_PRESETS } from "./constants";
import { SectionCard } from "./section-layout";

function parseIds(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function IdListRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const id = useId();
  return (
    <SettingRow label={label} controlId={id}>
      <input
        id={id}
        className="ui-input type-mono-label"
        value={value.join(", ")}
        onChange={(event) => onChange(parseIds(event.target.value))}
        style={{ width: 200 }}
      />
    </SettingRow>
  );
}

export function AccountSettingsGrid({
  draft,
  setDraft,
}: {
  draft: ChannelAccountConfig;
  setDraft: (draft: ChannelAccountConfig) => void;
}) {
  const { language, t } = useI18n();
  const ids = { name: useId(), dm: useId(), group: useId(), mention: useId(), tools: useId(), commands: useId() };
  const cwdId = useId();
  const preset = useMemo(() => {
    const value = [...draft.toolNames].sort().join(",");
    if (value === [...TOOL_PRESETS.read].sort().join(",")) return "read";
    if (value === [...TOOL_PRESETS.full].sort().join(",")) return "full";
    return "none";
  }, [draft.toolNames]);

  return (
    <SectionCard>
      <SettingRow label={t("channelName", "Name")} controlId={ids.name}>
        <input
          id={ids.name}
          className="ui-input type-body-default"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          style={{ width: 200 }}
        />
      </SettingRow>
      <SettingRow
        label={t("dmAccess", "Direct messages")}
        description={t(
          "dmAccessDescription",
          "When a stranger messages for the first time, you confirm the pairing code here.",
        )}
        controlId={ids.dm}
      >
        <NativeSelect
          id={ids.dm}
          value={draft.dmPolicy}
          onChange={(event) => setDraft({ ...draft, dmPolicy: event.target.value as ChannelAccountConfig["dmPolicy"] })}
        >
          <option value="pairing">{t("policyPairing", "Requires pairing approval")}</option>
          <option value="allowlist">{t("policyAllowlistOnly", "Only people on the list")}</option>
          <option value="open">{t("policyOpenUnsafe", "Open (unsafe)")}</option>
        </NativeSelect>
      </SettingRow>
      <IdListRow
        label={t("allowedUserIds", "Allowed user IDs")}
        value={draft.allowFrom}
        onChange={(allowFrom) => setDraft({ ...draft, allowFrom })}
      />
      <SettingRow
        label={t("groupAccess", "Group chats")}
        description={t(
          "groupAccessDescription",
          "Replies only in groups you allow; messages from other groups are ignored.",
        )}
        controlId={ids.group}
      >
        <NativeSelect
          id={ids.group}
          value={draft.groupPolicy}
          onChange={(event) =>
            setDraft({ ...draft, groupPolicy: event.target.value as ChannelAccountConfig["groupPolicy"] })
          }
        >
          <option value="disabled">{t("policyDisabledRecommended", "Disabled (recommended)")}</option>
          <option value="allowlist">{t("policyAllowlist", "Only groups on the list")}</option>
          <option value="open">{t("policyOpenUnsafe", "Open (unsafe)")}</option>
        </NativeSelect>
      </SettingRow>
      <IdListRow
        label={t("allowedGroupIds", "Allowed group IDs")}
        value={draft.groupIds}
        onChange={(groupIds) => setDraft({ ...draft, groupIds })}
      />
      <IdListRow
        label={t("allowedGroupSenderIds", "Allowed group sender IDs")}
        value={draft.groupAllowFrom}
        onChange={(groupAllowFrom) => setDraft({ ...draft, groupAllowFrom })}
      />
      <SettingRow
        label={t("groupMentionRequired", "Reply in groups only when @mentioned")}
        description={t("requireMention", "Keeps Dexon from answering every bit of small talk in a group.")}
        controlId={ids.mention}
      >
        <label htmlFor={ids.mention} style={{ ...toggleHitAreaStyle, cursor: "pointer" }}>
          <Toggle
            id={ids.mention}
            checked={draft.requireMention}
            onChange={(event) => setDraft({ ...draft, requireMention: event.target.checked })}
          />
        </label>
      </SettingRow>
      <SettingRow
        label={t("defaultTools", "Tools the Agent can use")}
        description={[
          t("defaultToolsDescription", "How far a task started from chat is allowed to go."),
          t(
            "defaultToolsHint",
            "Used for new channel sessions and synchronized to sessions currently bound to this account when saved.",
          ),
        ].join(language === "zh-CN" ? "" : " ")}
        controlId={ids.tools}
      >
        <NativeSelect
          id={ids.tools}
          value={preset}
          onChange={(event) =>
            setDraft({ ...draft, toolNames: [...TOOL_PRESETS[event.target.value as keyof typeof TOOL_PRESETS]] })
          }
        >
          <option value="none">{t("toolPresetNone", "No tools (recommended)")}</option>
          <option value="read">{t("toolPresetRead", "Read files only")}</option>
          <option value="full">{t("toolPresetFull", "Full coding tools")}</option>
        </NativeSelect>
      </SettingRow>
      <SettingRow
        label={t("imCommands", "Chat commands")}
        description={t(
          "enableImCommands",
          "Allow /new, /status, /compact and other commands in chat to control the session.",
        )}
        controlId={ids.commands}
      >
        <label htmlFor={ids.commands} style={{ ...toggleHitAreaStyle, cursor: "pointer" }}>
          <Toggle
            id={ids.commands}
            checked={draft.commandsEnabled === true}
            onChange={(event) => setDraft({ ...draft, commandsEnabled: event.target.checked })}
          />
        </label>
      </SettingRow>
      <SettingRow label={t("defaultProjectDirectory", "Default project directory")} controlId={cwdId}>
        <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <SettingValue>{draft.defaultCwd ?? t("isolatedChannelWorkspace", "Isolated channel workspace")}</SettingValue>
          <Button
            id={cwdId}
            onClick={() =>
              void window.piBridge.selectDirectory().then((cwd) => cwd && setDraft({ ...draft, defaultCwd: cwd }))
            }
          >
            {t("browse", "Browse")}
          </Button>
        </span>
      </SettingRow>
    </SectionCard>
  );
}
