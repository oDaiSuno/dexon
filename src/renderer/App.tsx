import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppShell } from "@/components/AppShell";
import { ensureRpc, resetRpc } from "@/lib/api-client";
import { useChatAppearance } from "@/hooks/useChatAppearance";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[dexon] render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={centerStyle}>
          <div style={cardStyle}>
            <h1 style={titleStyle}>UI crashed</h1>
            <p style={bodyStyle}>{this.state.error.message}</p>
            <pre style={preStyle}>{this.state.error.stack}</pre>
            <button type="button" onClick={() => window.location.reload()} style={btnPrimary}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const chatAppearance = useChatAppearance();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Connecting…");
  const cancelledRef = useRef(false);

  const connect = useCallback(() => {
    ensureRpc()
      .then(() => {
        if (!cancelledRef.current) {
          setReady(true);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setReady(false);
        }
      });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    setStatus(window.piBridge ? "Waiting for Agent Host…" : "piBridge missing (preload failed?)");

    connect();

    const offRestart = window.piBridge?.onHostRestarted?.((payload) => {
      console.warn("[dexon] host restarted:", payload.reason);
      resetRpc();
      setReady(false);
      setStatus("Agent Host restarted — reconnecting…");
      setError(null);
      connect();
    });

    const offCrash = window.piBridge?.onHostCrashed?.((payload) => {
      resetRpc();
      setReady(false);
      setError(payload.detail || "Agent Host crashed and could not recover");
    });

    const offMenuDiag = window.piBridge?.onMenu?.("export-diagnostics", () => {
      void window.piBridge?.exportDiagnostics?.();
    });

    // Clear dock badge when user focuses the app
    const onFocus = () => window.piBridge?.clearBadge?.();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelledRef.current = true;
      offRestart?.();
      offCrash?.();
      offMenuDiag?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [connect]);

  const retry = useCallback(async () => {
    try {
      await window.piBridge?.restartHost?.();
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (cancelledRef.current) return;
    setError(null);
    setStatus("Waiting for Agent Host…");
    connect();
  }, [connect]);

  if (error) {
    return (
      <div style={centerStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Cannot connect to Agent Host</h1>
          <p style={bodyStyle}>{error}</p>
          <p style={{ ...bodyStyle, fontSize: "var(--text-label)" }}>
            Host must be running (utilityProcess). Check logs if this persists.
          </p>
          <button type="button" onClick={() => void retry()} style={btnPrimary}>
            Retry
          </button>
          <button type="button" onClick={() => void window.piBridge?.openLogs()} style={btnSecondary}>
            Open logs
          </button>
        </div>
      </div>
    );
  }

  if (!ready || !chatAppearance.loaded) {
    return (
      <div style={centerStyle}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: "var(--text-body)", color: "var(--fx-text-secondary)", marginBottom: 8 }}>
            {status}
          </div>
          <div style={{ fontSize: "var(--text-label)", color: "var(--fx-text-tertiary)" }}>Dexon</div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AppShell
        chatAppearance={chatAppearance.preferences}
        chatAppearanceSaving={chatAppearance.saving}
        onChatAppearanceChange={chatAppearance.update}
      />
    </ErrorBoundary>
  );
}

const centerStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 32,
  background: "var(--fx-surface-main)",
  color: "var(--fx-text-primary)",
  fontFamily: "var(--font-sans)",
};

const cardStyle: CSSProperties = {
  maxWidth: 520,
  background: "var(--fx-surface-raised)",
  border: "1px solid var(--fx-line-default)",
  borderRadius: 12,
  padding: "28px 32px",
};

const titleStyle: CSSProperties = {
  fontSize: "var(--text-heading-lg)",
  margin: "0 0 12px",
  fontFamily: "var(--font-mono)",
};

const bodyStyle: CSSProperties = {
  fontSize: "var(--text-body)",
  lineHeight: 1.55,
  color: "var(--fx-text-secondary)",
  margin: "0 0 8px",
};

const preStyle: CSSProperties = {
  fontSize: "var(--text-meta)",
  overflow: "auto",
  maxHeight: 200,
  background: "var(--fx-surface-inset)",
  color: "var(--fx-text-body)",
  border: "1px solid var(--fx-line-default)",
  fontFamily: "var(--font-mono)",
  padding: 12,
  borderRadius: "var(--radius-card)",
};

const btnPrimary: CSSProperties = {
  marginTop: 16,
  padding: "8px 16px",
  borderRadius: "var(--radius-card)",
  border: "1px solid var(--fx-line-default)",
  background: "var(--fx-surface-card)",
  color: "var(--fx-text-primary)",
  cursor: "pointer",
};

const btnSecondary: CSSProperties = {
  ...btnPrimary,
  marginLeft: 8,
  background: "var(--fx-surface-raised)",
  color: "var(--fx-text-primary)",
};
