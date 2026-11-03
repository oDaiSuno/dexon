export const WATCH_OPS_SOURCE = String.raw`
WATCHES = {}
WATCH_LOCK = threading.Lock()


def _watch_loop(watch_id, path, interval_ms, cancelled):
    last_mtime = None
    while not cancelled.is_set():
        try:
            stat = os.stat(path)
            current_mtime = stat.st_mtime * 1000.0
            if last_mtime is not None and current_mtime != last_mtime:
                send(KIND_DATA, {"id": 0, "stream": "watch", "meta": {"watchId": watch_id, "event": "change", "path": path, "mtimeMs": current_mtime, "size": stat.st_size}}, b"")
            last_mtime = current_mtime
        except OSError:
            if last_mtime is not None:
                send(KIND_DATA, {"id": 0, "stream": "watch", "meta": {"watchId": watch_id, "event": "removed", "path": path}}, b"")
                break
        time.sleep(interval_ms / 1000.0)


@op("watchStart")
def op_watch_start(request):
    path = request.input.get("path")
    if not path:
        raise OpFailure("BAD_REQUEST", "path is required")
    require_absolute(path)
    interval = int(request.input.get("intervalMs") or 1000)
    watch_id = hashlib.sha256((path + str(time.time())).encode()).hexdigest()[:12]
    cancelled = threading.Event()
    ON_EXIT.append(lambda: cancelled.set())
    thread = threading.Thread(target=_watch_loop, args=(watch_id, path, interval, cancelled), daemon=True)
    with WATCH_LOCK:
        WATCHES[watch_id] = {"thread": thread, "cancelled": cancelled}
    thread.start()
    return {"watchId": watch_id}


@op("watchStop")
def op_watch_stop(request):
    watch_id = request.input.get("watchId")
    if not watch_id:
        raise OpFailure("BAD_REQUEST", "watchId is required")
    with WATCH_LOCK:
        entry = WATCHES.pop(watch_id, None)
    if entry:
        entry["cancelled"].set()
    return {"ok": True}
`;
