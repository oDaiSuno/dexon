export const EXEC_OPS_SOURCE = String.raw`
EXEC_KILL_GRACE_SECONDS = 2.0
KILL_SIGNAL = getattr(signal, "SIGKILL", signal.SIGTERM)


def exec_signal_group(process, signum):
    try:
        if hasattr(os, "killpg"):
            os.killpg(process.pid, signum)
        else:
            process.kill()
    except (ProcessLookupError, PermissionError, OSError):
        pass


def exec_pump(request, stream_name, pipe):
    while True:
        chunk = pipe.read1(65536) if hasattr(pipe, "read1") else pipe.read(65536)
        if not chunk:
            break
        request.data(stream_name, chunk)


@op("exec")
def op_exec(request):
    argv = request.input.get("argv")
    if not isinstance(argv, list) or not argv or not all(isinstance(item, str) for item in argv):
        raise OpFailure("BAD_REQUEST", "exec requires a non-empty argv list")
    cwd = request.input.get("cwd") or None
    if cwd is not None and not os.path.isdir(cwd):
        raise OpFailure("ENOENT", "Working directory does not exist: " + str(cwd))
    environment = dict(os.environ)
    for name, value in (request.input.get("env") or {}).items():
        environment[str(name)] = str(value)
    stdin_bytes = request.input.get("stdin")
    timeout = request.input.get("timeoutMs")
    try:
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            env=environment,
            stdin=subprocess.PIPE if stdin_bytes is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except FileNotFoundError:
        raise OpFailure("ENOENT", "Executable not found: " + argv[0])
    except PermissionError:
        raise OpFailure("EACCES", "Executable is not permitted: " + argv[0])
    handle = lambda: exec_signal_group(process, KILL_SIGNAL)
    ON_EXIT.append(handle)
    pumps = [
        threading.Thread(target=exec_pump, args=(request, "stdout", process.stdout), daemon=True),
        threading.Thread(target=exec_pump, args=(request, "stderr", process.stderr), daemon=True),
    ]
    for pump in pumps:
        pump.start()
    if stdin_bytes is not None:
        try:
            process.stdin.write(stdin_bytes)
            process.stdin.close()
        except (BrokenPipeError, OSError):
            pass
    deadline = time.time() + timeout / 1000.0 if timeout else None
    timed_out = False
    cancelled = False
    terminated_at = None
    while process.poll() is None:
        now = time.time()
        if request.cancelled.is_set() and not cancelled:
            cancelled = True
            terminated_at = now
            exec_signal_group(process, signal.SIGTERM)
        if deadline is not None and now >= deadline and not timed_out and not cancelled:
            timed_out = True
            terminated_at = now
            exec_signal_group(process, signal.SIGTERM)
        if terminated_at is not None and now - terminated_at >= EXEC_KILL_GRACE_SECONDS:
            exec_signal_group(process, KILL_SIGNAL)
        time.sleep(0.02)
    for pump in pumps:
        pump.join(2.0)
    exec_signal_group(process, KILL_SIGNAL)
    if handle in ON_EXIT:
        ON_EXIT.remove(handle)
    code = process.returncode
    if cancelled:
        raise OpFailure("CANCELLED", "Operation was cancelled")
    return {
        "exitCode": code if code is not None and code >= 0 else None,
        "signal": signal.Signals(-code).name if code is not None and code < 0 and hasattr(signal, "Signals") else None,
        "timedOut": timed_out,
    }
`;
