export const CORE_SOURCE = String.raw`
import sys, os, json, struct, threading, errno, stat, time, hashlib, subprocess, signal, shutil, io, tarfile, re, fnmatch, platform, tempfile, base64

PROTOCOL_VERSION = 1
KIND_REQUEST = 1
KIND_RESULT = 2
KIND_DATA = 3
KIND_FAILURE = 4
KIND_HEARTBEAT = 5
KIND_HELLO = 6
KIND_CANCEL = 7

IN = sys.stdin.buffer
OUT = sys.stdout.buffer
sys.stdout = sys.stderr

WRITE_LOCK = threading.Lock()
LIVE_LOCK = threading.Lock()
LIVE = {}
OPS = {}
ON_EXIT = []

OS_CODES = {
    errno.ENOENT: "ENOENT",
    errno.EACCES: "EACCES",
    errno.EPERM: "EACCES",
    errno.EEXIST: "EEXIST",
    errno.ENOTDIR: "ENOTDIR",
    errno.EISDIR: "EISDIR",
}


class OpFailure(Exception):
    def __init__(self, code, message):
        Exception.__init__(self, message)
        self.code = code
        self.message = message


class Request(object):
    def __init__(self, request_id, op, input_, cancelled):
        self.id = request_id
        self.op = op
        self.input = input_
        self.cancelled = cancelled

    def data(self, stream, payload=b"", meta=None):
        send(KIND_DATA, {"id": self.id, "stream": stream, "meta": meta or {}}, payload)

    def check_cancelled(self):
        if self.cancelled.is_set():
            raise OpFailure("CANCELLED", "Operation was cancelled")


def op(name):
    def register(function):
        OPS[name] = function
        return function
    return register


def send(kind, header, payload=b""):
    head = json.dumps(header, separators=(",", ":")).encode("utf-8")
    body = struct.pack(">BI", kind, len(head)) + head + payload
    with WRITE_LOCK:
        OUT.write(struct.pack(">I", len(body)) + body)
        OUT.flush()


def read_exact(count):
    chunks = []
    remaining = count
    while remaining:
        chunk = IN.read(remaining)
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def split_body(body):
    plain = {}
    blobs = []
    parts = []
    for name, value in body.items():
        if isinstance(value, (bytes, bytearray)):
            blobs.append({"name": name, "length": len(value)})
            parts.append(bytes(value))
        else:
            plain[name] = value
    return plain, blobs, b"".join(parts)


def parse_input(header, payload):
    input_ = dict(header.get("input") or {})
    offset = 0
    for ref in header.get("blobs") or []:
        length = int(ref["length"])
        input_[ref["name"]] = payload[offset:offset + length]
        offset += length
    return input_


def fail_from_exception(request_id, error):
    if isinstance(error, OpFailure):
        code, message = error.code, error.message
    elif isinstance(error, OSError):
        code, message = OS_CODES.get(error.errno, "INTERNAL"), str(error)
    else:
        code, message = "INTERNAL", "%s: %s" % (type(error).__name__, error)
    send(KIND_FAILURE, {"id": request_id, "code": code, "message": message})


def run_request(request):
    try:
        handler = OPS.get(request.op)
        if handler is None:
            raise OpFailure("BAD_REQUEST", "Unknown operation " + str(request.op))
        body = handler(request)
        plain, blobs, payload = split_body(body if body is not None else {})
        send(KIND_RESULT, {"id": request.id, "body": plain, "blobs": blobs}, payload)
    except BaseException as error:
        fail_from_exception(request.id, error)
    finally:
        with LIVE_LOCK:
            LIVE.pop(request.id, None)


def start_request(header, payload):
    request_id = int(header["id"])
    request = Request(request_id, header.get("op"), parse_input(header, payload), threading.Event())
    with LIVE_LOCK:
        LIVE[request_id] = request
    threading.Thread(target=run_request, args=(request,), daemon=True).start()


def cancel_request(header):
    with LIVE_LOCK:
        request = LIVE.get(int(header.get("id", -1)))
    if request is not None:
        request.cancelled.set()


def shutdown():
    for hook in list(ON_EXIT):
        try:
            hook()
        except BaseException:
            pass
    os._exit(0)


def canonical(path):
    return os.path.realpath(path)


def within(path, root):
    resolved_root = os.path.realpath(root)
    resolved = os.path.realpath(path)
    return resolved == resolved_root or resolved.startswith(resolved_root.rstrip("/") + "/")


def require_within(path, root):
    if root is not None and not within(path, root):
        raise OpFailure("OUTSIDE_ROOT", "Path escapes the workspace root: " + str(path))


def require_absolute(path):
    if not isinstance(path, str) or not path.startswith("/") or "\0" in path:
        raise OpFailure("BAD_REQUEST", "An absolute path is required")
    return path


def find_tool(name):
    found = shutil.which(name)
    return os.path.realpath(found) if found else None


def read_boot_id():
    try:
        with open("/proc/sys/kernel/random/boot_id") as handle:
            return handle.read().strip()
    except (IOError, OSError):
        pass
    try:
        output = subprocess.check_output(["sysctl", "-n", "kern.boottime"], stderr=subprocess.DEVNULL)
        return hashlib.sha256(output).hexdigest()[:32]
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def process_fingerprint(pid):
    try:
        with open("/proc/%d/stat" % pid) as handle:
            stat_line = handle.read()
        return "linux:" + stat_line[stat_line.rindex(")") + 2:].split()[19]
    except (IOError, OSError, ValueError, IndexError):
        pass
    try:
        output = subprocess.check_output(["ps", "-o", "lstart=", "-p", str(pid)], stderr=subprocess.DEVNULL)
        text = output.decode("utf-8", "replace").strip()
        return "ps:" + text if text else None
    except (OSError, subprocess.CalledProcessError):
        return None


def host_facts():
    system = sys.platform
    if system.startswith("linux"):
        kind = "linux"
    elif system == "darwin":
        kind = "darwin"
    else:
        raise OpFailure("BAD_REQUEST", "Unsupported server platform: " + system)
    shell = os.environ.get("SHELL")
    if not shell or not os.path.isabs(shell) or not os.access(shell, os.X_OK):
        shell = find_tool("bash") or "/bin/sh"
    tools = {}
    for name in ("rg", "fd", "git", "tar", "python3", "setsid", "realpath"):
        tools[name] = find_tool(name)
    if tools["fd"] is None:
        tools["fd"] = find_tool("fdfind")
    return {
        "platform": kind,
        "arch": platform.machine(),
        "remoteHome": os.path.realpath(os.path.expanduser("~")),
        "bootId": read_boot_id(),
        "shellPath": shell,
        "pythonVersion": platform.python_version(),
        "tools": tools,
    }


@op("hostFacts")
def op_host_facts(request):
    return host_facts()


@op("ping")
def op_ping(request):
    return {"ok": True, "time": time.time()}


def serve():
    send(KIND_HELLO, {"version": PROTOCOL_VERSION, "python": platform.python_version(), "pid": os.getpid()})
    while True:
        prefix = read_exact(4)
        if prefix is None:
            break
        body = read_exact(struct.unpack(">I", prefix)[0])
        if body is None:
            break
        kind, head_length = struct.unpack(">BI", body[:5])
        header = json.loads(body[5:5 + head_length].decode("utf-8"))
        payload = body[5 + head_length:]
        if kind == KIND_REQUEST:
            start_request(header, payload)
        elif kind == KIND_CANCEL:
            cancel_request(header)
    shutdown()
`;
