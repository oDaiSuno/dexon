import type { MouseEvent, ReactNode } from "react";
import type { PublicToolchainOperation, ToolCapabilityId } from "@shared/toolchains/types";
import { CategoryMark } from "./icons";
import {
  CAPABILITY_GLYPHS,
  formatBytes,
  friendlyErrorCode,
  operationPhase,
  type ToolCategoryId,
  type ToolTone,
  type Translate,
  toneColor,
  toneTextColor,
} from "./shared";

const CAPABILITY_MARKS: Partial<Record<ToolCapabilityId, ToolCategoryId>> = {
  "js.node": "javascript",
  "python.interpreter": "python",
  "shell.bash": "cli",
};

export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%", minHeight: 32 }}>
      <h2 className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

export function LogoTile({
  category,
  capability,
  size,
}: {
  category?: ToolCategoryId;
  capability?: ToolCapabilityId;
  size: "small" | "large";
}) {
  const mark = category ?? (capability ? CAPABILITY_MARKS[capability] : undefined);
  const large = size === "large";
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: large ? 40 : 28,
        height: large ? 40 : 28,
        border: "1px solid var(--fx-line-default)",
        borderRadius: large ? "var(--radius-card)" : "var(--radius-control)",
        background: "var(--fx-surface-card)",
        color: "var(--fx-text-body)",
      }}
    >
      {mark ? (
        <CategoryMark category={mark} size={large ? 20 : 14} />
      ) : (
        <span className="type-mono-body">{capability ? CAPABILITY_GLYPHS[capability] : ""}</span>
      )}
    </span>
  );
}

export function StatusDot({ tone }: { tone: ToolTone }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: 6,
        height: 6,
        borderRadius: 3,
        background: toneColor(tone),
      }}
    />
  );
}

export function Notice({ tone, children }: { tone: "danger" | "warning"; children: ReactNode }) {
  return (
    <p role="alert" className="type-label-default" style={{ margin: 0, color: toneTextColor(tone) }}>
      {children}
    </p>
  );
}

export function OperationProgress({ operation, t }: { operation: PublicToolchainOperation; t: Translate }) {
  const percent =
    operation.totalBytes && operation.downloadedBytes !== undefined
      ? Math.min(100, Math.max(0, (operation.downloadedBytes / operation.totalBytes) * 100))
      : undefined;
  return (
    <div style={{ display: "grid", gap: "var(--space-1)", width: "100%" }}>
      <div
        className="type-label-medium"
        style={{ color: operation.error ? "var(--fx-status-danger-text)" : "var(--fx-text-secondary)" }}
      >
        {operationPhase(operation.phase, t)}
      </div>
      {percent !== undefined && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          style={{
            height: 4,
            borderRadius: 2,
            overflow: "hidden",
            background: "var(--fx-surface-track)",
          }}
        >
          <div style={{ width: `${percent}%`, height: "100%", background: "var(--fx-accent-blue)" }} />
        </div>
      )}
      {operation.totalBytes !== undefined && (
        <div className="type-mono-label" style={{ color: "var(--fx-text-tertiary)" }}>
          {formatBytes(operation.downloadedBytes, t)} / {formatBytes(operation.totalBytes, t)}
        </div>
      )}
      {operation.error && (
        <div role="alert" className="type-label-default" style={{ color: "var(--fx-status-danger-text)" }}>
          {friendlyErrorCode(operation.error.code, t)}
        </div>
      )}
    </div>
  );
}

export function hoverFill(rest: string) {
  return {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      if (!(event.currentTarget as HTMLButtonElement).disabled)
        event.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      event.currentTarget.style.background = rest;
    },
  };
}
