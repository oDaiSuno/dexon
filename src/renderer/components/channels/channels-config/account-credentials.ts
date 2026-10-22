import type { ChannelAccountConfig, ChannelAccountView, ChannelProbeResult } from "@shared/channel-types";
import { call } from "@/lib/api-client";
import { channelLabel, type Translate } from "./channel-labels";
import { FEISHU_BASE_URLS, TELEGRAM_BASE_URL } from "./constants";

export async function updateTelegramToken(account: ChannelAccountView, token: string): Promise<ChannelProbeResult> {
  await window.piBridge.setChannelCredential({
    channel: account.channel,
    accountId: account.id,
    credential: {
      token,
      providerAccountId: account.providerAccountId ?? account.id,
      ...(account.providerUsername ? { providerUsername: account.providerUsername } : {}),
      baseUrl: account.baseUrl || TELEGRAM_BASE_URL,
    },
  });
  const probe = await call("channels.probe", { accountId: account.id });
  if (!probe.ok || !probe.providerAccountId) throw new Error(probe.message);
  await window.piBridge.setChannelCredential({
    channel: account.channel,
    accountId: account.id,
    credential: {
      token,
      providerAccountId: probe.providerAccountId,
      ...(probe.providerUsername ? { providerUsername: probe.providerUsername } : {}),
      baseUrl: account.baseUrl || TELEGRAM_BASE_URL,
    },
  });
  await call("channels.accountUpsert", {
    account: {
      ...account,
      enabled: true,
      providerAccountId: probe.providerAccountId,
      ...(probe.providerUsername ? { providerUsername: probe.providerUsername } : {}),
      name: account.name || probe.providerUsername || probe.displayName || "Telegram",
      updatedAt: new Date().toISOString(),
    },
  });
  return probe;
}

export async function updateFeishuCredential(
  account: ChannelAccountView,
  nextAccount: ChannelAccountConfig,
  appSecret: string,
  t: Translate,
): Promise<ChannelProbeResult> {
  const appId = nextAccount.appId?.trim();
  const domain = nextAccount.domain === "lark" ? "lark" : "feishu";
  if (!appId) throw new Error(t("feishuAppIdRequired", "App ID is required."));
  await window.piBridge.setChannelCredential({
    channel: "feishu",
    accountId: account.id,
    credential: {
      token: appSecret,
      providerAccountId: account.providerAccountId ?? account.id,
      baseUrl: FEISHU_BASE_URLS[domain],
    },
  });
  await call("channels.accountUpsert", {
    account: {
      ...nextAccount,
      appId,
      domain,
      baseUrl: FEISHU_BASE_URLS[domain],
      enabled: true,
      updatedAt: new Date().toISOString(),
    },
  });
  const probe = await call("channels.probe", { accountId: account.id });
  if (!probe.ok || !probe.providerAccountId) throw new Error(probe.message);
  await window.piBridge.setChannelCredential({
    channel: "feishu",
    accountId: account.id,
    credential: {
      token: appSecret,
      providerAccountId: probe.providerAccountId,
      baseUrl: FEISHU_BASE_URLS[domain],
    },
  });
  await call("channels.accountUpsert", {
    account: {
      ...nextAccount,
      appId,
      domain,
      baseUrl: FEISHU_BASE_URLS[domain],
      enabled: true,
      providerAccountId: probe.providerAccountId,
      name: nextAccount.name || probe.displayName || channelLabel("feishu", t, domain),
      updatedAt: new Date().toISOString(),
    },
  });
  return probe;
}
