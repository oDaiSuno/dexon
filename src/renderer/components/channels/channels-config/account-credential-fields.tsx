import type { ChannelAccountConfig, FeishuDomain } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button, Field, NativeSelect, SecretTextInput, TextInput } from "../../form-controls";

function Hint({ children, testId }: { children: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className="type-label-default"
      style={{ color: "var(--fx-text-tertiary)", textWrap: "pretty" }}
    >
      {children}
    </span>
  );
}

export function TelegramCredentialFields({
  busy,
  updatingToken,
  telegramToken,
  setTelegramToken,
  onUpdate,
}: {
  busy: boolean;
  updatingToken: boolean;
  telegramToken: string;
  setTelegramToken: (value: string) => void;
  onUpdate: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label={t("newTelegramBotToken", "New BotFather token")} labelSize="body">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SecretTextInput
            mono
            value={telegramToken}
            onChange={setTelegramToken}
            placeholder={t("newTelegramBotToken", "New BotFather token")}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            disabled={busy || updatingToken || !telegramToken.trim()}
            busy={updatingToken}
            onClick={() => void onUpdate()}
          >
            {updatingToken ? t("saving", "Saving…") : t("updateTelegramToken", "Update token")}
          </Button>
        </div>
      </Field>
      <Hint>
        {t(
          "telegramGroupSetupHint",
          "Basic groups and supergroups are supported; topics require a forum supergroup. Send /status@bot_username first, then copy the chat ID from Recent activity into Allowed group IDs.",
        )}
      </Hint>
    </div>
  );
}

export function FeishuCredentialFields({
  busy,
  updatingToken,
  draft,
  setDraft,
  feishuAppSecret,
  setFeishuAppSecret,
  onUpdate,
}: {
  busy: boolean;
  updatingToken: boolean;
  draft: ChannelAccountConfig;
  setDraft: (draft: ChannelAccountConfig) => void;
  feishuAppSecret: string;
  setFeishuAppSecret: (value: string) => void;
  onUpdate: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div data-testid="feishu-credential-settings" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "end" }}>
        <Field label={t("feishuAppId", "App ID (cli_…)")} labelSize="body">
          <TextInput
            mono
            value={draft.appId ?? ""}
            onChange={(appId) => setDraft({ ...draft, appId })}
            placeholder={t("feishuAppId", "App ID (cli_…)")}
          />
        </Field>
        <Field label={t("feishuTenantRegion", "Account region")} labelSize="body">
          <NativeSelect
            value={draft.domain === "lark" ? "lark" : "feishu"}
            onChange={(event) => setDraft({ ...draft, domain: event.target.value as FeishuDomain })}
          >
            <option value="feishu">{t("feishuChina", "Feishu (China)")}</option>
            <option value="lark">Lark</option>
          </NativeSelect>
        </Field>
      </div>
      <Field label={t("newFeishuAppSecret", "New App Secret")} labelSize="body">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SecretTextInput
            mono
            value={feishuAppSecret}
            onChange={setFeishuAppSecret}
            placeholder={t("newFeishuAppSecret", "New App Secret")}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            disabled={busy || updatingToken || !draft.appId?.trim() || !feishuAppSecret.trim()}
            busy={updatingToken}
            onClick={() => void onUpdate()}
          >
            {updatingToken ? t("saving", "Saving…") : t("updateFeishuCredential", "Update credentials")}
          </Button>
        </div>
      </Field>
      <Hint>
        {t(
          "feishuCredentialHint",
          "Changing the App Secret, App ID, or domain verifies the bot and hot-reloads its WebSocket connection without restarting Pi Desktop.",
        )}
      </Hint>
      <Hint testId="feishu-rich-card-hint">
        {t(
          "feishuRichCardHint",
          "Markdown final replies use Card JSON 2.0. Streaming also requires cardkit:card:write and Feishu 7.20+; missing card capability falls back safely to a final reply.",
        )}
      </Hint>
    </div>
  );
}
