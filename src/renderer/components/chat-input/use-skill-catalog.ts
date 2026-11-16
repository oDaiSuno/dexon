import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { qualifyProjectKey, type EnvironmentId } from "@contract/environment";
import { getEnvironmentApiClient } from "@/lib/api-client";
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

export function useSkillCatalog({
  environmentId,
  cwd,
  visible,
}: {
  environmentId: EnvironmentId;
  cwd?: string | null;
  visible: boolean;
}): SkillCatalog {
  const [entries, setEntries] = useState<ReadonlyMap<string, CatalogSnapshot>>(() => new Map());
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const key = cwd ? qualifyProjectKey(environmentId, cwd) : null;
  const refresh = useCallback(() => {
    if (!visible || !cwd || !key) return;
    const requests = inFlightRef.current;
    if (requests.has(key)) return;
    setEntries((previous) => {
      const snapshot = previous.get(key) ?? EMPTY;
      return snapshot.status === "ready" ? previous : new Map(previous).set(key, { ...snapshot, status: "loading" });
    });
    const request = getEnvironmentApiClient(environmentId)
      .call("skills.list", { cwd })
      .then(({ skills }) => {
        const valid = skills.flatMap((record): CatalogSkill[] => {
          const name = toSkillName(record.name);
          return name ? [{ ...record, name }] : [];
        });
        setEntries((previous) =>
          new Map(previous).set(key, {
            status: "ready",
            skills: valid,
            byName: new Map(valid.map((skill) => [skill.name, skill])),
          }),
        );
      })
      .catch(() => {
        setEntries((previous) => {
          const snapshot = previous.get(key) ?? EMPTY;
          return snapshot.status === "ready" ? previous : new Map(previous).set(key, { ...snapshot, status: "error" });
        });
      })
      .finally(() => requests.delete(key));
    requests.set(key, request);
  }, [environmentId, cwd, key, visible]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const snapshot = (key && entries.get(key)) || EMPTY;
  return useMemo(() => ({ ...snapshot, refresh }), [refresh, snapshot]);
}
