export const PROBE_OPS_SOURCE = String.raw`
AGENTS_FILE_NAMES = ("AGENTS.md", "CLAUDE.md")


def _git_head_branch(directory):
    head = os.path.join(directory, ".git", "HEAD")
    try:
        with open(head) as handle:
            content = handle.read().strip()
        if content.startswith("ref: refs/heads/"):
            return content[len("ref: refs/heads/"):]
        return None
    except OSError:
        return None


def _sort_entries(root, entries):
    ranked = []
    for name in entries:
        full = os.path.join(root, name)
        is_git = os.path.isdir(os.path.join(full, ".git"))
        try:
            mtime = os.stat(full).st_mtime
        except OSError:
            mtime = 0.0
        ranked.append((0 if is_git else 1, -mtime, name, full, is_git))
    ranked.sort(key=lambda item: (item[0], item[1], item[2]))
    result = []
    for _, _, name, full, is_git in ranked:
        entry = {"name": name, "path": full, "isGitRepo": is_git, "mtimeMs": 0.0}
        if is_git:
            branch = _git_head_branch(full)
            if branch:
                entry["gitBranch"] = branch
        try:
            entry["mtimeMs"] = os.stat(full).st_mtime * 1000.0
        except OSError:
            pass
        result.append(entry)
    return result


@op("browseDir")
def op_browse_dir(request):
    path = request.input.get("path") or None
    home = os.path.realpath(os.path.expanduser("~"))
    if path is None:
        path = home
    else:
        require_absolute(path)
    if not os.path.isdir(path):
        raise OpFailure("ENOENT", "Directory not found: " + path)
    dirs = []
    try:
        for name in os.listdir(path):
            if name.startswith("."):
                continue
            full = os.path.join(path, name)
            if os.path.isdir(full):
                dirs.append(name)
    except PermissionError as error:
        raise OpFailure("EACCES", str(error))
    entries = _sort_entries(path, dirs)
    return {"currentPath": os.path.realpath(path), "remoteHome": home, "entries": entries}


def _walk_agents_files(start, boundary):
    found = []
    current = os.path.realpath(start)
    boundary_real = os.path.realpath(boundary)
    while True:
        for name in AGENTS_FILE_NAMES:
            candidate = os.path.join(current, name)
            if os.path.isfile(candidate):
                found.append(candidate)
        if current == boundary_real:
            break
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return found


def _find_skill_roots(start, boundary):
    roots = []
    for base in (start, boundary):
        for sub in (".pi/skills", ".agents/skills"):
            full = os.path.join(base, sub)
            if os.path.isdir(full):
                roots.append(full)
    return list(dict.fromkeys(roots))


def _build_resource_tar(agents_files, skill_roots, settings_file):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in agents_files:
            if os.path.isfile(path):
                tar.add(path, arcname=os.path.basename(path))
        for root in skill_roots:
            if os.path.isdir(root):
                tar.add(root, arcname=root.lstrip("/"))
        if settings_file and os.path.isfile(settings_file):
            tar.add(settings_file, arcname="project-settings.json")
    return buf.getvalue()


def _scrub_settings(path):
    BLOCKED = ("shellPath", "commandPrefix", "packages", "extensions")
    try:
        import json as _json
        with open(path) as handle:
            data = _json.load(handle)
        if not isinstance(data, dict):
            return None
        for key in BLOCKED:
            data.pop(key, None)
        temp = path + ".dxtmp." + str(os.getpid())
        with open(temp, "w") as handle:
            _json.dump(data, handle, separators=(",", ":"))
        os.replace(temp, path)
        return path
    except (OSError, ValueError):
        return None


@op("probeAndMirror")
def op_probe_and_mirror(request):
    root_raw = request.input.get("root")
    if not root_raw or not isinstance(root_raw, str):
        raise OpFailure("BAD_REQUEST", "root is required")
    require_absolute(root_raw)
    create_if_missing = bool(request.input.get("createIfMissing"))
    if not os.path.exists(root_raw):
        if not create_if_missing:
            return {"exists": False, "isDirectory": False, "canonicalRoot": root_raw, "gitRoot": None, "boundaryPath": root_raw, "ancestorBoundary": "remote-home", "facts": host_facts(), "agentsMdPaths": [], "skillRoots": [], "resourceTarGz": b""}
        os.makedirs(root_raw, mode=0o755, exist_ok=True)
    canonical = os.path.realpath(root_raw)
    if not os.path.isdir(canonical):
        return {"exists": True, "isDirectory": False, "canonicalRoot": canonical, "gitRoot": None, "boundaryPath": canonical, "ancestorBoundary": "remote-home", "facts": host_facts(), "agentsMdPaths": [], "skillRoots": [], "resourceTarGz": b""}
    git_root = None
    try:
        result = subprocess.run(["git", "-C", canonical, "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            git_root = result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    home = os.path.realpath(os.path.expanduser("~"))
    if git_root:
        boundary = git_root
        ancestor_boundary = "git-root"
    else:
        boundary = home
        ancestor_boundary = "remote-home"
    agents_files = _walk_agents_files(canonical, boundary)
    skill_roots = _find_skill_roots(canonical, boundary)
    settings_file = None
    for sub in (".pi/settings.json",):
        candidate = os.path.join(canonical, sub)
        if os.path.isfile(candidate):
            settings_file = _scrub_settings(candidate)
            break
    tar_bytes = _build_resource_tar(agents_files, skill_roots, settings_file)
    if len(tar_bytes) > MIRROR_MAX_RESOURCE_BYTES:
        tar_bytes = b""
    return {
        "exists": True,
        "isDirectory": True,
        "canonicalRoot": canonical,
        "gitRoot": git_root,
        "boundaryPath": boundary,
        "ancestorBoundary": ancestor_boundary,
        "facts": host_facts(),
        "agentsMdPaths": agents_files,
        "skillRoots": skill_roots,
        "resourceTarGz": tar_bytes,
    }
`;
