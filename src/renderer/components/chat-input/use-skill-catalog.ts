import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillRecord } from "@/lib/api-types";
import { toSkillName, type SkillName } from "./command-slot";

export type CatalogSkill = Omit<SkillRecord, "name"> & { readonly name: SkillName };
export type SkillCatalogStatus = "idle" | "loading" | "ready" | "error";

interface CatalogSnapshot {
  readonly status: SkillCatalogStatus;
  readonly skills: readonly CatalogSkill[];
  readonly byName: ReadonlyMap<string, CatalogSkill>;
}

export interface SkillCatalog extends CatalogSnapshot {
  readonly refresh: () => void;
}

const EMPTY: CatalogSnapshot = { status: "idle", skills: [], byName: new Map() };

export function useSkillCatalog({ cwd, visible }: { cwd?: string | null; visible: boolean }): SkillCatalog {
  const [entries, setEntries] = useState<ReadonlyMap<string, CatalogSnapshot>>(() => new Map());
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const refresh = useCallback(() => {
    if (!visible || !cwd) return;
    const requests = inFlightRef.current;
    if (requests.has(cwd)) return;
    setEntries((previous) => {
      const snapshot = previous.get(cwd) ?? EMPTY;
      return snapshot.status === "ready" ? previous : new Map(previous).set(cwd, { ...snapshot, status: "loading" });
    });
    const request = import("@/lib/api-client")
      .then(({ call }) => call("skills.list", { cwd }))
      .then(({ skills }) => {
        const valid = skills.flatMap((record): CatalogSkill[] => {
          const name = toSkillName(record.name);
          return name ? [{ ...record, name }] : [];
        });
        setEntries((previous) =>
          new Map(previous).set(cwd, {
            status: "ready",
            skills: valid,
            byName: new Map(valid.map((skill) => [skill.name, skill])),
          }),
        );
      })
      .catch(() => {
        setEntries((previous) => {
          const snapshot = previous.get(cwd) ?? EMPTY;
          return snapshot.status === "ready" ? previous : new Map(previous).set(cwd, { ...snapshot, status: "error" });
        });
      })
      .finally(() => requests.delete(cwd));
    requests.set(cwd, request);
  }, [cwd, visible]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const snapshot = (cwd && entries.get(cwd)) || EMPTY;
  return useMemo(() => ({ ...snapshot, refresh }), [refresh, snapshot]);
}
