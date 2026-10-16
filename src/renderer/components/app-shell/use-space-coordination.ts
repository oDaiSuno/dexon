import { useCallback, useEffect, useRef, useState } from "react";
import { defaultCwd, validateCwd } from "@/lib/api-client";
import { parseStoredSpaceCwd, resolveStartupSpace } from "@/lib/space-startup";

// Phase 6: the single owner of the current space. It executes the approved
// three-tier startup decision (explicit session → last space → personal
// space), tracks preparation/validation outcomes honestly, persists the
// remembered space through the validated desktop preference channel, and
// aligns the space with user-driven cwd changes. Session/chat identity stays
// in use-workspace-navigation; this owner only decides "where are we working".

const defaultSpaceIo: SpaceCoordinationIo = createDefaultSpaceIo();

export type SpacePhase =
  | { phase: "idle" }
  | { phase: "preparing"; target: "stored" | "personal" }
  | { phase: "ready"; cwd: string }
  | { phase: "unavailable"; attempted: "stored" | "personal"; reason: string };

export interface SpaceCoordinationIo {
  /** Read the remembered last-space cwd (null = no record). */
  readStoredSpaceCwd(): Promise<string | null>;
  /** Prepare (and authorize) the fixed personal directory; rejects with a readable reason. */
  preparePersonalSpace(): Promise<string>;
  /** Validate (and authorize) a restored space; resolves with the validated path. */
  validateSpace(path: string): Promise<string>;
  /** Persist the remembered space; rejects when the preference could not be saved. */
  persistSpaceCwd(path: string): Promise<void>;
  /** Ask the desktop to truly open a directory in the system file manager. */
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
      const prepared = await defaultCwd();
      if (!prepared?.cwd) throw new Error("Personal directory preparation failed");
      return prepared.cwd;
    },
    validateSpace: async (path) => {
      const result = await validateCwd(path);
      if (!result.ok || !result.path) throw new Error(result.error ?? "Invalid directory");
      return result.path;
    },
    persistSpaceCwd: async (path) => {
      if (!window.piBridge) throw new Error("Desktop preferences are unavailable");
      await window.piBridge.setUiState({ lastSpaceCwd: path });
    },
    openDirectory: async (path) => {
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

  // Unmounting invalidates every in-flight preparation/validation: a stale
  // owner must neither commit a space nor write the preference afterwards.
  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );

  const setPhase = useCallback((next: SpacePhase) => {
    phaseRef.current = next;
    setSpacePhase(next);
  }, []);

  const persist = useCallback(
    (path: string) => {
      // Persistence state belongs to the CURRENT space: a new commit starts
      // unconfirmed, and only the latest write request may set the flags.
      const version = ++persistVersionRef.current;
      setRemembered(false);
      setRememberFailed(false);
      void io.persistSpaceCwd(path).then(
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
    [io],
  );

  const commit = useCallback(
    (cwd: string) => {
      setPhase({ phase: "ready", cwd });
      persist(cwd);
    },
    [persist, setPhase],
  );

  const [attemptedCwd, setAttemptedCwd] = useState<string | null>(null);
  const [personalCwd, setPersonalCwd] = useState<string | null>(null);

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
        (error) => {
          if (generation !== generationRef.current) return;
          setPhase({ phase: "unavailable", attempted: "stored", reason: errorMessage(error) });
        },
      );
    },
    [commit, io, setPhase],
  );

  // The stored preference is read once per mount; the decision runs once the
  // gate is satisfied (no explicit-session branch pending) and no space was
  // already committed by a user action racing ahead of the preference read.
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

  /**
   * User-driven space changes (project picker, worktree switch, session
   * alignment echoes). An echo carrying "coordinator" origin is the sidebar's
   * delayed notification of a value this owner already pushed down — it must
   * never be treated as a fresh user choice. An echo equal to the already
   * committed space is likewise ignored; any genuinely new cwd supersedes
   * in-flight startup operations via the generation guard and becomes the new
   * remembered space.
   */
  const noteExternalCwd = useCallback(
    (cwd: string | null, origin: "user" | "coordinator" = "user") => {
      if (!cwd || origin === "coordinator") return;
      const current = phaseRef.current;
      if (current.phase === "ready" && current.cwd === cwd) return;
      generationRef.current += 1;
      commit(cwd);
    },
    [commit],
  );

  // Deep links and session creation change the working cwd without passing
  // through the sidebar's internal selection, so the space must follow the
  // session-derived cwd whenever it changes. This is a user-driven intent.
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

  const returnToPersonalSpace = useCallback(() => preparePersonal(), [preparePersonal]);

  const openCurrentFolder = useCallback(async () => {
    const current = phaseRef.current;
    if (current.phase !== "ready") return;
    await io.openDirectory(current.cwd);
  }, [io]);

  return {
    spaceCwd: spacePhase.phase === "ready" ? spacePhase.cwd : null,
    spacePhase,
    attemptedCwd,
    personalCwd,
    remembered,
    rememberFailed,
    noteExternalCwd,
    retry,
    returnToPersonalSpace,
    openCurrentFolder,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export type SpaceCoordination = ReturnType<typeof useSpaceCoordination>;
