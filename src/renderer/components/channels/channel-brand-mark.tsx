import type { ChannelId } from "@shared/channel-types";
import { channelAccent } from "./channels-config/channel-labels";

export type ChannelBrandMarkSize = 14 | 16 | 22 | 30 | 36 | 40;

const MARK_GEOMETRY: Record<ChannelBrandMarkSize, { radius: string; glyph: number }> = {
  14: { radius: "var(--radius-brand-xs)", glyph: 9 },
  16: { radius: "var(--radius-brand-xs)", glyph: 11 },
  22: { radius: "var(--radius-brand-sm)", glyph: 13 },
  30: { radius: "var(--radius-brand-md)", glyph: 17 },
  36: { radius: "var(--radius-brand-lg)", glyph: 18 },
  40: { radius: "var(--radius-brand-xl)", glyph: 20 },
};

const CHANNEL_GLYPHS: Record<ChannelId, string> = {
  weixin:
    "M144,140a12,12,0,1,1-12-12A12,12,0,0,1,144,140Zm44-12a12,12,0,1,0,12,12A12,12,0,0,0,188,128Zm51.34,83.47a16,16,0,0,1-19.87,19.87l-24.71-7.27A80,80,0,0,1,86.43,183.42a79,79,0,0,1-25.19-7.35l-24.71,7.27a16,16,0,0,1-19.87-19.87l7.27-24.71A80,80,0,1,1,169.58,72.59a80,80,0,0,1,62.49,114.17ZM81.3,166.3a79.94,79.94,0,0,1,70.38-93.87A64,64,0,0,0,39.55,134.19a8,8,0,0,1,.63,6L32,168l27.76-8.17a8,8,0,0,1,6,.63A63.45,63.45,0,0,0,81.3,166.3Zm135.15,15.89a64,64,0,1,0-26.26,26.26,8,8,0,0,1,6-.63L224,216l-8.17-27.76A8,8,0,0,1,216.45,182.19Z",
  telegram:
    "M228.88,26.19a9,9,0,0,0-9.16-1.57L17.06,103.93a14.22,14.22,0,0,0,2.43,27.21L72,141.45V200a15.92,15.92,0,0,0,10,14.83,15.91,15.91,0,0,0,17.51-3.73l25.32-26.26L165,220a15.88,15.88,0,0,0,10.51,4,16.3,16.3,0,0,0,5-.79,15.85,15.85,0,0,0,10.67-11.63L231.77,35A9,9,0,0,0,228.88,26.19Zm-61.14,36L78.15,126.35l-49.6-9.73ZM88,200V152.52l24.79,21.74Zm87.53,8L92.85,135.5l119-85.29Z",
  feishu:
    "M176,68a12,12,0,1,1-12-12A12,12,0,0,1,176,68Zm64,12a8,8,0,0,1-3.56,6.66L216,100.28V120A104.11,104.11,0,0,1,112,224H24a16,16,0,0,1-12.49-26l.1-.12L96,96.63V76.89C96,43.47,122.79,16.16,155.71,16H156a60,60,0,0,1,57.21,41.86l23.23,15.48A8,8,0,0,1,240,80Zm-22.42,0L201.9,69.54a8,8,0,0,1-3.31-4.64A44,44,0,0,0,156,32h-.22C131.64,32.12,112,52.25,112,76.89V99.52a8,8,0,0,1-1.85,5.13L24,208h26.9l70.94-85.12a8,8,0,1,1,12.29,10.24L71.75,208H112a88.1,88.1,0,0,0,88-88V96a8,8,0,0,1,3.56-6.66Z",
};

export function ChannelBrandMark({ channel, size }: { channel: ChannelId; size: ChannelBrandMarkSize }) {
  const { radius, glyph } = MARK_GEOMETRY[size];
  return (
    <span
      aria-hidden="true"
      data-channel-brand={channel}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius,
        background: channelAccent(channel),
        color: "var(--fx-channel-on-brand)",
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
        <path d={CHANNEL_GLYPHS[channel]} />
      </svg>
    </span>
  );
}
