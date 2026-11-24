declare const viewportBrand: unique symbol;
declare const bookmarkBrand: unique symbol;

export type Viewport = Readonly<{ [viewportBrand]: true }>;
export type ViewportBookmark = Readonly<{ [bookmarkBrand]: true }>;
type InputPoint = Readonly<{ x: number; y: number }>;
type Extent = Readonly<{ width: number; height: number }>;
type Bookmark =
  Readonly<{ mode: "fit" }> | Readonly<{ mode: "manual"; scale: number; focus: InputPoint; basis: Extent }>;
type Drag = Readonly<{ pointerId: number; last: InputPoint }>;
type Data =
  | Readonly<{ phase: "awaiting-content"; container: Extent | null; bookmark: Bookmark }>
  | Readonly<{ phase: "suspended"; content: Extent; bookmark: Bookmark }>
  | Readonly<{ phase: "ready"; container: Extent; content: Extent; bookmark: Bookmark; drag: Drag | null }>;

export type ViewportAction =
  | Readonly<{ type: "measure"; width: number; height: number }>
  | Readonly<{ type: "content-pending" }>
  | Readonly<{ type: "content-ready"; width: number; height: number }>
  | Readonly<{ type: "zoom"; at: InputPoint; logDelta: number }>
  | Readonly<{ type: "step"; direction: -1 | 1 }>
  | Readonly<{ type: "fit" }>
  | Readonly<{ type: "toggle-actual"; at: InputPoint }>
  | Readonly<{ type: "pan-start"; pointerId: number; at: InputPoint }>
  | Readonly<{ type: "pan-move"; pointerId: number; at: InputPoint }>
  | Readonly<{ type: "pan-end"; pointerId: number }>
  | Readonly<{ type: "cancel" }>;
export type ViewportProjection =
  | Readonly<{ phase: "unavailable"; bookmark: ViewportBookmark }>
  | Readonly<{
      phase: "ready";
      mode: "fit" | "manual";
      scale: number;
      translate: InputPoint;
      content: Extent;
      canPan: boolean;
      canZoomIn: boolean;
      canZoomOut: boolean;
      dragging: boolean;
      bookmark: ViewportBookmark;
    }>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const validExtent = (value: Extent) =>
  Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0;
const validPoint = (value: InputPoint) => Number.isFinite(value.x) && Number.isFinite(value.y);
const sameExtent = (a: Extent, b: Extent) => a.width === b.width && a.height === b.height;
const fitScale = (container: Extent, content: Extent) =>
  Math.min(1, Math.max(1, container.width - 32) / content.width, Math.max(1, container.height - 32) / content.height);
const axis = (size: number, scaled: number, raw: number) =>
  scaled <= size ? (size - scaled) / 2 : clamp(raw, size - scaled, 0);

function project(data: Data): ViewportProjection {
  const bookmark = data.bookmark as unknown as ViewportBookmark;
  if (data.phase !== "ready") return { phase: "unavailable", bookmark };
  const { container, content } = data;
  const fit = fitScale(container, content);
  const scale = data.bookmark.mode === "fit" ? fit : clamp(data.bookmark.scale, Math.min(fit, 0.05), 16);
  const focus = data.bookmark.mode === "fit" ? { x: 0.5, y: 0.5 } : data.bookmark.focus;
  return {
    phase: "ready",
    mode: data.bookmark.mode,
    scale,
    translate: {
      x: axis(container.width, scale * content.width, container.width / 2 - scale * content.width * focus.x),
      y: axis(container.height, scale * content.height, container.height / 2 - scale * content.height * focus.y),
    },
    content,
    canPan: scale * content.width > container.width || scale * content.height > container.height,
    canZoomIn: scale < 16,
    canZoomOut: scale > Math.min(fit, 0.05),
    dragging: data.drag !== null,
    bookmark,
  };
}

function positioned(data: Extract<Data, { phase: "ready" }>, scale: number, translate: InputPoint): Data {
  const { container, content } = data;
  const x = axis(container.width, scale * content.width, translate.x);
  const y = axis(container.height, scale * content.height, translate.y);
  return {
    ...data,
    bookmark: {
      mode: "manual",
      scale,
      basis: content,
      focus: {
        x: (container.width / 2 - x) / (scale * content.width),
        y: (container.height / 2 - y) / (scale * content.height),
      },
    },
  };
}

function zoomTo(data: Extract<Data, { phase: "ready" }>, scale: number, at: InputPoint): Data {
  const p = project(data);
  if (p.phase !== "ready" || p.scale === scale) return data;
  return {
    ...positioned(data, scale, {
      x: at.x - ((at.x - p.translate.x) / p.scale) * scale,
      y: at.y - ((at.y - p.translate.y) / p.scale) * scale,
    }),
    drag: null,
  } as Data;
}

function rebase(bookmark: Bookmark, content: Extent): Bookmark {
  if (bookmark.mode === "fit" || sameExtent(bookmark.basis, content)) return bookmark;
  const previous = bookmark.basis.width / bookmark.basis.height;
  const next = content.width / content.height;
  if (Math.abs(previous - next) / Math.max(previous, next) > 0.05) return { mode: "fit" };
  return { ...bookmark, scale: (bookmark.scale * bookmark.basis.width) / content.width, basis: content };
}

function transition(data: Data, action: ViewportAction): Data {
  if (action.type === "measure") {
    if (!validExtent(action)) {
      if (data.phase === "suspended" || (data.phase === "awaiting-content" && data.container === null)) return data;
      return data.phase === "ready"
        ? { phase: "suspended", content: data.content, bookmark: data.bookmark }
        : { ...data, container: null };
    }
    const container = { width: action.width, height: action.height };
    if (data.phase !== "suspended" && data.container && sameExtent(data.container, container)) return data;
    return data.phase === "awaiting-content"
      ? { ...data, container }
      : { ...data, phase: "ready", container, drag: null };
  }
  if (action.type === "content-pending" || (action.type === "content-ready" && !validExtent(action))) {
    if (data.phase === "awaiting-content") return data;
    return {
      phase: "awaiting-content",
      container: data.phase === "ready" ? data.container : null,
      bookmark: data.bookmark,
    };
  }
  if (action.type === "content-ready") {
    const content = { width: action.width, height: action.height };
    if (data.phase !== "awaiting-content" && sameExtent(data.content, content)) return data;
    const container = data.phase === "suspended" ? null : data.container;
    const bookmark = rebase(data.bookmark, content);
    return container
      ? { phase: "ready", container, content, bookmark, drag: null }
      : { phase: "suspended", content, bookmark };
  }
  if (data.phase !== "ready") return data;
  if (action.type === "fit")
    return data.bookmark.mode === "fit" ? data : { ...data, bookmark: { mode: "fit" }, drag: null };
  if (action.type === "toggle-actual") {
    if (!validPoint(action.at)) return data;
    if (data.bookmark.mode === "manual") return { ...data, bookmark: { mode: "fit" }, drag: null };
    return zoomTo(data, fitScale(data.container, data.content) < 1 ? 1 : 2, action.at);
  }
  if (action.type === "cancel" || action.type === "pan-end") {
    return data.drag && (action.type === "cancel" || action.pointerId === data.drag.pointerId)
      ? { ...data, drag: null }
      : data;
  }
  if (action.type === "pan-start") {
    const p = project(data);
    return !data.drag && validPoint(action.at) && Number.isFinite(action.pointerId) && p.phase === "ready" && p.canPan
      ? { ...data, drag: { pointerId: action.pointerId, last: action.at } }
      : data;
  }
  if (action.type === "pan-move") {
    if (!data.drag || data.drag.pointerId !== action.pointerId || !validPoint(action.at)) return data;
    const p = project(data);
    if (p.phase !== "ready") return data;
    return {
      ...positioned(data, p.scale, {
        x: p.translate.x + action.at.x - data.drag.last.x,
        y: p.translate.y + action.at.y - data.drag.last.y,
      }),
      drag: { pointerId: action.pointerId, last: action.at },
    } as Data;
  }
  if (action.type === "step") {
    const p = project(data);
    if (p.phase !== "ready") return data;
    const fit = fitScale(data.container, data.content);
    const stops = [
      fit,
      ...[0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16].filter((s) => Math.abs(s / fit - 1) > 0.005),
    ]
      .filter((s) => s >= Math.min(fit, 0.05) && s <= 16)
      .sort((a, b) => a - b);
    const scale =
      action.direction === 1 ? stops.find((s) => s > p.scale * 1.005) : stops.findLast((s) => s < p.scale / 1.005);
    if (scale === undefined) return data;
    if (scale === fit) return { ...data, bookmark: { mode: "fit" }, drag: null };
    return zoomTo(data, scale, { x: data.container.width / 2, y: data.container.height / 2 });
  }
  if (action.type === "zoom") {
    if (!validPoint(action.at) || !Number.isFinite(action.logDelta) || action.logDelta === 0) return data;
    const p = project(data);
    if (p.phase !== "ready") return data;
    const scale = clamp(
      p.scale * Math.exp(clamp(action.logDelta, -Math.log(4), Math.log(4))),
      Math.min(fitScale(data.container, data.content), 0.05),
      16,
    );
    return zoomTo(data, scale, action.at);
  }
  return data;
}

export function createViewport(bookmark?: ViewportBookmark): Viewport {
  return {
    phase: "awaiting-content",
    container: null,
    bookmark: bookmark ? (bookmark as unknown as Bookmark) : { mode: "fit" },
  } as unknown as Viewport;
}

export function transitionViewport(viewport: Viewport, action: ViewportAction): Viewport {
  return transition(viewport as unknown as Data, action) as unknown as Viewport;
}

export function inspectViewport(viewport: Viewport): ViewportProjection {
  return project(viewport as unknown as Data);
}
