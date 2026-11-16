import { isRpcError } from "@contract/types";
import type { EnvironmentId } from "@contract/environment";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { getEnvironmentApiClient } from "@/lib/api-client";
import type { OAuthLoginState, OAuthProvider } from "./types";

export function useOAuthLogin(environmentId: EnvironmentId, provider: OAuthProvider, onRefresh: () => void) {
  const api = useMemo(() => getEnvironmentApiClient(environmentId), [environmentId]);
  const { t } = useI18n();
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const unsubscribeRef = useRef<(() => void) | null>(null);
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
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    return () => {
      loginAttemptRef.current += 1;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      void api.call("auth.loginCancel", { provider: providerId }).catch(() => {});
    };
  }, [api, provider.id]);

  const handleLogin = useCallback(async () => {
    const attempt = loginAttemptRef.current + 1;
    loginAttemptRef.current = attempt;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setLoginState({ phase: "connecting" });
    setInputValue("");

    try {
      await api.call("auth.loginCancel", { provider: provider.id });
    } catch (error) {
      if (loginAttemptRef.current !== attempt) return;
      setLoginState({
        phase: "error",
        message: error instanceof Error ? error.message : t("modelUnableResetLogin", "Unable to reset login"),
      });
      return;
    }
    if (loginAttemptRef.current !== attempt) return;

    let finished = false;
    const finish = () => {
      finished = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
    try {
      const unsubscribe = await api.subscribe("auth.login", provider.id, (data) => {
        if (finished || loginAttemptRef.current !== attempt) return;
        if (data.type === "auth") {
          setLoginState({ phase: "auth", url: data.url, instructions: data.instructions ?? null, token: data.token });
          if (data.url) {
            void (
              window.piBridge?.openExternal(data.url) ??
              Promise.resolve(window.open(data.url, "_blank", "noopener,noreferrer"))
            );
          }
        } else if (data.type === "device_code") {
          setLoginState({
            phase: "device_code",
            userCode: data.userCode,
            verificationUri: data.verificationUri,
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
            message: data.message,
            placeholder: data.placeholder ?? null,
            token: data.token,
          });
        } else if (data.type === "select_request") {
          setLoginState({ phase: "select", message: data.message, options: data.options ?? [], token: data.token });
        } else if (data.type === "progress") {
          setLoginState({ phase: "progress", message: data.message });
        } else if (data.type === "success") {
          finish();
          setLoginState({
            phase: "success",
            ...(data.warning ? { message: data.warning.message, warning: true } : {}),
          });
          onRefresh();
        } else if (data.type === "error") {
          finish();
          setLoginState({ phase: "error", message: data.message });
        } else if (data.type === "cancelled") {
          finish();
          setLoginState({ phase: "idle" });
        }
      });
      if (finished || loginAttemptRef.current !== attempt) {
        unsubscribe();
        return;
      }
      unsubscribeRef.current = unsubscribe;
      const result = await api.call("auth.loginStart", { provider: provider.id });
      if (loginAttemptRef.current !== attempt) {
        unsubscribe();
        void api.call("auth.loginCancel", { provider: provider.id }).catch(() => {});
        return;
      }
      if (!result.started) throw new Error("An OAuth login is already active. Cancel it and try again.");
    } catch (error) {
      if (loginAttemptRef.current !== attempt) return;
      finish();
      setLoginState({
        phase: "error",
        message: error instanceof Error ? error.message : t("modelConnectionLost", "Connection lost"),
      });
    }
  }, [api, provider.id, onRefresh, t]);

  const handleCancelLogin = useCallback(() => {
    loginAttemptRef.current += 1;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setLoginState({ phase: "idle" });
    setInputValue("");
    void api.call("auth.loginCancel", { provider: provider.id }).catch(() => {});
  }, [api, provider.id]);

  const handleLogout = useCallback(async () => {
    try {
      const result = await api.call("auth.logout", { provider: provider.id });
      setLoginState(
        result.warning
          ? { phase: "success", message: result.warning.message, warning: true }
          : { phase: "success", message: t("modelDisconnectedSuccessfully", "Disconnected successfully.") },
      );
      onRefresh();
    } catch (error) {
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [api, provider.id, onRefresh, t]);

  const submissionErrorMessage = useCallback(
    (error: unknown) => {
      if (error instanceof Error && error.message) return error.message;
      return isRpcError(error)
        ? t("modelServerError", "Server error {status}").replace("{status}", error.code)
        : t("modelNetworkError", "Network error");
    },
    [t],
  );

  const submitCode = useCallback(
    async (token: string, code: string) => {
      if (!code.trim()) return;
      setLoginState({ phase: "progress", message: t("modelVerifying", "Verifying…") });
      try {
        await api.call("auth.loginSubmit", { provider: provider.id, token, code: code.trim() });
        setInputValue("");
      } catch (e) {
        setLoginState({
          phase: "error",
          message: submissionErrorMessage(e),
        });
      }
    },
    [api, provider.id, submissionErrorMessage, t],
  );

  const submitSelection = useCallback(
    async (token: string, value: string) => {
      setLoginState({ phase: "progress", message: t("modelContinuing", "Continuing…") });
      try {
        await api.call("auth.loginSubmit", { provider: provider.id, token, code: value });
      } catch (e) {
        setLoginState({
          phase: "error",
          message: submissionErrorMessage(e),
        });
      }
    },
    [api, provider.id, submissionErrorMessage, t],
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
