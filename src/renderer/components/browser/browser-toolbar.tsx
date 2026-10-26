import { useEffect, useRef, type KeyboardEvent } from "react";
import { useI18n } from "@/i18n";
import { BrowserIcon } from "./browser-icons";
import { iconButtonStyle } from "./browser-tab-strip";
import type { BrowserProfileInfo, BrowserTabInfo } from "../../../contract/browser";

export function BrowserToolbar({
  activeTab,
  address,
  profiles,
  newTabProfileId,
  menuOpen,
  onAddressChange,
  onNavigate,
  onNewTabProfileChange,
  onMenuOpenChange,
  onError,
}: {
  activeTab: BrowserTabInfo | null;
  address: string;
  profiles: BrowserProfileInfo[];
  newTabProfileId: string;
  menuOpen: boolean;
  onAddressChange: (address: string) => void;
  onNavigate: () => void;
  onNewTabProfileChange: (profileId: string) => void;
  onMenuOpenChange: (open: boolean) => void;
  onError: (cause: unknown) => void;
}) {
  const { t } = useI18n();
  const shownProfileId = activeTab?.profileId ?? newTabProfileId;
  const shownProfile = profiles.find((profile) => profile.id === shownProfileId);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexShrink: 0,
        alignItems: "center",
        gap: 2,
        height: 44,
        padding: "0 var(--space-2)",
        borderBottom: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-sidebar)",
      }}
    >
      <button
        type="button"
        className="browser-icon-button"
        style={iconButtonStyle}
        disabled={!activeTab?.canGoBack}
        title={t("browserBack", "Back")}
        aria-label={t("browserBack", "Back")}
        onClick={() => activeTab && void window.piBridge.browserGoBack(activeTab.id).catch(onError)}
      >
        <BrowserIcon name="arrow-left" size={15} />
      </button>
      <button
        type="button"
        className="browser-icon-button"
        style={iconButtonStyle}
        disabled={!activeTab?.canGoForward}
        title={t("browserForward", "Forward")}
        aria-label={t("browserForward", "Forward")}
        onClick={() => activeTab && void window.piBridge.browserGoForward(activeTab.id).catch(onError)}
      >
        <BrowserIcon name="arrow-right" size={15} />
      </button>
      <button
        type="button"
        className="browser-icon-button"
        style={iconButtonStyle}
        disabled={!activeTab}
        title={activeTab?.loading ? t("browserStop", "Stop") : t("browserReload", "Reload")}
        aria-label={activeTab?.loading ? t("browserStop", "Stop") : t("browserReload", "Reload")}
        onClick={() =>
          activeTab &&
          void (
            activeTab.loading ? window.piBridge.browserStop(activeTab.id) : window.piBridge.browserReload(activeTab.id)
          ).catch(onError)
        }
      >
        <BrowserIcon name={activeTab?.loading ? "x" : "rotate-cw"} size={14} />
      </button>
      <AddressBar
        url={activeTab?.url ?? ""}
        address={address}
        profileName={shownProfile?.name ?? shownProfileId}
        onAddressChange={onAddressChange}
        onNavigate={onNavigate}
      />
      <BrowserMoreMenu
        activeTab={activeTab}
        profiles={profiles}
        newTabProfileId={newTabProfileId}
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        onNewTabProfileChange={onNewTabProfileChange}
        onError={onError}
      />
    </div>
  );
}

function AddressBar({
  url,
  address,
  profileName,
  onAddressChange,
  onNavigate,
}: {
  url: string;
  address: string;
  profileName: string;
  onAddressChange: (address: string) => void;
  onNavigate: () => void;
}) {
  const { t } = useI18n();
  const secure = url.startsWith("https:");
  const insecure = url.startsWith("http:");
  const display = address === url ? displayUrl(url) : null;
  return (
    <form
      className="browser-address"
      data-insecure={insecure}
      onSubmit={(event) => {
        event.preventDefault();
        onNavigate();
      }}
      style={{
        display: "flex",
        flex: 1,
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        height: 30,
        padding: "0 10px",
        borderRadius: "var(--radius-control)",
        background: "var(--fx-surface-raised)",
      }}
    >
      {secure && (
        <span style={{ color: "var(--fx-text-tertiary)" }}>
          <BrowserIcon name="lock" size={12} strokeWidth={2} />
        </span>
      )}
      {insecure && (
        <span
          role="img"
          aria-label={t("browserInsecureConnection", "Not secure")}
          title={t("browserInsecureConnection", "Not secure")}
          style={{ color: "var(--fx-status-warning)" }}
        >
          <BrowserIcon name="triangle-alert" size={12} strokeWidth={2} />
        </span>
      )}
      <span
        className="browser-address-field"
        data-formatted={display !== null}
        style={{ position: "relative", flex: 1, minWidth: 0, height: "100%" }}
      >
        <input
          aria-label={t("browserAddress", "Browser address")}
          className={`browser-address-input ${address ? "type-mono-label" : "type-body-large"}`}
          value={address}
          spellCheck={false}
          onChange={(event) => onAddressChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          placeholder={t("browserAddressPlaceholder", "Enter a URL or search")}
          style={{
            width: "100%",
            height: "100%",
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--fx-text-primary)",
          }}
        />
        {display && (
          <span
            aria-hidden="true"
            className="browser-address-display type-mono-label"
            style={{
              position: "absolute",
              top: "50%",
              right: 0,
              left: 0,
              overflow: "hidden",
              color: "var(--fx-text-tertiary)",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <span style={{ color: "var(--fx-text-primary)" }}>{display.host}</span>
            {display.rest}
          </span>
        )}
      </span>
      <span
        className="type-meta-default"
        title={t("browserTabProfile", "Profile used by this tab")}
        style={{
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          maxWidth: 96,
          height: 20,
          padding: "0 6px",
          overflow: "hidden",
          borderRadius: "var(--radius-xs)",
          background: "var(--fx-surface-inset)",
          color: "var(--fx-text-secondary)",
        }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {profileName}
        </span>
      </span>
    </form>
  );
}

function BrowserMoreMenu({
  activeTab,
  profiles,
  newTabProfileId,
  open,
  onOpenChange,
  onNewTabProfileChange,
  onError,
}: {
  activeTab: BrowserTabInfo | null;
  profiles: BrowserProfileInfo[];
  newTabProfileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewTabProfileChange: (profileId: string) => void;
  onError: (cause: unknown) => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role^='menuitem']:not(:disabled)")?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onOpenChange]);

  const close = () => {
    onOpenChange(false);
    triggerRef.current?.focus();
  };
  const run = (action: () => Promise<unknown>) => {
    close();
    void action().catch(onError);
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };
  const canOpenExternally = Boolean(activeTab && /^https?:/.test(activeTab.url));

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <button
        ref={triggerRef}
        type="button"
        className="browser-icon-button"
        style={iconButtonStyle}
        title={t("browserMoreActions", "More")}
        aria-label={t("browserMoreActions", "More")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <BrowserIcon name="ellipsis-vertical" size={14} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("browserMoreActions", "More")}
          className="session-menu-card browser-toolbar-menu composer-pop-in"
          onKeyDown={onMenuKeyDown}
        >
          <div className="session-menu-list">
            <MenuItem
              icon="upload"
              label={t("browserChooseUpload", "Choose files for focused upload input")}
              disabled={!activeTab}
              onSelect={() => activeTab && run(() => window.piBridge.browserChooseUploadFiles(activeTab.id))}
            />
            <MenuItem
              icon="external-link"
              label={t("browserOpenSystem", "Open in system browser")}
              disabled={!canOpenExternally}
              onSelect={() => activeTab && run(() => window.piBridge.openExternal(activeTab.url))}
            />
          </div>
          <div aria-hidden="true" className="session-menu-separator">
            <div />
          </div>
          <div
            role="group"
            aria-label={t("browserProfileForNewTabs", "Profile for new tabs")}
            className="session-menu-list"
          >
            <div
              aria-hidden="true"
              className="type-meta-default"
              style={{ padding: "var(--space-1) 10px", color: "var(--fx-text-tertiary)" }}
            >
              {t("browserProfileForNewTabs", "Profile for new tabs")}
            </div>
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="menuitemradio"
                aria-checked={profile.id === newTabProfileId}
                className="session-menu-item type-body-large"
                onClick={() => {
                  onNewTabProfileChange(profile.id);
                  close();
                }}
              >
                <span className="session-menu-item-label">{profile.name}</span>
                {profile.id === newTabProfileId && (
                  <span className="session-menu-item-icon">
                    <BrowserIcon name="check" size={15} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  disabled,
  onSelect,
}: {
  icon: "upload" | "external-link";
  label: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="session-menu-item type-body-large"
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="session-menu-item-icon">
        <BrowserIcon name={icon} size={15} />
      </span>
      <span className="session-menu-item-label">{label}</span>
    </button>
  );
}

function displayUrl(url: string): { host: string; rest: string } | null {
  if (!/^https?:\/\//.test(url)) return null;
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return { host: parsed.host, rest: path === "/" ? "" : path };
  } catch {
    return null;
  }
}
