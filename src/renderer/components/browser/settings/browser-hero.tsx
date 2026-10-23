import { useI18n } from "@/i18n";

export function BrowserHero() {
  const { t } = useI18n();
  return (
    <header style={{ display: "grid", gap: "var(--space-2)" }}>
      <h2 className="type-title-section" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
        {t("browserSettingsTitle", "Built-in Browser")}
      </h2>
      <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-tertiary)", textWrap: "pretty" }}>
        {t(
          "browserSettingsDescription",
          "Websites run in Main-owned, sandboxed Electron WebContentsView instances. Agent access is a separate, default-off permission.",
        )}
      </p>
    </header>
  );
}
