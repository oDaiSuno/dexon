import { useCallback, useEffect, useState } from "react";
import type { ChannelAccountConfig, ChannelLoginEvent, ChannelsSnapshot, FeishuDomain } from "@shared/channel-types";
import type { SessionInfo } from "@contract/types";
import { call, listSessions, subscribe } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { FEISHU_BASE_URLS, TELEGRAM_BASE_URL } from "./constants";

const EMPTY: ChannelsSnapshot = { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };

export function useChannelsState(onSnapshotChange?: (snapshot: ChannelsSnapshot) => void) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<ChannelsSnapshot>(EMPTY);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState<ChannelLoginEvent | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);
  const [telegramError, setTelegramError] = useState("");
  const [feishuDialogOpen, setFeishuDialogOpen] = useState(false);
  const [feishuError, setFeishuError] = useState("");
  const [feishuScanDomain, setFeishuScanDomain] = useState<FeishuDomain>("feishu");

  const refresh = useCallback(async () => {
    try {
      const [channels, sessionResult] = await Promise.all([call("channels.list"), listSessions()]);
      setSnapshot(channels);
      onSnapshotChange?.(channels);
      setSessions(sessionResult.sessions);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [onSnapshotChange]);

  useEffect(() => {
    void refresh();
    const unsubs: Array<() => void> = [];
    void Promise.all([
      subscribe("channels.status", "*", () => void refresh()),
      subscribe("channels.pairing", "*", () => void refresh()),
      subscribe("channels.binding", "*", () => void refresh()),
      subscribe("channels.activity", "*", () => void refresh()),
      subscribe("channels.login", "*", (event) => setLogin(event)),
    ]).then((items) => unsubs.push(...items));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [refresh]);

  useEffect(() => {
    if (
      !login ||
      ["confirmed", "already_connected", "expired", "error", "cancelled", "verification_required"].includes(login.phase)
    ) {
      return;
    }
    let cancelled = false;
    const delay = Math.min(10_000, Math.max(500, login.pollAfterMs ?? 600));
    const timer = setTimeout(() => {
      void call("channels.loginWait", { channel: login.channel, sessionKey: login.sessionKey })
        .then((event) => {
          if (!cancelled) {
            setLogin(event);
            if (event.phase === "confirmed" || event.accountId) void refresh();
          }
        })
        .catch((cause) => {
          if (!cancelled) {
            setLogin({
              ...login,
              phase: "error",
              message: cause instanceof Error ? cause.message : String(cause),
            });
          }
        });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [login, refresh]);

  const run = useCallback(
    async (task: () => Promise<unknown>) => {
      setBusy(true);
      setError("");
      try {
        await task();
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const beginLogin = () =>
    run(async () => {
      const event = await call("channels.loginStart", { channel: "weixin", force: true });
      setLogin(event);
    });

  const beginFeishuLogin = async (domain: FeishuDomain) => {
    setBusy(true);
    setFeishuError("");
    setFeishuScanDomain(domain);
    try {
      const event = await call("channels.loginStart", { channel: "feishu", domain, force: true });
      setFeishuDialogOpen(false);
      setLogin(event);
    } catch (cause) {
      setFeishuError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const connectTelegram = async (token: string) => {
    setBusy(true);
    setTelegramError("");
    try {
      const now = new Date().toISOString();
      const accountId = `telegram-${crypto.randomUUID()}`;
      const account: ChannelAccountConfig = {
        id: accountId,
        channel: "telegram",
        name: "",
        enabled: false,
        dmPolicy: "pairing",
        allowFrom: [],
        groupPolicy: "disabled",
        groupIds: [],
        groupAllowFrom: [],
        requireMention: true,
        commandsEnabled: false,
        toolNames: [],
        createdAt: now,
        updatedAt: now,
      };
      if (typeof window.piBridge.setChannelCredential !== "function") {
        throw new Error(
          t("telegramBridgeUnavailable", "The desktop runtime is outdated. Restart Pi Desktop and try again."),
        );
      }
      await window.piBridge.setChannelCredential({
        channel: "telegram",
        accountId,
        credential: { token, providerAccountId: accountId, baseUrl: TELEGRAM_BASE_URL },
      });
      const next = await call("channels.accountConnect", { account });
      setSnapshot(next);
      onSnapshotChange?.(next);
      setTelegramDialogOpen(false);
    } catch (cause) {
      setTelegramError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const connectFeishu = async (appId: string, appSecret: string, domain: FeishuDomain) => {
    setBusy(true);
    setFeishuError("");
    try {
      const now = new Date().toISOString();
      const accountId = `feishu-${crypto.randomUUID()}`;
      const account: ChannelAccountConfig = {
        id: accountId,
        channel: "feishu",
        name: "",
        enabled: false,
        appId,
        domain,
        baseUrl: FEISHU_BASE_URLS[domain],
        dmPolicy: "pairing",
        allowFrom: [],
        groupPolicy: "disabled",
        groupIds: [],
        groupAllowFrom: [],
        requireMention: true,
        commandsEnabled: false,
        toolNames: [],
        createdAt: now,
        updatedAt: now,
      };
      if (typeof window.piBridge.setChannelCredential !== "function") {
        throw new Error(
          t("channelBridgeUnavailable", "The desktop credential bridge is unavailable. Restart Pi Desktop."),
        );
      }
      await window.piBridge.setChannelCredential({
        channel: "feishu",
        accountId,
        credential: {
          token: appSecret,
          providerAccountId: accountId,
          baseUrl: FEISHU_BASE_URLS[domain],
        },
      });
      const next = await call("channels.accountConnect", { account });
      setSnapshot(next);
      onSnapshotChange?.(next);
      setFeishuDialogOpen(false);
    } catch (cause) {
      setFeishuError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const closeLogin = () => {
    if (login && !["confirmed", "already_connected", "expired", "error", "cancelled"].includes(login.phase)) {
      void call("channels.loginCancel", { channel: login.channel, sessionKey: login.sessionKey });
    }
    setLogin(null);
    setVerificationCode("");
  };

  return {
    snapshot,
    sessions,
    loading,
    busy,
    error,
    login,
    setLogin,
    verificationCode,
    setVerificationCode,
    telegramDialogOpen,
    setTelegramDialogOpen,
    telegramError,
    setTelegramError,
    feishuDialogOpen,
    setFeishuDialogOpen,
    feishuError,
    setFeishuError,
    feishuScanDomain,
    refresh,
    run,
    beginLogin,
    beginFeishuLogin,
    connectTelegram,
    connectFeishu,
    closeLogin,
  };
}
