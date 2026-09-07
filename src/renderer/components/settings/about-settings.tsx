import { useI18n } from "@/i18n";
import { APP_AUTHOR, APP_DISPLAY_NAME, APP_GITHUB_URL, APP_VERSION, PI_VERSION } from "@/lib/app-version";
import appIconUrl from "../../../../build/icon.png";
import { APP_WEBSITE_URL } from "@shared/app-links";
import { SoftwareUpdate } from "./software-update";

export function AboutSettings({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div
      style={{
        width: "100%",
        overflowY: "auto",
        padding: "28px clamp(20px, 5vw, 52px)",
        display: "flex",
      }}
    >
      <div style={{ width: "100%", maxWidth: 620, margin: "auto" }}>
        <section
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            paddingBottom: 28,
          }}
        >
          <img
            aria-hidden="true"
            src={appIconUrl}
            alt=""
            style={{
              width: 64,
              height: 64,
              objectFit: "contain",
              flexShrink: 0,
              filter: "drop-shadow(0 4px 10px color-mix(in srgb, #000 12%, transparent))",
            }}
          />
          <div>
            <h2 style={{ margin: 0, fontSize: "var(--text-heading-lg)", color: "var(--text)" }}>{APP_DISPLAY_NAME}</h2>
            <p style={{ margin: "4px 0 0", fontSize: "var(--text-label)", lineHeight: 1.6, color: "var(--text-dim)" }}>
              {t("aboutDescription", "App, Pi, and project information.")}
            </p>
          </div>
        </section>

        <section>
          <h2 style={{ margin: "0 0 12px", fontSize: "var(--text-body-lg)", color: "var(--text)" }}>
            {t("applicationInformation", "Application information")}
          </h2>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              background: "var(--bg-panel)",
              overflow: "hidden",
            }}
          >
            <AboutRow label={t("softwareVersion", "Software version")} value={`v${APP_VERSION}`} />
            <AboutRow label={t("piVersion", "Pi version")} value={`v${PI_VERSION}`} />
            <AboutRow label={t("author", "Author")} value={APP_AUTHOR} />
            <AboutRow
              label={t("officialWebsite", "Official website")}
              value={
                <button
                  type="button"
                  title={t("openOfficialWebsite", "Open official website")}
                  onClick={() => void window.piBridge.openExternal(APP_WEBSITE_URL)}
                  style={{
                    maxWidth: "100%",
                    padding: 0,
                    border: 0,
                    background: "none",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    cursor: "pointer",
                    overflowWrap: "anywhere",
                    textAlign: "right",
                  }}
                >
                  dexon.app ↗
                </button>
              }
            />
            <AboutRow
              label={t("githubRepository", "GitHub repository")}
              value={
                <button
                  type="button"
                  title={t("openGithubRepository", "Open GitHub repository")}
                  onClick={() => void window.piBridge.openExternal(APP_GITHUB_URL)}
                  style={{
                    maxWidth: "100%",
                    padding: 0,
                    border: 0,
                    background: "none",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    cursor: "pointer",
                    overflowWrap: "anywhere",
                    textAlign: "right",
                  }}
                >
                  github.com/oDaiSuno/dexon ↗
                </button>
              }
              last
            />
          </div>
        </section>

        <SoftwareUpdate onClose={onClose} />
      </div>
    </div>
  );
}

function AboutRow({ label, value, last = false }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        minHeight: 52,
        padding: "12px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        borderBottom: last ? "none" : "1px solid var(--border)",
      }}
    >
      <span style={{ flexShrink: 0, fontSize: "var(--text-body)", color: "var(--text-muted)" }}>{label}</span>
      <span
        style={{
          minWidth: 0,
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-label)",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
