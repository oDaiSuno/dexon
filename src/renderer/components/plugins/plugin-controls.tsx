import { useI18n } from "@/i18n";
import { Toggle } from "../form-controls";
import { scopeText } from "../resources/overview-model";
import { pluginScopeLabel, type PluginScope } from "./plugin-shared";

export function ScopeTag({ scope }: { scope: PluginScope }) {
  const { t } = useI18n();
  return <span className="type-label-default shrink-0 text-[var(--fx-text-tertiary)]">{scopeText(scope, t)}</span>;
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
    <Toggle
      checked={enabled}
      aria-checked={enabled}
      disabled={loading}
      onChange={onToggle}
      title={label}
      aria-label={label}
    />
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
            className={active ? "type-label-medium" : "type-label-default"}
            style={{
              width: 76,
              border: "none",
              borderRight: scope === "global" ? "1px solid var(--fx-line-default)" : "none",
              background: active ? "var(--fx-surface-selected)" : "none",
              color: active ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              cursor: "pointer",
            }}
          >
            {pluginScopeLabel(scope, t)}
          </button>
        );
      })}
    </div>
  );
}
