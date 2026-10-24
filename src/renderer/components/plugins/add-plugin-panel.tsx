import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { installLocation, type PluginScope } from "./plugin-shared";
import { SegmentedScope } from "./plugin-controls";

export function AddPluginPanel({
  cwd,
  source,
  scope,
  busy,
  actionError,
  onSourceChange,
  onScopeChange,
  onInstall,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  busy: boolean;
  actionError: string | null;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const examples = ["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 660, minHeight: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: "var(--text-body-lg)", fontWeight: 700, color: "var(--fx-text-primary)" }}>
          {t("addPlugin", "Add plugin")}
        </div>
        <div
          style={{ fontSize: "var(--text-label)", color: "var(--fx-text-tertiary)", fontFamily: "var(--font-mono)" }}
        >
          {installLocation(scope, cwd)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label
          htmlFor="plugin-source"
          style={{ fontSize: "var(--text-label)", fontWeight: 600, color: "var(--fx-text-secondary)" }}
        >
          {t("pluginSource", "Source")}
        </label>
        <input
          id="plugin-source"
          ref={inputRef}
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          placeholder={t("pluginSourcePlaceholder", "npm:@scope/package")}
          style={{
            width: "100%",
            height: 36,
            padding: "0 12px",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-control)",
            background: "var(--fx-surface-raised)",
            color: "var(--fx-text-primary)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-body)",
            outline: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && source.trim() && !busy) onInstall();
          }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <SegmentedScope value={scope} onChange={onScopeChange} />
        <Button variant="primary" onClick={onInstall} disabled={busy || !source.trim()} busy={busy}>
          {busy ? t("installing", "Installing…") : t("install", "Install")}
        </Button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: "var(--text-label)", fontWeight: 600, color: "var(--fx-text-secondary)" }}>
          {t("pluginExamples", "Examples")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onSourceChange(example)}
              style={{
                width: "100%",
                minHeight: 30,
                textAlign: "left",
                padding: "8px 8px",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                background: "var(--fx-surface-raised)",
                color: "var(--fx-text-tertiary)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-meta)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--fx-text-secondary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--fx-surface-raised)";
                e.currentTarget.style.color = "var(--fx-text-tertiary)";
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div style={{ fontSize: "var(--text-label)", color: "var(--fx-status-danger)", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}
