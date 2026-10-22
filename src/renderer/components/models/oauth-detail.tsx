import { SectionTitle } from "../form-controls";
import { useI18n } from "@/i18n";
import { ManagedModelsControl } from "./managed-models-control";
import type { ModelSelectionControl, OAuthProvider } from "./types";
import { useOAuthLogin } from "./use-oauth-login";

export function OAuthDetail({
  provider,
  onRefresh,
  modelSelection,
}: {
  provider: OAuthProvider;
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("modelSubscription", "Subscription")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: provider.loggedIn ? "var(--fx-status-success)" : "var(--fx-line-default)",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontSize: "var(--text-meta)",
              color: provider.loggedIn ? "var(--fx-status-success)" : "var(--fx-text-tertiary)",
            }}
          >
            {provider.loggedIn ? t("modelConnected", "connected") : t("modelNotConnected", "not connected")}
          </span>
        </div>
      </div>

      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", lineHeight: 1.5 }}>
            {provider.loggedIn
              ? t("modelAlreadyConnected", "Already connected. You can re-login or disconnect.")
              : t("modelConnectAccount", "Connect your {provider} account.").replace("{provider}", provider.name)}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-text-secondary)" }}>
            {t("modelOpeningBrowser", "Opening browser…")}
          </p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{
                    padding: "8px 8px",
                    background: "var(--fx-surface-main)",
                    border: "1px solid var(--fx-line-default)",
                    borderRadius: "var(--radius-control)",
                    color: "var(--fx-text-primary)",
                    cursor: "pointer",
                    fontSize: "var(--text-label)",
                    textAlign: "left",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? t(
                    "modelCompleteSignIn",
                    "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below.",
                  )
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--fx-text-tertiary)", lineHeight: 1.5 }}>
                {t("modelBrowserDidNotOpen", "If the browser window did not open,")}{" "}
                <a
                  href={loginState.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--fx-accent-blue)", wordBreak: "break-all" }}
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
                style={{
                  flex: 1,
                  padding: "8px 8px",
                  background: "var(--fx-surface-main)",
                  border: "1px solid var(--fx-line-default)",
                  borderRadius: "var(--radius-control)",
                  color: "var(--fx-text-primary)",
                  fontSize: "var(--text-label)",
                  outline: "none",
                  fontFamily: "var(--font-mono)",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{
                  padding: "8px 12px",
                  background: inputValue.trim() ? "var(--fx-accent-blue-fill)" : "var(--fx-surface-raised)",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  color: inputValue.trim() ? "var(--fx-text-on-accent)" : "var(--fx-text-tertiary)",
                  cursor: inputValue.trim() ? "pointer" : "not-allowed",
                  fontSize: "var(--text-label)",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {t("submit", "Submit")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", lineHeight: 1.5 }}>
              {t("modelOpenVerificationPage", "Open the verification page and enter this code:")}
            </p>
            <div
              style={{
                padding: "8px 12px",
                background: "var(--fx-surface-main)",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-primary)",
                fontSize: "var(--text-title)",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                letterSpacing: 0,
              }}
            >
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--fx-text-tertiary)", lineHeight: 1.5 }}>
              <a
                href={loginState.verificationUri}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--fx-accent-blue)", wordBreak: "break-all" }}
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
          <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-text-secondary)" }}>
            {loginState.message}
          </p>
        )}
        {loginState.phase === "success" && (
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-label)",
              color: loginState.warning ? "var(--fx-status-warning)" : "var(--fx-status-success)",
            }}
          >
            {loginState.message ?? t("modelConnectedSuccessfully", "Connected successfully.")}
          </p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: "var(--text-label)", color: "var(--fx-status-danger)" }}>
            {loginState.message}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            onClick={handleCancelLogin}
            style={{
              padding: "4px 12px",
              background: "none",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-control)",
              color: "var(--fx-text-secondary)",
              cursor: "pointer",
              fontSize: "var(--text-label)",
            }}
          >
            {t("cancel", "Cancel")}
          </button>
        ) : (
          <>
            <button
              onClick={handleLogin}
              style={{
                padding: "4px 16px",
                background: "var(--fx-accent-blue-fill)",
                border: "none",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-on-accent)",
                cursor: "pointer",
                fontSize: "var(--text-label)",
                fontWeight: 600,
              }}
            >
              {provider.loggedIn ? t("modelRelogin", "Re-login") : t("modelLogin", "Login")}
            </button>
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{
                  padding: "4px 12px",
                  background: "none",
                  border: "1px solid var(--fx-status-danger-border)",
                  borderRadius: "var(--radius-control)",
                  color: "var(--fx-status-danger)",
                  cursor: "pointer",
                  fontSize: "var(--text-label)",
                }}
              >
                {t("modelDisconnect", "Disconnect")}
              </button>
            )}
          </>
        )}
      </div>

      {provider.loggedIn && <ManagedModelsControl providerId={provider.id} {...modelSelection} />}
    </div>
  );
}
