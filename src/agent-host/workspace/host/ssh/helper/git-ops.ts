export const GIT_OPS_SOURCE = String.raw`
GIT_TIMEOUT_SECONDS = 15
GIT_MAX_BUFFER = 20 * 1024 * 1024


def _git_run(argv, cwd, timeout=GIT_TIMEOUT_SECONDS):
    full = ["git", "-C", cwd] + argv
    try:
        process = subprocess.run(full, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise OpFailure("TIMEOUT", "git timed out")
    return process


@op("gitExec")
def op_git_exec(request):
    cwd = request.input.get("cwd")
    if not cwd:
        raise OpFailure("BAD_REQUEST", "cwd is required")
    require_absolute(cwd)
    argv = request.input.get("gitArgv") or []
    if not isinstance(argv, list) or not argv:
        raise OpFailure("BAD_REQUEST", "gitArgv is required")
    timeout = int(request.input.get("timeoutMs") or (GIT_TIMEOUT_SECONDS * 1000)) / 1000.0
    process = _git_run([str(a) for a in argv], cwd, timeout=timeout)
    return {"exitCode": process.returncode, "stdout": process.stdout[:GIT_MAX_BUFFER], "stderr": process.stderr[:GIT_MAX_BUFFER]}


@op("gitSnapshot")
def op_git_snapshot(request):
    cwd = request.input.get("cwd")
    if not cwd:
        raise OpFailure("BAD_REQUEST", "cwd is required")
    require_absolute(cwd)
    check = _git_run(["rev-parse", "--is-inside-work-tree"], cwd)
    if check.returncode != 0:
        return {"isGitRepo": False, "projectRoot": cwd, "currentBranch": None, "statusPorcelainV1Z": b"", "aheadBehind": None, "branches": [], "worktrees": []}
    toplevel = _git_run(["rev-parse", "--show-toplevel"], cwd).stdout.decode("utf-8").strip()
    branch = _git_run(["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.decode("utf-8").strip()
    if branch == "HEAD":
        branch = None
    status = _git_run(["status", "--porcelain=v1", "-z", "--untracked-files=normal"], cwd).stdout
    ahead_behind = None
    ab = _git_run(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd)
    if ab.returncode == 0:
        parts = ab.stdout.decode("utf-8").split()
        if len(parts) == 2:
            ahead_behind = {"behind": int(parts[0]), "ahead": int(parts[1])}
    branches_raw = _git_run(["for-each-ref", "--format=%(refname:short)%00%(committerdate:iso)%00%(objectname)"], cwd).stdout
    branches = []
    for line in branches_raw.decode("utf-8").split("\n"):
        if not line:
            continue
        parts = line.split("\0")
        if len(parts) >= 2:
            branches.append({"name": parts[0], "current": parts[0] == branch, "committedAt": parts[1]})
    wt_raw = _git_run(["worktree", "list", "--porcelain"], cwd).stdout
    worktrees = []
    blocks = wt_raw.decode("utf-8").split("\n\n")
    for block in blocks:
        lines = block.strip().split("\n")
        if not lines or not lines[0].startswith("worktree "):
            continue
        wt_path = lines[0][len("worktree "):].strip()
        head = ""
        branch_name = None
        detached = False
        for line in lines[1:]:
            if line.startswith("HEAD "):
                head = line[len("HEAD "):].strip()
            elif line.startswith("branch "):
                branch_name = line[len("branch "):].strip().replace("refs/heads/", "")
            elif line == "detached":
                detached = True
        worktrees.append({
            "path": wt_path,
            "head": head,
            "branch": branch_name,
            "isMain": len(worktrees) == 0,
            "detached": detached,
            "exists": os.path.isdir(wt_path),
        })
    return {
        "isGitRepo": True,
        "projectRoot": toplevel,
        "currentBranch": branch,
        "statusPorcelainV1Z": status,
        "aheadBehind": ahead_behind,
        "branches": branches,
        "worktrees": worktrees,
    }
`;
