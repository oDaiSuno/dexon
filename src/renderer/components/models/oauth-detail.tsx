import { useEffect, useState } from "react";
import { Button } from "../form-controls";
import { useI18n } from "@/i18n";
import { ManagedModelsControl } from "./managed-models-control";
import { TrashIcon } from "./models-footer";
import { DetailSection, DetailSections } from "./provider-dialog-parts";
import type { ModelSelectionControl, OAuthProvider } from "./types";
import { useOAuthLogin } from "./use-oauth-login";

export function OAuthDetail({
  provider,
  autoStart = false,
  onRefresh,
  modelSelection,
}: {
  provider: OAuthProvider;
  autoStart?: boolean;
  onRefresh: () => void;
  modelSelection: ModelSelectionControl;
}) {
  const { t } = useI18n();
  const {
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
  } = useOAuthLogin(provider, onRefresh);
  const [autoStartPending, setAutoStartPending] = useState(autoStart);
  useEffect(() => {
    if (!autoStartPending) return;
    setAutoStartPending(false);
    void handleLogin();
  }, [autoStartPending, handleLogin]);

  return (
    <DetailSections>
      <DetailSection title={t("modelProvider", "Connection")} gap={14}>
        <div>
          {loginState.phase === "idle" && (
            <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
              {provider.loggedIn
                ? t("modelAlreadyConnected", "Already connected. You can re-login or disconnect.")
                : t("modelConnectAccount", "Connect your {provider} account.").replace("{provider}", provider.name)}
            </p>
          )}
          {loginState.phase === "connecting" && (
            <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
              {t("modelOpeningBrowser", "Opening browser…")}
            </p>
          )}
          {loginState.phase === "select" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
                {loginState.message}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {loginState.options.map((option) => (
                  <Button
                    key={option.id}
                    onClick={() => submitSelection(loginState.token, option.id)}
                    style={{ justifyContent: "flex-start" }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {(loginState.phase === "auth" || loginState.phase === "prompt") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
                {loginState.phase === "auth"
                  ? t(
                      "modelCompleteSignIn",
                      "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below.",
                    )
                  : loginState.message}
              </p>
              {loginState.phase === "auth" && (
                <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
                  {t("modelBrowserDidNotOpen", "If the browser window did not open,")}{" "}
                  <a
                    href={loginState.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--fx-accent-blue-text)", wordBreak: "break-all" }}
                  >
                    {t("modelOpenLoginPage", "click here to open the login page")}
                  </a>
                  .
                </p>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitCode(loginState.token, inputValue);
                  }}
                  placeholder={
                    loginState.phase === "auth"
                      ? "http://localhost:1455/auth/callback?code=…"
                      : (loginState.placeholder ?? t("modelEnterValue", "Enter value…"))
                  }
                  className="ui-input type-mono-label"
                  data-mono="true"
                  style={{ flex: 1 }}
                />
                <Button
                  variant="primary"
                  onClick={() => submitCode(loginState.token, inputValue)}
                  disabled={!inputValue.trim()}
                  style={{ flexShrink: 0 }}
                >
                  {t("submit", "Submit")}
                </Button>
              </div>
            </div>
          )}
          {loginState.phase === "device_code" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
                {t("modelOpenVerificationPage", "Open the verification page and enter this code:")}
              </p>
              <div
                className="type-mono-number-strong"
                style={{
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--fx-surface-inset)",
                  border: "1px solid var(--fx-line-default)",
                  borderRadius: "var(--radius-control)",
                  color: "var(--fx-text-primary)",
                }}
              >
                {loginState.userCode}
              </div>
              <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
                <a
                  href={loginState.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--fx-accent-blue-text)", wordBreak: "break-all" }}
                >
                  {loginState.verificationUri}
                </a>
                {loginState.expiresInSeconds
                  ? ` ${t("modelCodeExpires", "Expires in {minutes} minutes.").replace(
                      "{minutes}",
                      String(Math.ceil(loginState.expiresInSeconds / 60)),
                    )}`
                  : ""}
              </p>
            </div>
          )}
          {loginState.phase === "progress" && (
            <p className="type-body-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
              {loginState.message}
            </p>
          )}
          {loginState.phase === "success" && (
            <p
              className="type-body-default"
              style={{
                margin: 0,
                color: loginState.warning ? "var(--fx-status-warning)" : "var(--fx-status-success)",
              }}
            >
              {loginState.message ?? t("modelConnectedSuccessfully", "Connected successfully.")}
            </p>
          )}
          {loginState.phase === "error" && (
            <p className="type-body-default" style={{ margin: 0, color: "var(--fx-status-danger)" }}>
              {loginState.message}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {isWorking ? (
            <Button onClick={handleCancelLogin}>{t("cancel", "Cancel")}</Button>
          ) : (
            <>
              <Button variant="primary" onClick={handleLogin}>
                {provider.loggedIn ? t("modelRelogin", "Re-login") : t("modelLogin", "Login")}
              </Button>
              {provider.loggedIn && (
                <Button variant="ghost" onClick={handleLogout}>
                  <TrashIcon />
                  {t("modelDisconnect", "Disconnect")}
                </Button>
              )}
            </>
          )}
        </div>
      </DetailSection>

      {provider.loggedIn && <ManagedModelsControl providerId={provider.id} {...modelSelection} />}
    </DetailSections>
  );
}
