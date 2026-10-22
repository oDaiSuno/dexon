import { useI18n } from "@/i18n";
import { pluginScopeLabel, type PluginScope } from "./plugin-shared";

export function ScopeTag({ scope }: { scope: PluginScope }) {
  const { t } = useI18n();
  return (
    <span
      style={{
        fontSize: "var(--text-micro)",
        padding: "1px 4px",
        borderRadius: "var(--radius-chip)",
        flexShrink: 0,
        background: scope === "project" ? "rgba(99,102,241,0.12)" : "rgba(120,120,120,0.12)",
        color: scope === "project" ? "rgba(99,102,241,0.85)" : "var(--fx-text-tertiary)",
      }}
    >
      {pluginScopeLabel(scope, t)}
    </span>
  );
}

export function PluginToggle({
  enabled,
  loading,
  onToggle,
  label,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: "var(--radius-pill)",
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--fx-accent-blue)" : "var(--fx-line-default)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
        opacity: loading ? 0.65 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--fx-surface-main)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

export function SegmentedScope({ value, onChange }: { value: PluginScope; onChange: (scope: PluginScope) => void }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        height: 30,
      }}
    >
      {(["global", "project"] as PluginScope[]).map((scope) => {
        const active = value === scope;
        return (
          <button
            key={scope}
            onClick={() => onChange(scope)}
            style={{
              width: 76,
              border: "none",
              borderRight: scope === "global" ? "1px solid var(--fx-line-default)" : "none",
              background: active ? "var(--bg-selected)" : "none",
              color: active ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              cursor: "pointer",
              fontSize: "var(--text-label)",
            }}
          >
            {pluginScopeLabel(scope, t)}
          </button>
        );
      })}
    </div>
  );
}
