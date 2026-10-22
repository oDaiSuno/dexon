import { useI18n } from "@/i18n";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

function thinkingLevelLabel(level: ThinkingLevel, t: (key: string, fallback: string) => string): string {
  switch (level) {
    case "off":
      return t("thinkingOff", "Off");
    case "minimal":
      return t("thinkingMinimal", "Minimal");
    case "low":
      return t("thinkingLow", "Low");
    case "medium":
      return t("thinkingMedium", "Medium");
    case "high":
      return t("thinkingHigh", "High");
    case "xhigh":
      return t("thinkingXHigh", "Extra high");
    case "max":
      return t("thinkingMax", "Max");
  }
}

const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off: "var(--fx-text-tertiary)",
  minimal: "var(--heat-1)",
  low: "var(--fx-status-warning)",
  medium: "var(--heat-3)",
  high: "var(--heat-4)",
  xhigh: "var(--heat-5)",
  max: "var(--heat-6)",
};

export function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const { t } = useI18n();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" = !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const color = LEVEL_COLORS[level];

        const btnBase: React.CSSProperties = {
          minHeight: 32,
          padding: "0 12px",
          fontSize: "var(--text-label)",
          border: "none",
          cursor: "pointer",
          fontWeight: 400,
          transition: "background 0.1s, color 0.1s",
          whiteSpace: "nowrap",
          background: "var(--fx-surface-raised)",
          color: "var(--fx-text-tertiary)",
        };
        const btnActive: React.CSSProperties = {
          background: "var(--fx-accent-blue)",
          color: "var(--fx-text-on-accent)",
          fontWeight: 600,
        };
        const btnActiveDisabled: React.CSSProperties = {
          background: "var(--fx-status-danger-soft)",
          color: "var(--fx-status-danger)",
          boxShadow: "inset 0 0 0 1px var(--fx-status-danger-border)",
          fontWeight: 600,
        };

        return (
          <div
            key={level}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 4px",
              borderRadius: "var(--radius-control)",
              background: "transparent",
              border: "1px solid transparent",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4, width: 68, flexShrink: 0 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                  opacity: state === "null" ? 0.3 : 1,
                }}
              />
              <span
                style={{
                  fontSize: "var(--text-meta)",
                  fontFamily: "var(--font-mono)",
                  color: state === "null" ? "var(--fx-text-tertiary)" : "var(--fx-text-secondary)",
                  textDecoration: state === "null" ? "line-through" : "none",
                }}
              >
                {thinkingLevelLabel(level, t)}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--fx-line-default)",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setLevel(level, "omit")}
                style={{ ...btnBase, ...(state === "omit" ? btnActive : {}) }}
              >
                {t("modelDefault", "Default")}
              </button>
              <button
                onClick={() => setLevel(level, null)}
                style={{
                  ...btnBase,
                  borderLeft: "1px solid var(--fx-line-default)",
                  ...(state === "null" ? btnActiveDisabled : {}),
                }}
              >
                {t("modelDisabled", "Disabled")}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                borderRadius: "var(--radius-control)",
                border: `1px solid ${state === "string" ? "var(--fx-accent-blue)" : "var(--fx-line-default)"}`,
                overflow: "hidden",
                transition: "border-color 0.1s",
              }}
            >
              <button
                onClick={() => setLevel(level, strVal || level)}
                style={{
                  ...btnBase,
                  ...(state === "string" ? btnActive : {}),
                  borderRight: "1px solid var(--fx-line-default)",
                  flexShrink: 0,
                }}
              >
                {t("modelCustom", "Custom")}
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => {
                  if (state !== "string") setLevel(level, strVal || level);
                }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: state === "string" ? "var(--fx-surface-main)" : "var(--fx-surface-raised)",
                  border: "none",
                  outline: "none",
                  color: state === "string" ? "var(--fx-text-primary)" : "var(--fx-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-meta)",
                  padding: "4px 8px",
                  transition: "background 0.1s, color 0.1s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
