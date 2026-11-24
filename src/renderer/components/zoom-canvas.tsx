import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import {
  createViewport,
  inspectViewport,
  transitionViewport,
  type ViewportAction,
  type ViewportBookmark,
} from "@/lib/zoom-viewport";

export type ZoomScene =
  | Readonly<{ kind: "pending"; content: ReactNode; feedback: ReactNode }>
  | Readonly<{ kind: "ready"; width: number; height: number; content: ReactNode }>
  | Readonly<{ kind: "failed"; feedback: ReactNode }>;

export type ZoomCanvasProps = Readonly<{
  scene: ZoomScene;
  label: string;
  className?: string;
  memoryKey?: string;
  header?: (controls: ReactNode) => ReactNode;
}>;

const memories = new Map<string, ViewportBookmark>();

function createRuntime(memoryKey?: string) {
  let viewport = createViewport(memoryKey ? memories.get(memoryKey) : undefined);
  let projection = inspectViewport(viewport);
  const listeners = new Set<() => void>();
  return {
    snapshot: () => projection,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(action: ViewportAction, user = false) {
      const next = transitionViewport(viewport, action);
      if (next === viewport) return;
      viewport = next;
      projection = inspectViewport(viewport);
      if (user && memoryKey && projection.phase === "ready") {
        memories.delete(memoryKey);
        memories.set(memoryKey, projection.bookmark);
        if (memories.size > 256) memories.delete(memories.keys().next().value!);
      }
      for (const listener of listeners) listener();
    },
  };
}

function ZoomSession({ scene, label, className, memoryKey, header }: ZoomCanvasProps): ReactNode {
  const { language, t } = useI18n();
  const [runtime] = useState(() => createRuntime(memoryKey));
  const projection = useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  const stageRef = useRef<HTMLDivElement>(null);
  const measured = useRef({ width: 0, height: 0 });
  const width = scene.kind === "ready" ? scene.width : 0;
  const height = scene.kind === "ready" ? scene.height : 0;

  useLayoutEffect(() => {
    runtime.dispatch(scene.kind === "ready" ? { type: "content-ready", width, height } : { type: "content-pending" });
  }, [runtime, scene.kind, width, height]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      measured.current = { width: stage.clientWidth, height: stage.clientHeight };
      runtime.dispatch({ type: "measure", ...measured.current });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [runtime]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let candidate: { pointerId: number; at: { x: number; y: number }; active: boolean } | null = null;
    let suppressDoubleUntil = 0;
    const point = (event: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      const size = measured.current;
      if (rect.width <= 0 || rect.height <= 0 || size.width <= 0 || size.height <= 0) return null;
      return {
        x: ((event.clientX - rect.left) * size.width) / rect.width,
        y: ((event.clientY - rect.top) * size.height) / rect.height,
      };
    };
    const finish = (cancel = false, user = true) => {
      const previous = candidate;
      candidate = null;
      if (!previous) return;
      runtime.dispatch(cancel ? { type: "cancel" } : { type: "pan-end", pointerId: previous.pointerId }, user);
      if (stage.hasPointerCapture(previous.pointerId)) stage.releasePointerCapture(previous.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      if (event.deltaY === 0) return;
      const at = point(event);
      if (!at) return;
      finish(true);
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? measured.current.height : 1;
      const delta = Math.max(-160, Math.min(160, event.deltaY * factor));
      runtime.dispatch({ type: "zoom", at, logDelta: -delta * (event.ctrlKey ? 0.01 : 0.0022) }, true);
    };
    const down = (event: PointerEvent) => {
      const p = runtime.snapshot();
      if (!event.isPrimary || event.button !== 0 || candidate || p.phase !== "ready" || !p.canPan) return;
      if (event.target instanceof Element && event.target.closest("a,button,input,textarea,select,[contenteditable]"))
        return;
      const at = point(event);
      if (at) candidate = { pointerId: event.pointerId, at, active: false };
    };
    const move = (event: PointerEvent) => {
      if (!candidate || candidate.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1)) {
        finish(true);
        return;
      }
      const at = point(event);
      if (!at) return;
      if (!candidate.active) {
        if (Math.hypot(at.x - candidate.at.x, at.y - candidate.at.y) < 3) return;
        candidate.active = true;
        suppressDoubleUntil = Date.now() + 500;
        runtime.dispatch({ type: "pan-start", pointerId: event.pointerId, at: candidate.at }, true);
        try {
          stage.setPointerCapture(event.pointerId);
        } catch {
          finish(true);
          return;
        }
      }
      event.preventDefault();
      runtime.dispatch({ type: "pan-move", pointerId: event.pointerId, at }, true);
    };
    const up = (event: PointerEvent) => {
      if (candidate?.pointerId === event.pointerId) finish();
    };
    const cancel = () => finish(true);
    const double = (event: MouseEvent) => {
      if (Date.now() < suppressDoubleUntil) return;
      const at = point(event);
      if (at) runtime.dispatch({ type: "toggle-actual", at }, true);
    };
    const preventDrag = (event: DragEvent) => event.preventDefault();
    stage.addEventListener("wheel", wheel, { passive: false });
    stage.addEventListener("pointerdown", down);
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", cancel);
    stage.addEventListener("lostpointercapture", cancel);
    stage.addEventListener("dblclick", double);
    stage.addEventListener("dragstart", preventDrag);
    window.addEventListener("blur", cancel);
    return () => {
      finish(true, false);
      stage.removeEventListener("wheel", wheel, false);
      stage.removeEventListener("pointerdown", down);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
      stage.removeEventListener("pointercancel", cancel);
      stage.removeEventListener("lostpointercapture", cancel);
      stage.removeEventListener("dblclick", double);
      stage.removeEventListener("dragstart", preventDrag);
      window.removeEventListener("blur", cancel);
    };
  }, [runtime]);

  const ready = projection.phase === "ready";
  const outLabel = t("zoomOut", "Zoom out");
  const fitLabel = t("zoomResetFit", "Reset to fit");
  const inLabel = t("zoomIn", "Zoom in");
  const controls = (
    <div className="zoom-canvas__controls" role="group" aria-label={t("zoomControls", "Zoom controls")}>
      <button
        type="button"
        className="zoom-canvas__step"
        aria-label={outLabel}
        title={outLabel}
        disabled={!ready || !projection.canZoomOut}
        onClick={() => runtime.dispatch({ type: "step", direction: -1 }, true)}
      >
        −
      </button>
      <button
        type="button"
        className="zoom-canvas__reset type-mono-meta"
        aria-label={fitLabel}
        title={fitLabel}
        disabled={!ready}
        onClick={() => runtime.dispatch({ type: "fit" }, true)}
      >
        {ready
          ? new Intl.NumberFormat(language, { style: "percent", maximumSignificantDigits: 3 }).format(projection.scale)
          : "—"}
      </button>
      <button
        type="button"
        className="zoom-canvas__step"
        aria-label={inLabel}
        title={inLabel}
        disabled={!ready || !projection.canZoomIn}
        onClick={() => runtime.dispatch({ type: "step", direction: 1 }, true)}
      >
        +
      </button>
    </div>
  );
  return (
    <div className={["zoom-canvas", className].filter(Boolean).join(" ")}>
      {header ? header(controls) : <div className="zoom-canvas__toolbar">{controls}</div>}
      <div
        ref={stageRef}
        className="zoom-canvas__stage"
        role="region"
        aria-label={label}
        data-pannable={ready && projection.canPan}
        data-dragging={ready && projection.dragging}
      >
        <div
          className="zoom-canvas__content"
          data-hidden={!ready || scene.kind !== "ready"}
          style={
            ready
              ? {
                  width: projection.content.width,
                  height: projection.content.height,
                  transform: `translate(${projection.translate.x}px, ${projection.translate.y}px) scale(${projection.scale})`,
                }
              : undefined
          }
        >
          {scene.kind !== "failed" ? scene.content : null}
        </div>
        {scene.kind !== "ready" && <div className="zoom-canvas__feedback">{scene.feedback}</div>}
      </div>
    </div>
  );
}

export function ZoomCanvas(props: ZoomCanvasProps): ReactNode {
  return <ZoomSession key={props.memoryKey ?? ""} {...props} />;
}
