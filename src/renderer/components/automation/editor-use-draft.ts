import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskSpec } from "@shared/automation/spec";
import type { TaskValidationResult } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { useAutomationWorkspace } from "./automation-context";
import { editorAllSecrets, editorError, editorJson, editorNewTask, editorTaskDirectory } from "./editor-model";
import { editorParseDraft } from "./editor-raw-shape";

export function useEditorDraft(initialEnvironmentId: string, taskId?: string, baseSpec?: TaskSpec) {
  const { hosts, tasks, call, command, refresh, notify, navigate } = useAutomationWorkspace();
  const { t } = useI18n();
  const workspaceRef = useRef({ call, command, refresh, notify });
  workspaceRef.current = { call, command, refresh, notify };
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  const hostStatus = hosts.find((host) => host.environment.id === environmentId)?.status ?? "offline";
  const [draft, setDraft] = useState<TaskSpec>(() => baseSpec ?? editorNewTask(t("autoPageEditorNewTask", "New task")));
  const [raw, setRaw] = useState(() => editorJson(draft));
  const [baseline, setBaseline] = useState("");
  const [savedTaskId, setSavedTaskId] = useState(taskId);
  const [revision, setRevision] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secretNames, setSecretNames] = useState<readonly string[] | null>(null);
  const [secretError, setSecretError] = useState("");
  const [validationState, setValidationState] = useState<{ source: string; result: TaskValidationResult } | null>(null);
  const [validating, setValidating] = useState(false);
  const [invalidFields, setInvalidFields] = useState<readonly string[]>([]);
  const [root, setRoot] = useState("");
  const loadSequence = useRef(0);
  const secretSequence = useRef(0);
  const saving = useRef(false);
  const initialDraft = useRef(draft);
  const workspaceVersion = JSON.stringify(
    tasks.map((entry) => [entry.environmentId, entry.task.id, entry.task.currentRevision, entry.task.updatedAtMs]),
  );
  const activeEnvironment = useRef(environmentId);
  activeEnvironment.current = environmentId;

  const updateDraft = useCallback((next: TaskSpec) => {
    setDraft(next);
    setRaw(editorJson(next));
    setError("");
  }, []);

  useEffect(() => {
    const sequence = ++loadSequence.current;
    let disposed = false;
    setLoading(true);
    setLoadFailed(false);
    setRoot("");
    setError("");
    setSavedTaskId(taskId);
    setRevision(undefined);
    setValidationState(null);
    setInvalidFields([]);
    void (async () => {
      try {
        let source = baseSpec ?? initialDraft.current;
        let currentRevision: number | undefined;
        if (taskId) {
          const hosted = tasksRef.current.find(
            (entry) => entry.environmentId === initialEnvironmentId && entry.task.id === taskId,
          );
          const current =
            hosted?.revision && hosted.revision.revision === hosted.task.currentRevision
              ? hosted.revision
              : (await workspaceRef.current.call(initialEnvironmentId, "automation.getTask", { taskId })).task;
          currentRevision = current.revision;
          source = baseSpec ?? current.source;
        } else if (!source.cwd) {
          const result = await workspaceRef.current.call(initialEnvironmentId, "system.automationCwd");
          source = { ...source, cwd: editorTaskDirectory(result.cwd, source.id) };
          if (!disposed) setRoot(result.cwd);
        }
        if (disposed || sequence !== loadSequence.current) return;
        setEnvironmentId(initialEnvironmentId);
        setDraft(source);
        setRaw(editorJson(source));
        setBaseline(baseSpec || !taskId ? "" : editorJson(source));
        setRevision(currentRevision);
      } catch (failure) {
        if (!disposed) {
          setLoadFailed(true);
          setError(editorError(failure));
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [initialEnvironmentId, taskId, baseSpec, loadAttempt]);

  const refreshSecrets = useCallback(async () => {
    const sequence = ++secretSequence.current;
    try {
      const result = await workspaceRef.current.command({ type: "list-secret-names", environmentId });
      if (sequence !== secretSequence.current || activeEnvironment.current !== environmentId) return;
      setSecretNames(result.names);
      setSecretError("");
    } catch (failure) {
      if (sequence !== secretSequence.current || activeEnvironment.current !== environmentId) return;
      setSecretNames(null);
      setSecretError(editorError(failure));
    }
  }, [environmentId]);

  const invalidateSecrets = useCallback(() => {
    secretSequence.current++;
  }, []);

  useEffect(() => {
    setSecretNames(null);
    void refreshSecrets();
    const focus = () => {
      void refreshSecrets();
    };
    window.addEventListener("focus", focus);
    return () => {
      invalidateSecrets();
      window.removeEventListener("focus", focus);
    };
  }, [refreshSecrets, workspaceVersion, hostStatus, invalidateSecrets]);

  useEffect(() => {
    if (loading) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      setValidationState({
        source: raw,
        result: {
          valid: false,
          issues: [{ path: "$", message: t("autoPageEditorRawInvalid", "The raw configuration is not valid JSON.") }],
        },
      });
      setValidating(false);
      return;
    }
    let disposed = false;
    setValidating(true);
    const timer = window.setTimeout(() => {
      void workspaceRef.current
        .call(environmentId, "automation.validateTask", { spec: value })
        .then((result) => {
          if (!disposed) setValidationState({ source: raw, result });
        })
        .catch((failure: unknown) => {
          if (!disposed)
            setValidationState({
              source: raw,
              result: { valid: false, issues: [{ path: "$", message: editorError(failure) }] },
            });
        })
        .finally(() => {
          if (!disposed) setValidating(false);
        });
    }, 350);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [raw, environmentId, hostStatus, loading, t]);

  const validation = validationState?.source === raw ? validationState.result : null;
  const validSpec = validation?.valid ? validation.spec : undefined;
  const rawSpec = useMemo(() => editorParseDraft(raw), [raw]);
  const requiredSecrets = validation?.requiredGrant?.secrets ?? editorAllSecrets(rawSpec ?? draft);
  const missingSecrets = useMemo(
    () => (secretNames === null ? requiredSecrets : requiredSecrets.filter((name) => !secretNames.includes(name))),
    [requiredSecrets, secretNames],
  );
  const hostOnline = hostStatus === "online";
  const idChanged = !!savedTaskId && rawSpec?.id !== undefined && rawSpec.id !== savedTaskId;
  const idInvalid = !savedTaskId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawSpec?.id ?? draft.id);
  const collision =
    !savedTaskId &&
    tasks.some((entry) => entry.environmentId === environmentId && entry.task.id === (rawSpec?.id ?? draft.id));
  const canSave =
    !loading &&
    !loadFailed &&
    !busy &&
    hostOnline &&
    !!validSpec &&
    !invalidFields.length &&
    !idChanged &&
    !idInvalid &&
    !collision;
  const canEnable = canSave && !missingSecrets.length && (secretNames !== null || !requiredSecrets.length);
  const dirty = baseline !== raw || !!invalidFields.length;

  const markInvalid = useCallback(
    (id: string, invalid: boolean) =>
      setInvalidFields((previous) =>
        invalid ? (previous.includes(id) ? previous : [...previous, id]) : previous.filter((entry) => entry !== id),
      ),
    [],
  );

  const selectHost = async (nextHost: string) => {
    if (savedTaskId || busy || nextHost === environmentId) return;
    const previousHost = environmentId;
    const previousCwd = draft.cwd;
    const sequence = ++loadSequence.current;
    setEnvironmentId(nextHost);
    setLoading(true);
    setError("");
    try {
      const result = await workspaceRef.current.call(nextHost, "system.automationCwd");
      if (sequence !== loadSequence.current) return;
      const managedCwd = !draft.cwd || (!!root && draft.cwd === editorTaskDirectory(root, draft.id));
      setRoot(result.cwd);
      updateDraft({ ...draft, cwd: managedCwd ? editorTaskDirectory(result.cwd, draft.id) : draft.cwd });
    } catch (failure) {
      if (sequence !== loadSequence.current) return;
      setEnvironmentId(previousHost);
      setError(`${editorError(failure)} (${previousCwd})`);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  };

  const save = async (enable: boolean) => {
    if (!validSpec || !canSave || (enable && !canEnable) || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (savedTaskId && revision !== undefined) {
        const current = await workspaceRef.current.call(environmentId, "automation.getTask", { taskId: savedTaskId });
        if (current.task.revision !== revision)
          throw new Error(
            t(
              "autoPageEditorRevisionConflict",
              "A newer revision exists. Your draft is preserved; reopen the task separately to compare before saving.",
            ),
          );
      }
      if (!savedTaskId) {
        const latest = await workspaceRef.current.call(environmentId, "automation.listTasks");
        if (latest.tasks.some((task) => task.id === validSpec.id))
          throw new Error(
            t("autoPageEditorIdCollision", "This task ID already exists on this host. Choose a different ID."),
          );
      }
      const saved = await workspaceRef.current.call(environmentId, "automation.saveTask", { spec: validSpec });
      setSavedTaskId(saved.task.id);
      setRevision(saved.revision);
      setDraft(validSpec);
      setRaw(editorJson(validSpec));
      setBaseline(editorJson(validSpec));
      workspaceRef.current.notify(
        t("autoPageEditorSaved", "Draft saved. Automatic triggers are paused; existing runs continue."),
      );
      await workspaceRef.current.refresh();
      if (enable) {
        if (saved.requiredGrant.secrets.length) {
          const available = await workspaceRef.current.command({ type: "list-secret-names", environmentId });
          setSecretNames(available.names);
          if (saved.requiredGrant.secrets.some((name) => !available.names.includes(name)))
            throw new Error(
              t(
                "autoPageEditorMissingSecretsFooter",
                "Draft is valid, but referenced secrets are missing or unchecked. You may save, but cannot enable yet.",
              ),
            );
        }
        const result = await workspaceRef.current.command(
          {
            type: "enable-task",
            environmentId,
            taskId: saved.task.id,
            revision: saved.revision,
            planHash: saved.planHash,
          },
          t("autoPageEditorEnableConsent", "Review and enable this automation revision"),
        );
        if (result.outcome === "enabled") {
          workspaceRef.current.notify(t("autoPageEditorEnabled", "Revision enabled."));
          await workspaceRef.current.refresh();
          navigate({ view: "task", environmentId, taskId: saved.task.id });
        } else
          workspaceRef.current.notify(
            t("autoPageEditorEnableCancelled", "Authorization cancelled. The saved draft remains paused."),
          );
      }
    } catch (failure) {
      setError(editorError(failure));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return {
    hosts,
    tasks,
    environmentId,
    draft,
    raw,
    rawSpec,
    setRaw,
    updateDraft,
    loading,
    loadFailed,
    retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
    busy,
    error,
    setError,
    secretNames,
    secretError,
    refreshSecrets,
    validation,
    validating,
    validSpec,
    missingSecrets,
    requiredSecrets,
    savedTaskId,
    revision,
    dirty,
    canSave,
    canEnable,
    invalidFields,
    markInvalid,
    root,
    selectHost,
    save,
    idChanged,
    idInvalid,
    collision,
    hostOnline,
  };
}
