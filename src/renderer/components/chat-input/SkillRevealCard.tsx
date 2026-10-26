import { useI18n } from "@/i18n";
import { PackageIcon } from "./icons";

export function SkillRevealCard({
  name,
  description,
  filePath,
  onClose,
}: {
  name: string;
  description: string | null;
  filePath: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="composer-pop-in"
      role="dialog"
      aria-label={t("skillRevealTitle", "Skill details")}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-composer)",
        boxShadow: "var(--shadow-popover)",
        padding: "var(--space-3) 14px",
        transformOrigin: "bottom center",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--fx-accent-blue-text)", display: "flex" }}>
          <PackageIcon size={15} />
        </span>
        <span className="type-mono-label-strong" style={{ color: "var(--fx-accent-blue-text)" }}>
          {name}
        </span>
      </div>
      {description && (
        <div className="type-label-default" style={{ marginTop: 6, color: "var(--fx-text-tertiary)" }}>
          {description}
        </div>
      )}
      {filePath && (
        <div
          className="type-mono-meta"
          style={{
            marginTop: "var(--space-2)",
            color: "var(--fx-text-secondary)",
            wordBreak: "break-all",
          }}
        >
          {filePath}
        </div>
      )}
    </div>
  );
}
