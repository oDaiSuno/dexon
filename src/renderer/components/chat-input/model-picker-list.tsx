import type { CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { Badge } from "../form-controls";
import { ProviderIcon } from "../models/provider-icon";
import { BrainIcon, CheckmarkIcon, ImageIcon, PlugsConnectedIcon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";
import type { ModelGroup, ModelOption } from "./model-catalog";

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  height: 34,
  flexShrink: 0,
  border: "none",
  borderRadius: "var(--radius-control)",
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
  transition: `background ${QUICK}`,
};

function GroupHeader({ group, failed }: { group: ModelGroup; failed: boolean }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        flexShrink: 0,
        boxSizing: "border-box",
        padding: "4px 8px 0 8px",
      }}
    >
      <span style={{ display: "flex", flexShrink: 0 }}>
        {group.custom ? (
          <span style={{ display: "flex", color: "var(--fx-text-secondary)" }}>
            <PlugsConnectedIcon size={13} />
          </span>
        ) : (
          <ProviderIcon
            id={group.provider}
            size={13}
            color="var(--fx-text-body)"
            fallback={
              <span style={{ display: "flex", color: "var(--fx-text-secondary)" }}>
                <PlugsConnectedIcon size={13} />
              </span>
            }
          />
        )}
      </span>
      <span
        className="type-label-medium"
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--fx-text-tertiary)",
        }}
      >
        {group.name}
      </span>
      {failed && (
        <span role="alert" style={{ display: "flex", flexShrink: 0 }}>
          <Badge tone="warning">{t("modelRefreshFailedBadge", "Refresh failed")}</Badge>
        </span>
      )}
    </div>
  );
}

function ModelRow({
  option,
  isActive,
  onModelPick,
}: {
  option: ModelOption;
  isActive: boolean;
  onModelPick: (provider: string, modelId: string, isActive: boolean) => void;
}) {
  const { t } = useI18n();
  const rest = isActive ? "var(--fx-surface-selected)" : CLEAR;
  return (
    <button
      type="button"
      onClick={() => onModelPick(option.provider, option.modelId, isActive)}
      aria-current={isActive ? "true" : undefined}
      style={{
        ...ROW,
        padding: "0 10px 0 29px",
        background: rest,
        color: isActive ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
      }}
      onMouseEnter={(e) => !isActive && paint(e, HOVER)}
      onMouseLeave={(e) => paint(e, rest)}
    >
      <span
        className={option.name === option.modelId ? "type-mono-label" : "type-body-default"}
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {option.name}
      </span>
      {(option.image || option.reasoning) && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            color: "var(--fx-text-tertiary)",
          }}
        >
          {option.image && (
            <span role="img" aria-label={t("modelImageInput", "Image input")} style={{ display: "flex" }}>
              <ImageIcon size={13} strokeWidth={1.75} />
            </span>
          )}
          {option.reasoning && (
            <span role="img" aria-label={t("modelReasoning", "Reasoning")} style={{ display: "flex" }}>
              <BrainIcon size={13} strokeWidth={1.75} />
            </span>
          )}
        </span>
      )}
      <span style={{ display: "flex", width: 14, flexShrink: 0, color: "var(--fx-accent-blue-text)" }}>
        {isActive && <CheckmarkIcon size={14} strokeWidth={2.25} />}
      </span>
    </button>
  );
}

export function ModelGroupList({
  groups,
  model,
  failedProviders,
  onModelPick,
}: {
  groups: readonly ModelGroup[];
  model?: { provider: string; modelId: string } | null;
  failedProviders: ReadonlySet<string>;
  onModelPick: (provider: string, modelId: string, isActive: boolean) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div
          key={group.provider}
          role="group"
          aria-label={group.name}
          style={{ display: "flex", flexDirection: "column", gap: 1 }}
        >
          <GroupHeader group={group} failed={failedProviders.has(group.provider)} />
          {group.options.map((option) => (
            <ModelRow
              key={`${option.provider}:${option.modelId}`}
              option={option}
              isActive={option.modelId === model?.modelId && option.provider === model?.provider}
              onModelPick={onModelPick}
            />
          ))}
        </div>
      ))}
    </>
  );
}
