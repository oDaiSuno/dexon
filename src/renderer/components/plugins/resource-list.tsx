import { useI18n } from "@/i18n";
import type { PluginPackageInfo } from "@/lib/api-types";

export function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const groups = (
    [
      ["extension", t("pluginExtensions", "Extensions")],
      ["skill", t("skills", "Skills")],
      ["prompt", t("pluginPrompts", "Prompts")],
      ["theme", t("pluginThemes", "Themes")],
    ] as const
  )
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: "var(--text-label)", color: "var(--fx-text-tertiary)" }}>
        {pkg.disabled
          ? t("pluginPackageDisabled", "Package disabled")
          : t("pluginNoResolvedResources", "No resolved resources")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.kind}
          style={{
            borderTop: groupIndex === 0 ? "none" : "1px solid var(--fx-line-default)",
            paddingTop: groupIndex === 0 ? 0 : 12,
          }}
        >
          <div
            style={{
              fontSize: "var(--text-micro)",
              fontWeight: 700,
              color: "var(--fx-text-tertiary)",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {group.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {group.resources.map((resource) => (
              <div key={`${resource.kind}:${resource.path}`} style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "var(--text-label)",
                    color: "var(--fx-text-primary)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={resource.path}
                >
                  {resource.name}
                </div>
                <div
                  style={{
                    fontSize: "var(--text-micro)",
                    color: "var(--fx-text-tertiary)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 1,
                  }}
                  title={resource.path}
                >
                  {resource.relativePath}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
