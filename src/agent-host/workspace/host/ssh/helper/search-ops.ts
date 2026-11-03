export const SEARCH_OPS_SOURCE = String.raw`
SEARCH_TIMEOUT_SECONDS = 30
SEARCH_MAX_BYTES = 2 * 1024 * 1024


@op("search")
def op_search(request):
    kind = request.input.get("kind")
    cwd = request.input.get("cwd") or None
    if cwd is not None:
        require_absolute(cwd)
    if kind == "grep":
        argv = request.input.get("rgArgv") or []
        if not isinstance(argv, list) or not argv:
            raise OpFailure("BAD_REQUEST", "rgArgv is required for grep")
        max_bytes = int(request.input.get("maxBytes") or SEARCH_MAX_BYTES)
        rg = find_tool("rg")
        if rg is None:
            raise OpFailure("SEARCH_UNAVAILABLE", "ripgrep is not installed")
        full = [rg] + [str(arg) for arg in argv]
        try:
            process = subprocess.run(full, stdin=subprocess.DEVNULL, capture_output=True, timeout=SEARCH_TIMEOUT_SECONDS, cwd=cwd)
        except subprocess.TimeoutExpired:
            raise OpFailure("TIMEOUT", "ripgrep timed out")
        stdout = process.stdout[:max_bytes]
        return {"stdout": stdout, "truncated": len(process.stdout) > max_bytes, "exitCode": process.returncode}
    if kind == "find":
        search_path = request.input.get("searchPath") or None
        if not search_path:
            raise OpFailure("BAD_REQUEST", "searchPath is required for find")
        require_absolute(search_path)
        pattern = str(request.input.get("pattern") or "")
        limit = int(request.input.get("limit") or 100)
        fd = find_tool("fd") or find_tool("fdfind")
        if fd is not None:
            full = [fd, "--absolute-path", "--print0", "--exclude", ".git", "--exclude", "node_modules", "--max-results", str(limit), "--", pattern, search_path]
            try:
                process = subprocess.run(full, stdin=subprocess.DEVNULL, capture_output=True, timeout=SEARCH_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                raise OpFailure("TIMEOUT", "fd timed out")
            return {"stdout": process.stdout, "truncated": False, "exitCode": process.returncode}
        matches = []
        visited = 0
        for dirpath, dirnames, filenames in os.walk(search_path):
            dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
            for name in filenames + dirnames:
                visited += 1
                if visited > limit * 20:
                    break
                if pattern in name:
                    matches.append(os.path.join(dirpath, name))
                    if len(matches) >= limit:
                        return {"stdout": b"\0".join(m.encode() for m in matches), "truncated": False, "exitCode": 0}
        return {"stdout": b"\0".join(m.encode() for m in matches), "truncated": False, "exitCode": 0}
    raise OpFailure("BAD_REQUEST", "Unknown search kind: " + str(kind))


@op("fileIndex")
def op_file_index(request):
    root = request.input.get("root")
    if not root:
        raise OpFailure("BAD_REQUEST", "root is required")
    require_absolute(root)
    query = str(request.input.get("query") or "")
    limit = int(request.input.get("limit") or 300)
    fd = find_tool("fd") or find_tool("fdfind")
    if fd is not None:
        argv = [fd, "--absolute-path", "--print0", "--exclude", ".git", "--exclude", "node_modules", "--max-results", str(limit), "--", query, root]
        if query:
            argv.insert(-2, "--full-path")
        try:
            process = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=SEARCH_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            raise OpFailure("TIMEOUT", "fd timed out")
        paths = []
        for entry in process.stdout.split(b"\0"):
            if entry:
                paths.append({"path": entry.decode("utf-8", "replace"), "isDir": os.path.isdir(entry.decode("utf-8", "replace"))})
        return {"paths": paths, "truncated": False}
    matches = []
    visited = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        for name in filenames + dirnames:
            visited += 1
            if visited > limit * 20:
                break
            if not query or query in name:
                full = os.path.join(dirpath, name)
                matches.append({"path": full, "isDir": os.path.isdir(full)})
                if len(matches) >= limit:
                    return {"paths": matches, "truncated": True, "truncatedReason": "count"}
    return {"paths": matches[:limit], "truncated": len(matches) > limit, "truncatedReason": "count" if len(matches) > limit else None}
`;
