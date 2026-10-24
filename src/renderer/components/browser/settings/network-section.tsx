import { useId, useState, type CSSProperties } from "react";
import { useI18n } from "@/i18n";
import type { BrowserNetworkIsolation } from "../../../../contract/browser";
import { BrowserIcon } from "../browser-icons";
import { SettingGroup } from "../../settings/setting-row";
import { ChoiceRow, useRovingRadio, type ChoiceOption } from "./choice-row";
import { ToggleRow, type BrowserSettingsModel } from "./shared";

export function NetworkSection({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { settings, update } = model;
  return (
    <SettingGroup title={t("browserNetworkSecurity", "Network security")}>
      <ToggleRow
        label={t("browserAllowHttp", "Allow plain HTTP")}
        description={t(
          "browserAllowHttpDescription",
          "Only HTTPS is allowed by default. Turn this on to open unencrypted sites.",
        )}
        checked={settings.navigation.allowHttp}
        onChange={(allowHttp) => void update({ navigation: { allowHttp } })}
      />
      <ToggleRow
        label={t("browserAllowPrivateNetwork", "Allow private network and localhost")}
        description={t("browserAllowPrivateNetworkDescription", "Turn on temporarily while developing local services.")}
        checked={settings.navigation.allowPrivateNetwork}
        onChange={(allowPrivateNetwork) => void update({ navigation: { allowPrivateNetwork } })}
      />
      <NetworkIsolationRow
        value={settings.navigation.networkIsolation}
        onChange={(networkIsolation) => void update({ navigation: { networkIsolation } })}
      />
    </SettingGroup>
  );
}

function NetworkIsolationRow({
  value,
  onChange,
}: {
  value: BrowserNetworkIsolation;
  onChange: (value: BrowserNetworkIsolation) => void;
}) {
  const { t } = useI18n();
  const strictReasonId = useId();
  const [strictAttempted, setStrictAttempted] = useState(false);
  const strictReason = t(
    "browserNetworkSummaryStrict",
    "Unavailable: strict mode requires an enforcing proxy or network sandbox.",
  );
  const options: ChoiceOption<BrowserNetworkIsolation>[] = [
    { value: "best-effort" },
    { value: "strict", disabled: value !== "strict" },
  ];
  const { onKeyDown, radioProps } = useRovingRadio(options, value, onChange);
  const label = t("browserNetworkIsolation", "Network isolation");
  return (
    <ChoiceRow
      label={label}
      description={
        value === "strict"
          ? strictReason
          : t(
              "browserNetworkSummaryBestEffort",
              "Best effort checks URLs, DNS preflight, redirects, and subresources, but can't fully rule out DNS rebinding.",
            )
      }
      layout="top"
      note={
        strictAttempted &&
        value !== "strict" && (
          <p role="status" className="type-label-default" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
            {strictReason}
          </p>
        )
      }
    >
      {({ labelId, descriptionId }) => (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onKeyDown={onKeyDown}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
            padding: 3,
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-segmented)",
            background: "var(--fx-surface-inset)",
          }}
        >
          <button
            {...radioProps(0)}
            className={`ui-segment-option ${value === "best-effort" ? "type-body-medium" : "type-body-default"}`}
            style={segmentStyle(value === "best-effort")}
            onClick={() => {
              setStrictAttempted(false);
              onChange("best-effort");
            }}
          >
            {t("browserNetworkBestEffort", "Best effort")}
          </button>
          <button
            {...radioProps(1)}
            className={`ui-segment-option ${value === "strict" ? "type-body-medium" : "type-body-default"}`}
            title={strictReason}
            aria-describedby={strictReasonId}
            style={{
              ...segmentStyle(value === "strict"),
              gap: 6,
              opacity: value === "strict" ? 1 : 0.45,
              cursor: value === "strict" ? "pointer" : "not-allowed",
            }}
            onClick={() => {
              if (value === "strict") onChange("strict");
              else setStrictAttempted(true);
            }}
          >
            <span style={{ color: "var(--fx-text-tertiary)" }}>
              <BrowserIcon name="lock" size={12} strokeWidth={2} />
            </span>
            {t("browserNetworkStrict", "Strict")}
            <span id={strictReasonId} className="sr-only">
              {strictReason}
            </span>
          </button>
        </div>
      )}
    </ChoiceRow>
  );
}

function segmentStyle(selected: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 28,
    padding: "0 12px",
    border: "none",
    borderRadius: "var(--radius-chip)",
    background: selected ? "var(--fx-surface-selected)" : "var(--fx-surface-hover-clear)",
    color: selected ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
    whiteSpace: "nowrap",
    transition: "background-color var(--duration-quick) var(--ease-smooth-out)",
  };
}
