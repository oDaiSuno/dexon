export const FS_OPS_SOURCE = String.raw`
MIRROR_MAX_RESOURCE_BYTES = 8 * 1024 * 1024
IGNORED_DIRS = {"node_modules", ".git", "__pycache__", ".next", "dist", "build", "target", "vendor", ".turbo", ".cache"}


def _mime_sniff(path):
    SIGNATURES = [
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"RIFF", "image/webp"),
    ]
    try:
        with open(path, "rb") as handle:
            header = handle.read(12)
        for sig, mime in SIGNATURES:
            if header[:len(sig)] == sig:
                return mime
        try:
            header.decode("utf-8")
            return "text"
        except UnicodeDecodeError:
            return "binary"
    except OSError:
        return "binary"


@op("read")
def op_read(request):
    candidates = request.input.get("candidates") or []
    if not candidates:
        raise OpFailure("BAD_REQUEST", "candidates list is required")
    max_bytes = int(request.input.get("maxBytes") or (10 * 1024 * 1024))
    path = None
    for candidate in candidates:
        if isinstance(candidate, str) and os.path.isfile(candidate):
            path = candidate
            break
    if path is None:
        raise OpFailure("ENOENT", "None of the candidate paths exists")
    stat = os.stat(path)
    mime = _mime_sniff(path)
    writable = os.access(path, os.W_OK)
    with open(path, "rb") as handle:
        raw = handle.read(max_bytes + 1)
    truncated = len(raw) > max_bytes
    if truncated:
        raw = raw[:max_bytes]
    return {
        "matchedPath": os.path.realpath(path),
        "size": stat.st_size,
        "mtimeMs": stat.st_mtime * 1000.0,
        "writable": writable,
        "mimeSniff": mime,
        "bytes": raw,
        "truncated": truncated,
    }


@op("writeAtomic")
def op_write_atomic(request):
    path = require_absolute(str(request.input.get("path") or ""))
    within_root = request.input.get("withinRoot") or None
    if within_root is not None:
        require_within(path, within_root)
    raw = request.input.get("bytes")
    if not isinstance(raw, bytes):
        raise OpFailure("BAD_REQUEST", "bytes payload is required")
    if request.input.get("mkdirp"):
        os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
    temp = path + ".dxtmp." + str(os.getpid())
    try:
        with open(temp, "wb") as handle:
            handle.write(raw)
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise
    stat = os.stat(path)
    return {"canonicalPath": os.path.realpath(path), "size": stat.st_size, "mtimeMs": stat.st_mtime * 1000.0}


@op("listDir")
def op_list_dir(request):
    path = require_absolute(str(request.input.get("path") or ""))
    within_root = request.input.get("withinRoot") or None
    if within_root is not None:
        require_within(path, within_root)
    ignore = set(request.input.get("ignore") or [])
    if not os.path.isdir(path):
        raise OpFailure("ENOTDIR", "Path is not a directory: " + path)
    entries = []
    for name in os.listdir(path):
        if name in ignore:
            continue
        full = os.path.join(path, name)
        try:
            stat = os.lstat(full)
            is_dir = os.path.isdir(full)
            entries.append({
                "name": name,
                "type": "directory" if is_dir else "file",
                "size": stat.st_size,
                "mtimeMs": stat.st_mtime * 1000.0,
                "isSymlink": os.path.islink(full),
            })
        except OSError:
            pass
    return {"canonicalPath": os.path.realpath(path), "entries": entries}


@op("fileMeta")
def op_file_meta(request):
    path = require_absolute(str(request.input.get("path") or ""))
    within_root = request.input.get("withinRoot") or None
    if within_root is not None:
        require_within(path, within_root)
    if not os.path.exists(path):
        raise OpFailure("ENOENT", "Path not found: " + path)
    stat = os.stat(path)
    is_dir = os.path.isdir(path)
    return {
        "canonicalPath": os.path.realpath(path),
        "size": stat.st_size,
        "mtime": stat.st_mtime * 1000.0,
        "isDirectory": is_dir,
    }
`;
