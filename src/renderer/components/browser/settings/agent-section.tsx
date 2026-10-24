import { useId } from "react";
import { useI18n } from "@/i18n";
import type { BrowserPersistentSessionPermission } from "../../../../contract/browser";
import { Button, NativeSelect } from "../../form-controls";
import { SettingGroup, SettingRow } from "../../settings/setting-row";
import { DefaultPermissionRow } from "./default-permission-row";
import { NoticeRow, SelectRow, ToggleRow, ValueRow, permissionLabel, type BrowserSettingsModel } from "./shared";

export function AgentSection({ model, sessionId }: { model: BrowserSettingsModel; sessionId: string | null }) {
  const { t } = useI18n();
  const { settings, update } = model;
  return (
    <SettingGroup title={t("browserAgentAccess", "Agent access")}>
      <ToggleRow
        label={t("browserEnableAgentTools", "Enable Browser tools for Agent")}
        description={t(
          "browserEnableAgentToolsDescription",
          "When off, the Agent cannot read or operate any web page.",
        )}
        checked={settings.automation.enabled}
        onChange={(enabled) =>
          model.run(async () => {
            model.setError("");
            await window.piBridge.browserUpdateSettings({ automation: { enabled } });
          })
        }
      />
      <DefaultPermissionRow
        value={settings.automation.defaultPermission}
        onChange={(defaultPermission) => void update({ automation: { defaultPermission } })}
      />
      <SelectRow
        label={t("browserUserTakeover", "When you use the page while the Agent is working")}
        description={t(
          "browserUserTakeoverDescription",
          "What happens to the Agent's current action when you click or type yourself.",
        )}
        value={settings.automation.userTakeover}
        onChange={(value) => void update({ automation: { userTakeover: value as "cancel-agent-action" | "wait" } })}
      >
        <option value="cancel-agent-action">{t("browserCancelAgentAction", "Cancel current Agent action")}</option>
        <option value="wait">{t("browserWaitForAgent", "Wait for Agent action")}</option>
      </SelectRow>
      <ToggleRow
        label={t("browserHighlightTarget", "Highlight the Agent's target before clicking")}
        description={t(
          "browserHighlightTargetDescription",
          "Marks the target element on the page before the Agent clicks or types.",
        )}
        checked={settings.automation.showActionHighlight}
        onChange={(showActionHighlight) => void update({ automation: { showActionHighlight } })}
      />
      <ToggleRow
        label={t("browserAllowApprovedChannels", "Allow specifically approved channel sessions")}
        checked={settings.automation.allowChannelSessions}
        onChange={(allowChannelSessions) => void update({ automation: { allowChannelSessions } })}
      />
      <SelectRow
        label={t("browserSensitiveActions", "Sensitive Agent actions")}
        value={settings.automation.sensitiveActions}
        onChange={(value) => void update({ automation: { sensitiveActions: value as "always-ask" | "deny" } })}
      >
        <option value="always-ask">{t("browserAskEveryTime", "Ask every time")}</option>
        <option value="deny">{t("browserDeny", "Deny")}</option>
      </SelectRow>
      {sessionId ? (
        <SessionPermissionRows model={model} sessionId={sessionId} />
      ) : (
        <NoticeRow>{t("browserOpenSavedSession", "Open a saved session to manage its Browser permission.")}</NoticeRow>
      )}
    </SettingGroup>
  );
}

function SessionPermissionRows({ model, sessionId }: { model: BrowserSettingsModel; sessionId: string }) {
  const { t } = useI18n();
  const controlId = useId();
  const { state } = model;
  const grant = state.runtimeSessionGrants[sessionId];
  return (
    <>
      <SettingRow
        label={t("browserSessionPermanentPermission", "Permanent Browser permission for this session")}
        controlId={controlId}
      >
        <NativeSelect
          id={controlId}
          value={state.persistentSessionPermissions[sessionId] ?? "inherit"}
          onChange={(event) =>
            model.run(() =>
              window.piBridge.browserSetPersistentSessionPermission(
                sessionId,
                event.target.value as BrowserPersistentSessionPermission,
              ),
            )
          }
        >
          <option value="inherit">{t("browserPermissionInherit", "Use global default")}</option>
          <option value="ask">{t("browserPermissionAskSession", "Ask for this session")}</option>
          <option value="deny">{t("browserPermissionDeny", "Always deny")}</option>
          <option value="read">{t("browserPermissionRead", "Read")}</option>
          <option value="interact">{t("browserPermissionInteract", "Interact")}</option>
          <option value="advanced">{t("browserPermissionAdvanced", "Advanced Browser Mode")}</option>
        </NativeSelect>
      </SettingRow>
      <ValueRow
        label={t("browserCurrentTemporaryPermission", "Current temporary permission")}
        value={permissionLabel(t, grant?.permission ?? state.capabilities.sessionPermissions[sessionId] ?? "none")}
      >
        {grant && (
          <Button
            variant="ghost"
            onClick={() => model.run(() => window.piBridge.browserRevokeTemporarySessionPermission(sessionId))}
          >
            {t("browserRevokeTemporaryPermission", "Revoke temporary permission")}
          </Button>
        )}
      </ValueRow>
    </>
  );
}
