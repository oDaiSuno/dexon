import { useCallback, useEffect, useRef, useState } from "react";
import { automationProjectPath, isAutomationManagedChild } from "@/hooks/use-project-spaces";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { parseStoredSpaceCwd, resolveStartupSpace } from "@/lib/space-startup";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { getActiveEnvironmentId, environmentRegistry, useEnvironments } from "@/lib/environment-registry";
import { workspaceStore, type WorkspaceSnapshot } from "@/lib/workspace-store";
import { environmentAffordances } from "@/lib/environment-affordances";

const defaultSpaceIo: SpaceCoordinationIo = createDefaultSpaceIo();

export type SpacePhase =
  | { phase: "idle" }
  | { phase: "preparing"; target: "stored" | "personal" }
  | { phase: "ready"; cwd: string }
  | { phase: "unavailable"; attempted: "stored" | "personal"; reason: string };

export interface SpaceCoordinationIo {
  readStoredSpaceCwd(): Promise<string | null>;

  preparePersonalSpace(): Promise<string>;

  prepareAutomationSpace?(): Promise<string>;

  validateSpace(path: string): Promise<string>;

  persistSpaceCwd(path: string): Promise<void>;

  openDirectory(path: string): Promise<void>;
}

export function createDefaultSpaceIo(): SpaceCoordinationIo {
  return {
    readStoredSpaceCwd: async () => {
      if (!window.piBridge) return null;
      const state = await window.piBridge.getUiState();
      return parseStoredSpaceCwd(state?.lastSpaceCwd);
    },
    preparePersonalSpace: async () => {
      const prepared = await getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).defaultCwd();
      if (!prepared?.cwd) throw new Error("Personal directory preparation failed");
      return prepared.cwd;
    },
    prepareAutomationSpace: async () => {
      const prepared = await getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).automationCwd();
      if (!prepared?.cwd) throw new Error("Automation directory preparation failed");
      return prepared.cwd;
    },
    validateSpace: async (path) => {
      const result = await getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).validateCwd(path);
      if (!result.ok || !result.path) throw new Error(result.error ?? "Invalid directory");
      return result.path;
    },
    persistSpaceCwd: async (path) => {
      if (!window.piBridge) throw new Error("Desktop preferences are unavailable");
      await window.piBridge.setUiState({ lastSpaceCwd: path });
    },
    openDirectory: async (path) => {
      if (!environmentAffordances(environmentRegistry.getActiveEnvironment()).revealInFileManager) return;
      if (!window.piBridge) throw new Error("Desktop bridge is unavailable");
      await window.piBridge.openDirectory(path);
    },
  };
}

export function useSpaceCoordination({
  sessionIntent,
  sessionResolved,
  sessionFound,
  sessionCwd,
  io = defaultSpaceIo,
}: {
  sessionIntent: string | null | undefined;
  sessionResolved: boolean;
  sessionFound: boolean;
  sessionCwd: string | null;
  io?: SpaceCoordinationIo;
}) {
  const [spacePhase, setSpacePhase] = useState<SpacePhase>({ phase: "idle" });
  const [remembered, setRemembered] = useState(false);
  const [rememberFailed, setRememberFailed] = useState(false);
  const phaseRef = useRef<SpacePhase>(spacePhase);
  const generationRef = useRef(0);
  const persistVersionRef = useRef(0);
  const decidedRef = useRef(false);
  const attemptedRef = useRef<"stored" | "personal" | null>(null);
  const storedCwdRef = useRef<string | null>(null);
  const [attemptedCwd, setAttemptedCwd] = useState<string | null>(null);
  const [personalCwd, setPersonalCwd] = useState<string | null>(null);
  const [automationCwd, setAutomationCwd] = useState<string | null>(null);
  const automationCwdRef = useRef<string | null>(null);
  const automationRequest = useRef<Promise<string | null> | null>(null);
  const primary = useEnvironments().find((environment) => environment.id === PRIMARY_ENVIRONMENT_ID);
  const primaryGeneration = primary?.status.phase === "connected" ? primary.status.generation : null;
  const prepareAutomationSpace = useCallback(() => {
    automationRequest.current ??= Promise.resolve()
      .then(() => io.prepareAutomationSpace?.() ?? null)
      .catch(() => null);
    return automationRequest.current;
  }, [io]);
  useEffect(() => {
    let cancelled = false;
    automationRequest.current = null;
    void prepareAutomationSpace().then((cwd) => {
      if (cancelled) return;
      if (cwd) automationCwdRef.current = cwd;
      setAutomationCwd(cwd);
    });
    return () => {
      cancelled = true;
    };
  }, [prepareAutomationSpace, primaryGeneration]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      persistVersionRef.current += 1;
    },
    [],
  );

  const setPhase = useCallback((next: SpacePhase) => {
    phaseRef.current = next;
    setSpacePhase(next);
  }, []);

  const persist = useCallback(
    (path: string) => {
      const version = ++persistVersionRef.current;
      setRemembered(false);
      setRememberFailed(false);
      const write = async () => {
        const root = automationCwdRef.current ?? (io.prepareAutomationSpace ? await prepareAutomationSpace() : null);
        if (persistVersionRef.current !== version) return;
        await io.persistSpaceCwd(automationProjectPath(path, automationCwdRef.current ?? root));
      };
      void write().then(
        () => {
          if (persistVersionRef.current !== version) return;
          setRememberFailed(false);
          setRemembered(true);
        },
        () => {
          if (persistVersionRef.current !== version) return;
          setRemembered(false);
          setRememberFailed(true);
        },
      );
    },
    [io, prepareAutomationSpace],
  );

  const commit = useCallback(
    (cwd: string) => {
      setPhase({ phase: "ready", cwd });
      persist(cwd);
    },
    [persist, setPhase],
  );

  const preparePersonal = useCallback((): Promise<string | null> => {
    const generation = ++generationRef.current;
    attemptedRef.current = "personal";
    setAttemptedCwd(null);
    setPhase({ phase: "preparing", target: "personal" });
    return io.preparePersonalSpace().then(
      (cwd) => {
        if (generation !== generationRef.current) return null;
        setPersonalCwd(cwd);
        commit(cwd);
        return cwd;
      },
      (error) => {
        if (generation !== generationRef.current) return null;
        setPhase({ phase: "unavailable", attempted: "personal", reason: errorMessage(error) });
        return null;
      },
    );
  }, [commit, io, setPhase]);

  const restoreStored = useCallback(
    (path: string) => {
      const generation = ++generationRef.current;
      attemptedRef.current = "stored";
      setAttemptedCwd(path);
      setPhase({ phase: "preparing", target: "stored" });
      io.validateSpace(path).then(
        (validated) => {
          if (generation !== generationRef.current) return;
          commit(validated);
        },
        async (error) => {
          if (generation !== generationRef.current) return;
          const root = await prepareAutomationSpace();
          if (generation !== generationRef.current) return;
          if (root && isAutomationManagedChild(path, root)) commit(root);
          else setPhase({ phase: "unavailable", attempted: "stored", reason: errorMessage(error) });
        },
      );
    },
    [commit, io, prepareAutomationSpace, setPhase],
  );

  const [storedSpaceCwd, setStoredSpaceCwd] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    io.readStoredSpaceCwd().then(
      (value) => {
        if (mounted) setStoredSpaceCwd(value ?? null);
      },
      () => {
        if (mounted) setStoredSpaceCwd(null);
      },
    );
    return () => {
      mounted = false;
    };
  }, [io]);

  useEffect(() => {
    if (decidedRef.current) return;
    const decision = resolveStartupSpace({
      sessionIntent,
      sessionResolved,
      sessionFound,
      storedSpaceCwd,
    });
    if (decision.type === "wait") return;
    decidedRef.current = true;
    if (decision.type === "explicit") return;
    if (phaseRef.current.phase === "ready") return;
    storedCwdRef.current = decision.type === "restore" ? decision.path : null;
    if (decision.type === "restore") restoreStored(decision.path);
    else void preparePersonal();
  }, [sessionIntent, sessionResolved, sessionFound, storedSpaceCwd, preparePersonal, restoreStored]);

  const noteExternalCwd = useCallback(
    (cwd: string | null, origin: "user" | "coordinator" = "user") => {
      if (!cwd || origin === "coordinator" || getActiveEnvironmentId() !== PRIMARY_ENVIRONMENT_ID) return;
      const current = phaseRef.current;
      if (current.phase === "ready" && current.cwd === cwd) return;
      generationRef.current += 1;
      commit(cwd);
    },
    [commit],
  );

  const lastSessionCwdRef = useRef(sessionCwd);
  useEffect(() => {
    if (lastSessionCwdRef.current === sessionCwd) return;
    lastSessionCwdRef.current = sessionCwd;
    noteExternalCwd(sessionCwd, "user");
  }, [sessionCwd, noteExternalCwd]);

  const retry = useCallback(() => {
    if (phaseRef.current.phase !== "unavailable") return;
    if (attemptedRef.current === "stored" && storedCwdRef.current) restoreStored(storedCwdRef.current);
    else void preparePersonal();
  }, [preparePersonal, restoreStored]);

  const returnToPersonalSpace = useCallback(() => {
    return preparePersonal().then((cwd) => {
      if (cwd) workspaceStore.openSpace({ environmentId: PRIMARY_ENVIRONMENT_ID, path: cwd });
      return cwd;
    });
  }, [preparePersonal]);

  const openCurrentFolder = useCallback(async () => {
    const current = phaseRef.current;
    if (current.phase !== "ready") return;
    await io.openDirectory(current.cwd);
  }, [io]);

  const openFolder = useCallback(
    async (path: string) => {
      await io.openDirectory(path);
    },
    [io],
  );

  return {
    spaceCwd: spacePhase.phase === "ready" ? spacePhase.cwd : null,
    spacePhase,
    attemptedCwd,
    personalCwd,
    automationCwd,
    prepareAutomationSpace,
    remembered,
    rememberFailed,
    noteExternalCwd,
    retry,
    returnToPersonalSpace,
    openCurrentFolder,
    openFolder,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export type SpaceCoordination = ReturnType<typeof useSpaceCoordination>;

export function useStartupSpaceSync(snapshot: WorkspaceSnapshot, spacePhase: SpacePhase, sessionFound: boolean) {
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !snapshot.loaded || spacePhase.phase !== "ready") return;
    synced.current = true;
    if (
      snapshot.focus.environmentId === PRIMARY_ENVIRONMENT_ID &&
      snapshot.focus.spaceKey === null &&
      snapshot.focus.sessionId === null &&
      !sessionFound
    )
      workspaceStore.openSpace({ environmentId: PRIMARY_ENVIRONMENT_ID, path: spacePhase.cwd });
  }, [snapshot.loaded, snapshot.focus, spacePhase, sessionFound]);
}
