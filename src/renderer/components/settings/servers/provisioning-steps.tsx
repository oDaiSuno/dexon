import type { ConnectionPresentation } from "@/lib/connection-presentation";
import { useI18n } from "@/i18n";

export function ProvisioningSteps({ presentation }: { presentation: ConnectionPresentation }) {
  const { t } = useI18n();
  const currentStep = presentation.step;
  if (currentStep === null) return null;
  const labels = [
    t("serversStepAuthentication", "Verify passwordless login"),
    t("serversStepRuntime", "Check remote Node.js version"),
    t("serversStepDeploy", "Upload and deploy remote service"),
    t("serversStepDaemon", "Start daemon"),
  ];
  return (
    <div
      aria-label={t("serversProvisioning", "Remote service setup")}
      style={{
        display: "grid",
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        border: "1px solid var(--fx-accent-blue-border)",
        borderRadius: "var(--radius-control)",
        background: "var(--fx-surface-raised)",
      }}
    >
      <ol
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", listStyle: "none", padding: 0, margin: 0 }}
      >
        {labels.map((label, index) => {
          const step = index + 1;
          const done = step < currentStep;
          const current = step === currentStep;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className="type-label-default"
              style={{
                padding: "var(--space-1) var(--space-2)",
                borderRadius: "var(--radius-chip)",
                border: done
                  ? "1px solid var(--fx-status-success-border)"
                  : current
                    ? "1px solid var(--fx-accent-blue)"
                    : "1px solid var(--fx-line-default)",
                background: done
                  ? "var(--fx-status-success-soft)"
                  : current
                    ? "var(--fx-accent-blue-soft)"
                    : "var(--fx-surface-inset)",
                color: done
                  ? "var(--fx-status-success-text)"
                  : current
                    ? "var(--fx-accent-blue-text)"
                    : "var(--fx-text-tertiary)",
              }}
            >
              {done ? "✓" : step} {label}
              {current && step === 3 && presentation.progress !== null
                ? ` (${Math.round(presentation.progress * 100)}%)`
                : ""}
            </li>
          );
        })}
      </ol>
      {currentStep === 3 && (
        <div
          role="progressbar"
          aria-label={t("serversUploadProgress", "Remote service upload progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={presentation.progress === null ? undefined : Math.round(presentation.progress * 100)}
          style={{
            width: "100%",
            height: 4,
            background: "var(--fx-surface-track)",
            borderRadius: "var(--radius-bar)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${(presentation.progress ?? 0) * 100}%`,
              height: "100%",
              background: "var(--fx-accent-blue)",
            }}
          />
        </div>
      )}
    </div>
  );
}
