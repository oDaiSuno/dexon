import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import { SLASH_SOURCE_GROUP_LABEL, type SlashCommandPaletteItem, type SlashCommandSource } from "./slash-commands";

export interface SlashCommandGroup {
  source: SlashCommandSource;
  items: { command: SlashCommandPaletteItem; index: number }[];
}

/** / command palette: grouped card grid above the composer. Structure and
 *  keyboard behaviour are owned by ChatInput; this is presentation only. */
export function SlashMenu({
  groups,
  loading,
  countLabel,
  activeIndex,
  itemRefs,
  onApply,
  onHover,
}: {
  groups: SlashCommandGroup[];
  loading?: boolean;
  countLabel: string;
  activeIndex: number;
  itemRefs: { current: (HTMLButtonElement | null)[] };
  onApply: (command: SlashCommandPaletteItem) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useI18n();
  const isLoading = loading === true;
  const isEmpty = !isLoading && groups.every((group) => group.items.length === 0);
  return (
    <div
      className="composer-pop-in"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        transformOrigin: "bottom center",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
        overflow: "hidden",
        maxHeight: 300,
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: scaledChatFont(11),
          color: "var(--text-dim)",
        }}
      >
        <span>
          {isLoading
            ? t("loadingCommands", "Loading commands…")
            : t("slashCommandsWithCount", "Slash commands · {count}").replace("{count}", countLabel)}
        </span>
        <span style={{ fontFamily: "var(--font-mono)" }}>Tab / Enter</span>
      </div>
      <div style={{ maxHeight: "calc(300px - 34px)", overflowY: "auto", padding: 12 }}>
        {isEmpty ? (
          <div style={{ padding: "2px 2px 4px", fontSize: scaledChatFont(12), color: "var(--text-dim)" }}>
            {t("noSlashCommandsFound", "No extension, prompt, or skill commands found")}
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.source} style={{ marginBottom: 12 }}>
              <div
                style={{
                  position: "sticky",
                  top: -10,
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "4px 0 8px",
                  background: "var(--bg)",
                  color: "var(--text-dim)",
                  fontSize: scaledChatFont(10),
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                <span>{SLASH_SOURCE_GROUP_LABEL[group.source]}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{group.items.length}</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                {group.items.map(({ command, index }) => {
                  const active = index === activeIndex;
                  return (
                    <button
                      key={`${command.source}:${command.name}`}
                      ref={(node) => {
                        itemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onApply(command);
                      }}
                      onMouseEnter={() => onHover(index)}
                      style={{
                        width: "100%",
                        minWidth: 0,
                        minHeight: 58,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        justifyContent: "center",
                        padding: "8px 12px",
                        border: "none",
                        borderRadius: "var(--radius-control)",
                        background: active ? "var(--bg-selected)" : "transparent",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: scaledChatFont(13),
                          fontFamily: "var(--font-mono)",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                      >
                        /{command.name}
                      </span>
                      {command.description && (
                        <span
                          style={{
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 2,
                            overflow: "hidden",
                            fontSize: scaledChatFont(11),
                            lineHeight: 1.35,
                            color: "var(--text-dim)",
                          }}
                        >
                          {command.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
