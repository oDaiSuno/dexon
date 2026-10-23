import { useId } from "react";
import { useI18n } from "@/i18n";
import { APP_AUTHOR, APP_DISPLAY_NAME, APP_VERSION, PI_VERSION } from "@/lib/app-version";
import { APP_ISSUES_URL, APP_REPOSITORY_URL, APP_WEBSITE_URL } from "@shared/app-links";
import appIconUrl from "../../../../build/icon.png";
import { Toggle } from "../form-controls";
import { GithubIcon, GlobeIcon, MessageCircleIcon } from "./about-icons";
import type { SoftwareUpdateModel } from "./use-software-update";

export function AboutHero({ update }: { update: SoftwareUpdateModel }) {
  const { t } = useI18n();
  const automaticChecksControlId = useId();
  const automaticChecksDescriptionId = useId();
  const { state, isBusy } = update;

  return (
    <section
      aria-label={t("applicationInformation", "Application information")}
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-hero)",
        background: "linear-gradient(160deg, var(--fx-surface-hero-tint) 0%, var(--fx-surface-raised) 55%)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-5)",
          padding: "var(--space-7) var(--space-7) var(--space-6)",
        }}
      >
        <img
          src={appIconUrl}
          alt={t("appIconAlt", "Dexon app icon")}
          style={{
            width: 72,
            height: 72,
            flexShrink: 0,
            objectFit: "cover",
            borderRadius: "var(--radius-app-icon)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-1-5)" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-2-5)" }}>
            <h2 className="type-title-hero" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
              {APP_DISPLAY_NAME}
            </h2>
            <span className="type-body-large" style={{ color: "var(--fx-text-tertiary)" }}>
              <span className="sr-only">{t("softwareVersion", "Software version")} </span>
              {APP_VERSION}
            </span>
            <span style={{ flex: 1 }} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                paddingBottom: "var(--space-0-5)",
              }}
            >
              <label
                htmlFor={automaticChecksControlId}
                className="type-label-default"
                style={{ color: "var(--fx-text-tertiary)", cursor: "pointer" }}
              >
                {t("automaticUpdateChecks", "Automatically check for updates")}
              </label>
              <span id={automaticChecksDescriptionId} className="sr-only">
                {t(
                  "automaticUpdateChecksDescription",
                  "Checks periodically without downloading updates automatically.",
                )}
              </span>
              <Toggle
                id={automaticChecksControlId}
                aria-describedby={automaticChecksDescriptionId}
                checked={state?.automaticChecksEnabled ?? false}
                disabled={!state || state.phase === "disabled" || isBusy}
                onChange={(event) => update.setAutomaticChecks(event.target.checked)}
              />
            </div>
          </div>
          <p className="type-body-large" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
            {t("aboutDescription", "Desktop workbench for AI coding agents")}
          </p>
          {PI_VERSION !== "unknown" && (
            <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
              {t("piVersion", "Built on Pi Coding Agent {version}").replace("{version}", PI_VERSION)}
            </p>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "var(--space-2-5) var(--space-5-5)",
          borderTop: "1px solid var(--fx-line-default)",
        }}
      >
        <HeroLink
          icon={<GlobeIcon />}
          label={t("officialWebsite", "Official website")}
          title={t("openOfficialWebsite", "Open official website")}
          url={APP_WEBSITE_URL}
        />
        <HeroLink
          icon={<GithubIcon />}
          label={t("githubRepository", "GitHub")}
          title={t("openGithubRepository", "Open GitHub repository")}
          url={APP_REPOSITORY_URL}
        />
        <HeroLink
          icon={<MessageCircleIcon />}
          label={t("issueFeedback", "Feedback")}
          title={t("openIssueFeedback", "Report an issue on GitHub")}
          url={APP_ISSUES_URL}
        />
        <span style={{ flex: 1 }} />
        <span
          className="type-label-default"
          title={`${t("author", "Author")}: ${APP_AUTHOR}`}
          style={{ color: "var(--fx-text-tertiary)" }}
        >
          {`© ${new Date().getFullYear()} ${APP_AUTHOR}`}
        </span>
      </div>
    </section>
  );
}

function HeroLink({ icon, label, title, url }: { icon: React.ReactNode; label: string; title: string; url: string }) {
  return (
    <button
      type="button"
      title={title}
      className="ui-link-button type-body-default"
      onClick={() => void window.piBridge.openExternal(url)}
      style={{
        gap: "var(--space-1-5)",
        padding: "var(--space-1-5) var(--space-2)",
        borderRadius: "var(--radius-row)",
        color: "var(--fx-text-secondary)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
