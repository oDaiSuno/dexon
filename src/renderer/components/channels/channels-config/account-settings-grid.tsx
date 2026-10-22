import { useMemo } from "react";
import type { ChannelAccountConfig } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { TOOL_PRESETS } from "./constants";
import { buttonStyle, inputStyle } from "./control-styles";
import { Field } from "./section-layout";

export function AccountSettingsGrid({
  draft,
  setDraft,
}: {
  draft: ChannelAccountConfig;
  setDraft: (draft: ChannelAccountConfig) => void;
}) {
  const { t } = useI18n();
  const preset = useMemo(() => {
    const value = [...draft.toolNames].sort().join(",");
    if (value === [...TOOL_PRESETS.read].sort().join(",")) return "read";
    if (value === [...TOOL_PRESETS.full].sort().join(",")) return "full";
    return "none";
  }, [draft.toolNames]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginTop: 16 }}>
      <Field label={t("channelName", "Name")}>
        <input
          aria-label={t("channelName", "Name")}
          style={inputStyle}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </Field>
      <Field label={t("dmAccess", "Direct-message access")}>
        <select
          aria-label={t("dmAccess", "Direct-message access")}
          style={inputStyle}
          value={draft.dmPolicy}
          onChange={(event) => setDraft({ ...draft, dmPolicy: event.target.value as ChannelAccountConfig["dmPolicy"] })}
        >
          <option value="pairing">{t("policyPairing", "Pairing")}</option>
          <option value="allowlist">{t("policyAllowlistOnly", "Allowlist only")}</option>
          <option value="open">{t("policyOpenUnsafe", "Open (unsafe)")}</option>
        </select>
      </Field>
      <Field label={t("allowedUserIds", "Allowed user IDs")}>
        <input
          aria-label={t("allowedUserIds", "Allowed user IDs")}
          style={inputStyle}
          value={draft.allowFrom.join(", ")}
          onChange={(event) =>
            setDraft({
              ...draft,
              allowFrom: event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <Field label={t("groupAccess", "Group access")}>
        <select
          aria-label={t("groupAccess", "Group access")}
          style={inputStyle}
          value={draft.groupPolicy}
          onChange={(event) =>
            setDraft({ ...draft, groupPolicy: event.target.value as ChannelAccountConfig["groupPolicy"] })
          }
        >
          <option value="disabled">{t("policyDisabledRecommended", "Disabled (recommended)")}</option>
          <option value="allowlist">{t("policyAllowlist", "Allowlist")}</option>
          <option value="open">{t("policyOpenUnsafe", "Open (unsafe)")}</option>
        </select>
      </Field>
      <Field label={t("allowedGroupIds", "Allowed group IDs")}>
        <input
          aria-label={t("allowedGroupIds", "Allowed group IDs")}
          style={inputStyle}
          value={draft.groupIds.join(", ")}
          onChange={(event) =>
            setDraft({
              ...draft,
              groupIds: event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <Field label={t("allowedGroupSenderIds", "Allowed group sender IDs")}>
        <input
          aria-label={t("allowedGroupSenderIds", "Allowed group sender IDs")}
          style={inputStyle}
          value={draft.groupAllowFrom.join(", ")}
          onChange={(event) =>
            setDraft({
              ...draft,
              groupAllowFrom: event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <Field label={t("groupMentionRequired", "Group mention required")}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, color: "var(--fx-text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={draft.requireMention}
            onChange={(event) => setDraft({ ...draft, requireMention: event.target.checked })}
            style={{ width: 18, height: 18, margin: 0, accentColor: "var(--fx-accent-blue)", cursor: "pointer" }}
          />
          {t("requireMention", "Require @mention")}
        </label>
      </Field>
      <Field label={t("imCommands", "IM commands")}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, color: "var(--fx-text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={draft.commandsEnabled === true}
            onChange={(event) => setDraft({ ...draft, commandsEnabled: event.target.checked })}
            style={{ width: 18, height: 18, margin: 0, accentColor: "var(--fx-accent-blue)", cursor: "pointer" }}
          />
          {t("enableImCommands", "Enable /help, /status, /new, /compact, and /reload")}
        </label>
      </Field>
      <Field label={t("defaultTools", "Default tools")}>
        <select
          aria-label={t("defaultTools", "Default tools")}
          style={inputStyle}
          value={preset}
          onChange={(event) =>
            setDraft({ ...draft, toolNames: [...TOOL_PRESETS[event.target.value as keyof typeof TOOL_PRESETS]] })
          }
        >
          <option value="none">{t("toolPresetNone", "No tools (recommended)")}</option>
          <option value="read">{t("toolPresetRead", "Read-only tools")}</option>
          <option value="full">{t("toolPresetFull", "Full coding tools")}</option>
        </select>
        <span style={{ color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)", lineHeight: 1.5 }}>
          {t(
            "defaultToolsHint",
            "Used for new channel sessions and synchronized to sessions currently bound to this account when saved.",
          )}
        </span>
      </Field>
      <Field label={t("defaultProjectDirectory", "Default project directory")}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            aria-label={t("defaultProjectDirectory", "Default project directory")}
            style={inputStyle}
            readOnly
            value={draft.defaultCwd ?? t("isolatedChannelWorkspace", "Isolated channel workspace")}
          />
          <button
            type="button"
            style={buttonStyle()}
            onClick={() =>
              void window.piBridge.selectDirectory().then((cwd) => cwd && setDraft({ ...draft, defaultCwd: cwd }))
            }
          >
            {t("browse", "Browse")}
          </button>
        </div>
      </Field>
    </div>
  );
}
