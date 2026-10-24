import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ChannelId } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { ChannelBrandMark } from "../channel-brand-mark";
import { PlusIcon } from "./channel-icons";

export interface AddAppActions {
  onConnectWeixin: () => void;
  onConnectTelegram: () => void;
  onConnectFeishu: () => void;
}

export function AddAppMenu({
  busy,
  onConnectWeixin,
  onConnectTelegram,
  onConnectFeishu,
}: AddAppActions & { busy: boolean }) {
  const { t } = useI18n();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const items: { channel: ChannelId; label: string; run: () => void }[] = [
    { channel: "weixin", label: t("connectWeixin", "Connect WeChat"), run: onConnectWeixin },
    { channel: "telegram", label: t("connectTelegram", "Connect Telegram"), run: onConnectTelegram },
    { channel: "feishu", label: t("connectFeishu", "Connect Feishu / Lark"), run: onConnectFeishu },
  ];

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = itemRefs.current.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      itemRefs.current[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      <Button
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <PlusIcon />
        {t("addChatApp", "Add chat app")}
      </Button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("addChatApp", "Add chat app")}
          className="composer-pop-in"
          onKeyDown={onMenuKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 20,
            minWidth: 200,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: 6,
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-menu)",
            background: "var(--fx-surface-raised)",
            boxShadow: "var(--shadow-popover)",
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.channel}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              className="ui-link-button type-body-default"
              onClick={() => {
                close();
                item.run();
              }}
              style={{
                gap: 10,
                height: 36,
                padding: "0 10px",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-primary)",
                textAlign: "start",
              }}
            >
              <ChannelBrandMark channel={item.channel} size={16} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
