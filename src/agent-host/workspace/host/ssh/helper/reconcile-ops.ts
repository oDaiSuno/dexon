export const RECONCILE_OPS_SOURCE = String.raw`
@op("reconcileRuns")
def op_reconcile_runs(request):
    tickets = request.input.get("tickets") or []
    if not isinstance(tickets, list):
        raise OpFailure("BAD_REQUEST", "tickets must be a list")
    evidence = []
    current_boot = read_boot_id()
    for ticket in tickets:
        if not isinstance(ticket, dict):
            continue
        workspace = ticket.get("workspace", "")
        run_id = ticket.get("runId", "")
        boot_id = ticket.get("bootId", "")
        pgid = ticket.get("pgid")
        if boot_id != current_boot:
            evidence.append({"state": "verified-clean", "workspace": workspace, "runId": run_id, "method": "boot-changed"})
            continue
        if pgid is None:
            evidence.append({"state": "pending", "workspace": workspace, "runId": run_id, "reason": "transport-dropped"})
            continue
        try:
            os.killpg(int(pgid), 0)
            fingerprint = ticket.get("startFingerprint", "")
            current_fp = process_fingerprint(int(ticket.get("pid", 0)))
            if current_fp is not None and fingerprint and current_fp != fingerprint:
                evidence.append({"state": "verified-clean", "workspace": workspace, "runId": run_id, "method": "group-empty"})
            else:
                try:
                    os.killpg(int(pgid), signal.SIGKILL)
                    time.sleep(0.2)
                    os.killpg(int(pgid), 0)
                    evidence.append({"state": "verified-leak", "workspace": workspace, "runId": run_id, "detail": "process group survived SIGKILL"})
                except (ProcessLookupError, PermissionError, OSError):
                    evidence.append({"state": "verified-clean", "workspace": workspace, "runId": run_id, "method": "group-empty"})
        except (ProcessLookupError, PermissionError, OSError):
            evidence.append({"state": "verified-clean", "workspace": workspace, "runId": run_id, "method": "group-empty"})
    return {"evidence": evidence}
`;
