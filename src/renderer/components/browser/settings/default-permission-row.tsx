import { useI18n } from "@/i18n";
import type { BrowserPersistentDefaultPermission } from "../../../../contract/browser";
import { BrowserIcon, type BrowserIconName } from "../browser-icons";
import { ChoiceRow, useRovingRadio } from "./choice-row";

type PermissionCard = {
  value: BrowserPersistentDefaultPermission;
  icon: BrowserIconName;
  title: string;
  hint: string;
};

export function DefaultPermissionRow({
  value,
  onChange,
}: {
  value: BrowserPersistentDefaultPermission;
  onChange: (value: BrowserPersistentDefaultPermission) => void;
}) {
  const { t } = useI18n();
  const cards: PermissionCard[] = [
    {
      value: "ask",
      icon: "shield-question-mark",
      title: t("browserPermissionAsk", "Ask for each session"),
      hint: t("browserPermissionAskHint", "Recommended"),
    },
    {
      value: "read",
      icon: "eye",
      title: t("browserPermissionReadOnly", "Read only"),
      hint: t("browserPermissionReadOnlyHint", "Open, read, screenshot"),
    },
    {
      value: "interact",
      icon: "mouse-pointer-click",
      title: t("browserPermissionAllowInteractions", "Allow interactions"),
      hint: t("browserPermissionAllowInteractionsHint", "Click, type, scroll"),
    },
    {
      value: "deny",
      icon: "shield-x",
      title: t("browserPermissionDeny", "Always deny"),
      hint: t("browserPermissionDenyHint", "Never asks"),
    },
  ];
  const { onKeyDown, radioProps } = useRovingRadio(cards, value, onChange);
  return (
    <ChoiceRow
      label={t("browserDefaultPermanentPermission", "Default permanent permission")}
      description={t(
        "browserDefaultPermanentPermissionDescription",
        "What happens the first time a new session uses the Browser. Temporary grants only last while the session is running.",
      )}
      layout="stacked"
    >
      {({ labelId, descriptionId }) => (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onKeyDown={onKeyDown}
          style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(50px, 1fr))", gap: 8 }}
        >
          {cards.map((card, index) => {
            const selected = card.value === value;
            return (
              <button
                key={card.value}
                {...radioProps(index)}
                className="ui-choice-card"
                onClick={() => onChange(card.value)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 8,
                  minWidth: 0,
                  padding: 12,
                  border: `1px solid ${selected ? "var(--fx-accent-blue)" : "var(--fx-line-default)"}`,
                  borderRadius: "var(--radius-card)",
                  background: selected ? "var(--fx-accent-blue-soft)" : "var(--fx-surface-raised)",
                  textAlign: "start",
                  cursor: "pointer",
                }}
              >
                <span style={{ color: selected ? "var(--fx-accent-blue-text)" : "var(--fx-text-secondary)" }}>
                  <BrowserIcon name={card.icon} size={16} strokeWidth={1.75} />
                </span>
                <span
                  className="type-body-medium"
                  style={{ color: selected ? "var(--fx-text-primary)" : "var(--fx-text-body)" }}
                >
                  {card.title}
                </span>
                <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
                  {card.hint}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </ChoiceRow>
  );
}
