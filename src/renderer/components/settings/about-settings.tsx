import { AboutHero } from "./about-hero";
import { SoftwareUpdate } from "./software-update";
import { useSoftwareUpdate } from "./use-software-update";

export function AboutSettings({ onClose }: { onClose: () => void }) {
  const update = useSoftwareUpdate();

  return (
    <div style={{ width: "100%", overflowY: "auto", padding: "var(--space-6) var(--space-6) var(--space-10)" }}>
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "var(--space-8)",
        }}
      >
        <AboutHero update={update} />
        <SoftwareUpdate update={update} onClose={onClose} />
      </div>
    </div>
  );
}
