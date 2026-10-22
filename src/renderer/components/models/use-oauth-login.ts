import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import type { OAuthLoginState, OAuthProvider } from "./types";

export function useOAuthLogin(provider: OAuthProvider, onRefresh: () => void) {
  const { t } = useI18n();
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const loginAttemptRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  useEffect(() => {
    const providerId = provider.id;
    loginAttemptRef.current += 1;
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    return () => {
      loginAttemptRef.current += 1;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      void call("auth.loginCancel", { provider: providerId }).catch(() => {});
    };
  }, [provider.id]);

  const handleLogin = useCallback(async () => {
    const attempt = loginAttemptRef.current + 1;
    loginAttemptRef.current = attempt;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setLoginState({ phase: "connecting" });
    setInputValue("");

    try {
      await call("auth.loginCancel", { provider: provider.id });
    } catch (error) {
      if (loginAttemptRef.current !== attempt) return;
      setLoginState({
        phase: "error",
        message: error instanceof Error ? error.message : t("modelUnableResetLogin", "Unable to reset login"),
      });
      return;
    }
    if (loginAttemptRef.current !== attempt) return;

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      if (eventSourceRef.current !== es || loginAttemptRef.current !== attempt) return;
      const data = JSON.parse(e.data) as {
        type: string;
        url?: string;
        instructions?: string | null;
        token?: string;
        message?: string;
        placeholder?: string | null;
        userCode?: string;
        verificationUri?: string;
        intervalSeconds?: number | null;
        expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
        warning?: { code: "MODEL_SYNC_FAILED"; message: string };
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        if (data.url) {
          void (
            window.piBridge?.openExternal(data.url) ??
            Promise.resolve(window.open(data.url, "_blank", "noopener,noreferrer"))
          );
        }
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        if (data.verificationUri) {
          void (
            window.piBridge?.openExternal(data.verificationUri) ??
            Promise.resolve(window.open(data.verificationUri, "_blank", "noopener,noreferrer"))
          );
        }
      } else if (data.type === "prompt_request") {
        setLoginState({
          phase: "prompt",
          message: data.message!,
          placeholder: data.placeholder ?? null,
          token: data.token!,
        });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        eventSourceRef.current = null;
        setLoginState({
          phase: "success",
          ...(data.warning ? { message: data.warning.message, warning: true } : {}),
        });
        onRefresh();
      } else if (data.type === "error") {
        es.close();
        eventSourceRef.current = null;
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        eventSourceRef.current = null;
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = (event) => {
      if (eventSourceRef.current !== es || loginAttemptRef.current !== attempt) return;
      es.close();
      eventSourceRef.current = null;
      const message =
        event instanceof ErrorEvent && event.message ? event.message : t("modelConnectionLost", "Connection lost");
      setLoginState((prev) => (prev.phase === "success" ? prev : { phase: "error", message }));
    };
  }, [provider.id, onRefresh, t]);

  const handleCancelLogin = useCallback(() => {
    loginAttemptRef.current += 1;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setLoginState({ phase: "idle" });
    setInputValue("");
    void call("auth.loginCancel", { provider: provider.id }).catch(() => {});
  }, [provider.id]);

  const handleLogout = useCallback(async () => {
    try {
      const response = await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as {
        warning?: { code: "MODEL_SYNC_FAILED"; message: string };
        error?: string;
      };
      if (!response.ok || result.error) {
        setLoginState({ phase: "error", message: result.error ?? `HTTP ${response.status}` });
        return;
      }
      setLoginState(
        result.warning
          ? { phase: "success", message: result.warning.message, warning: true }
          : { phase: "success", message: t("modelDisconnectedSuccessfully", "Disconnected successfully.") },
      );
      onRefresh();
    } catch (error) {
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [provider.id, onRefresh, t]);

  const submitCode = useCallback(
    async (token: string, code: string) => {
      if (!code.trim()) return;
      setLoginState({ phase: "progress", message: t("modelVerifying", "Verifying…") });
      try {
        const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, code: code.trim() }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setLoginState({
            phase: "error",
            message: d.error ?? t("modelServerError", "Server error {status}").replace("{status}", String(res.status)),
          });
          return;
        }
        setInputValue("");
      } catch (e) {
        setLoginState({
          phase: "error",
          message: e instanceof Error ? e.message : t("modelNetworkError", "Network error"),
        });
      }
    },
    [provider.id, t],
  );

  const submitSelection = useCallback(
    async (token: string, value: string) => {
      setLoginState({ phase: "progress", message: t("modelContinuing", "Continuing…") });
      try {
        const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, code: value }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setLoginState({
            phase: "error",
            message: d.error ?? t("modelServerError", "Server error {status}").replace("{status}", String(res.status)),
          });
        }
      } catch (e) {
        setLoginState({
          phase: "error",
          message: e instanceof Error ? e.message : t("modelNetworkError", "Network error"),
        });
      }
    },
    [provider.id, t],
  );

  const isWorking =
    loginState.phase === "connecting" ||
    loginState.phase === "progress" ||
    loginState.phase === "auth" ||
    loginState.phase === "device_code" ||
    loginState.phase === "prompt" ||
    loginState.phase === "select";

  return {
    loginState,
    inputValue,
    setInputValue,
    inputRef,
    handleLogin,
    handleCancelLogin,
    handleLogout,
    submitCode,
    submitSelection,
    isWorking,
  };
}
