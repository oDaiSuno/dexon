import { useId, useState } from "react";
import { useI18n } from "@/i18n";
import { isAutoSessionTitleEnabled, setAutoSessionTitleEnabled } from "../../lib/auto-session-title";
import { Badge, Toggle } from "../form-controls";
import { SettingRow, toggleHitAreaStyle } from "../settings/setting-row";

export function SessionNamingGroup() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(() => isAutoSessionTitleEnabled());
  const controlId = useId();

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
          {t("sessionNamingGroup", "Session naming")}
        </h2>
        <Badge tone="accent">{"AI"}</Badge>
      </div>
      <div
        style={{
          display: "grid",
          background: "var(--fx-surface-raised)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          overflow: "hidden",
        }}
      >
        <SettingRow
          label={t("autoSessionTitle", "Auto-name new sessions")}
          description={t(
            "sessionNamingAutoDescription",
            "After the first reply finishes, reads the conversation and replaces the “New session” placeholder name.",
          )}
          controlId={controlId}
          divider={false}
        >
          <label htmlFor={controlId} style={{ ...toggleHitAreaStyle, cursor: "pointer" }}>
            <Toggle
              id={controlId}
              checked={enabled}
              onChange={(event) => {
                const next = event.target.checked;
                setEnabled(next);
                setAutoSessionTitleEnabled(next);
              }}
            />
          </label>
        </SettingRow>
      </div>
    </section>
  );
}
