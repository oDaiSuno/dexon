import type { ChannelAccountConfig, FeishuDomain } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { buttonStyle, inputStyle } from "./control-styles";

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
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px,1fr) auto",
          gap: 8,
        }}
      >
        <input
          type="password"
          autoComplete="off"
          style={inputStyle}
          value={telegramToken}
          onChange={(event) => setTelegramToken(event.target.value)}
          placeholder={t("newTelegramBotToken", "New BotFather token")}
        />
        <button
          type="button"
          disabled={busy || updatingToken || !telegramToken.trim()}
          style={buttonStyle()}
          onClick={() => void onUpdate()}
        >
          {updatingToken ? t("saving", "Saving…") : t("updateTelegramToken", "Update token")}
        </button>
      </div>
      <div style={{ marginTop: 8, color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)", lineHeight: 1.5 }}>
        {t(
          "telegramGroupSetupHint",
          "Basic groups and supergroups are supported; topics require a forum supergroup. Send /status@bot_username first, then copy the chat ID from Recent activity into Allowed group IDs.",
        )}
      </div>
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
    <div
      data-testid="feishu-credential-settings"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
        gap: 8,
        marginTop: 12,
      }}
    >
      <input
        style={inputStyle}
        value={draft.appId ?? ""}
        onChange={(event) => setDraft({ ...draft, appId: event.target.value })}
        placeholder={t("feishuAppId", "App ID (cli_…)")}
      />
      <select
        style={inputStyle}
        value={draft.domain === "lark" ? "lark" : "feishu"}
        onChange={(event) => setDraft({ ...draft, domain: event.target.value as FeishuDomain })}
      >
        <option value="feishu">{t("feishuChina", "Feishu (China)")}</option>
        <option value="lark">Lark</option>
      </select>
      <input
        type="password"
        autoComplete="off"
        style={inputStyle}
        value={feishuAppSecret}
        onChange={(event) => setFeishuAppSecret(event.target.value)}
        placeholder={t("newFeishuAppSecret", "New App Secret")}
      />
      <button
        type="button"
        disabled={busy || updatingToken || !draft.appId?.trim() || !feishuAppSecret.trim()}
        style={buttonStyle()}
        onClick={() => void onUpdate()}
      >
        {updatingToken ? t("saving", "Saving…") : t("updateFeishuCredential", "Update credentials")}
      </button>
      <div
        style={{
          gridColumn: "1 / -1",
          color: "var(--fx-text-tertiary)",
          fontSize: "var(--text-micro)",
          lineHeight: 1.5,
        }}
      >
        {t(
          "feishuCredentialHint",
          "Changing the App Secret, App ID, or domain verifies the bot and hot-reloads its WebSocket connection without restarting Pi Desktop.",
        )}
      </div>
      <div
        data-testid="feishu-rich-card-hint"
        style={{
          gridColumn: "1 / -1",
          color: "var(--fx-text-tertiary)",
          fontSize: "var(--text-micro)",
          lineHeight: 1.5,
        }}
      >
        {t(
          "feishuRichCardHint",
          "Markdown final replies use Card JSON 2.0. Streaming also requires cardkit:card:write and Feishu 7.20+; missing card capability falls back safely to a final reply.",
        )}
      </div>
    </div>
  );
}
