import type { CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { BrowserIcon, type BrowserIconName } from "../browser-icons";
import { ToggleRow, cardStyle, type BrowserSettingsModel } from "./shared";

export function BrowserHero({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { settings, update } = model;
  return (
    <section aria-label={t("browserSettingsTitle", "Built-in Browser")} style={cardStyle}>
      <div style={previewStyle}>
        <MiniBrowser sandboxLabel={t("browserSandboxBadge", "Sandbox")} />
        <ul style={factsStyle}>
          <HeroFact
            icon="container"
            title={t("browserFactSandbox", "Sandboxed")}
            description={t("browserFactSandboxDescription", "Pages run in a separate renderer process")}
          />
          <HeroFact
            icon="shield-check"
            title={t("browserFactIsolation", "Internal access isolated")}
            description={t("browserFactIsolationDescription", "Remote pages can't call Dexon")}
          />
          <HeroFact
            icon="bot"
            title={t("browserAgentAccess", "Agent access")}
            description={t("browserFactAgentDescription", "Granted separately, off by default")}
          />
        </ul>
      </div>
      <ToggleRow
        label={t("browserEnableBuiltIn", "Built-in Browser")}
        description={t(
          "browserSettingsDescription",
          "When off, neither you nor the Agent can open built-in tabs, and Browser tools are disabled.",
        )}
        checked={settings.enabled}
        onChange={(enabled) => void update({ enabled })}
      />
    </section>
  );
}

function HeroFact({ icon, title, description }: { icon: BrowserIconName; title: string; description: string }) {
  return (
    <li style={factStyle}>
      <span style={factIconStyle}>
        <BrowserIcon name={icon} size={14} strokeWidth={2} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 1 }}>
        <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
          {title}
        </span>
        <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {description}
        </span>
      </span>
    </li>
  );
}

function MiniBrowser({ sandboxLabel }: { sandboxLabel: string }) {
  return (
    <div aria-hidden="true" style={miniBrowserStyle}>
      <div style={tabBarStyle}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 6px 9px 0" }}>
          <span style={dotStyle} />
          <span style={dotStyle} />
          <span style={dotStyle} />
        </span>
        <span style={activeTabStyle}>
          <span style={{ ...barStyle, width: 8, height: 8, background: "var(--fx-accent-blue)" }} />
          <span style={{ ...barStyle, width: 48, background: "var(--fx-text-body)" }} />
        </span>
        <span style={{ display: "flex", alignItems: "center", padding: "9px 12px 9px 10px" }}>
          <span style={{ ...barStyle, width: 40, background: "var(--fx-surface-selected)" }} />
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
        <span style={{ ...barStyle, width: 8, height: 8, background: "var(--fx-surface-selected)" }} />
        <span style={{ ...barStyle, width: 8, height: 8, background: "var(--fx-surface-selected)" }} />
        <span style={addressStyle}>
          <span style={{ color: "var(--fx-accent-blue-text)" }}>
            <BrowserIcon name="lock" size={10} strokeWidth={2} />
          </span>
          <span style={{ ...barStyle, width: 96, background: "var(--fx-line-strong)" }} />
        </span>
        <span className="type-meta-micro" style={sandboxBadgeStyle}>
          <BrowserIcon name="shield-check" size={10} strokeWidth={2} />
          {sandboxLabel}
        </span>
      </div>
      <div style={pageStyle}>
        <span
          style={{ width: 72, height: 6, borderRadius: "var(--radius-skeleton)", background: "var(--fx-text-body)" }}
        />
        <span style={pageCardStyle} />
        <span style={{ ...barStyle, width: "80%", background: "var(--fx-surface-selected)" }} />
        <span style={{ ...barStyle, width: "60%", background: "var(--fx-surface-selected)" }} />
      </div>
    </div>
  );
}

const previewStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 16, padding: 20 };

const miniBrowserStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 184,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-card)",
  background: "var(--fx-surface-main)",
};

const tabBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 6,
  padding: "8px 10px 0",
  background: "var(--fx-surface-inset)",
};

const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "var(--radius-skeleton)",
  background: "var(--fx-surface-selected)",
};

const barStyle: CSSProperties = { flexShrink: 0, height: 4, borderRadius: "var(--radius-bar)" };

const activeTabStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px 7px 10px",
  borderRadius: "var(--radius-chip) var(--radius-chip) 0 0",
  background: "var(--fx-surface-main)",
};

const addressStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 22,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 8px",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-chip)",
  background: "var(--fx-surface-card)",
};

const sandboxBadgeStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 7px 3px 6px",
  borderRadius: "var(--radius-kbd)",
  background: "var(--fx-accent-blue-soft)",
  color: "var(--fx-accent-blue-text)",
};

const pageStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 7,
  padding: "6px 12px 12px",
};

const pageCardStyle: CSSProperties = {
  height: 34,
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-chip)",
  background: "var(--fx-surface-card)",
};

const factsStyle: CSSProperties = {
  width: 236,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const factStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-card)",
  background: "var(--fx-surface-raised)",
};

const factIconStyle: CSSProperties = {
  width: 28,
  height: 28,
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  borderRadius: "var(--radius-row)",
  background: "var(--fx-accent-blue-soft)",
  color: "var(--fx-accent-blue-text)",
};
