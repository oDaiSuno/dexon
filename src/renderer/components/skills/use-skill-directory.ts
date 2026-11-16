import type { EnvironmentId } from "@contract/environment";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { LatestAbortableRequest } from "@/lib/latest-abortable-request";
import { requestErrorMessage, type Skill } from "./skill-shared";

export interface SkillDirectory {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  setSelected: (filePath: string | null) => void;
  toggling: Set<string>;
  saveError: string | null;
  loadSkills: () => Promise<void>;
  toggle: (skill: Skill) => Promise<void>;
}

export function useSkillDirectory(environmentId: EnvironmentId, cwd: string): SkillDirectory {
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const skillsRequestRef = useRef(new LatestAbortableRequest());

  const loadSkills = useCallback(async () => {
    const request = skillsRequestRef.current.begin();
    setLoading(true);
    setError(null);
    try {
      const result = await getEnvironmentApiClient(environmentId).call("skills.list", { cwd });
      if (!skillsRequestRef.current.isCurrent(request.generation)) return;
      const list = result.skills;
      setSkills(list);
      setSelected((current) =>
        current && list.some((skill) => skill.filePath === current) ? current : (list[0]?.filePath ?? null),
      );
    } catch (loadError) {
      if (request.signal.aborted || !skillsRequestRef.current.isCurrent(request.generation)) return;
      setError(requestErrorMessage(loadError, t("skillsLoadFailed", "Failed to load skills.")));
    } finally {
      if (skillsRequestRef.current.finish(request.generation)) setLoading(false);
    }
  }, [environmentId, cwd, t]);

  useEffect(() => {
    const requests = skillsRequestRef.current;
    setSkills([]);
    setSelected(null);
    void loadSkills();
    return () => {
      requests.cancel();
    };
  }, [loadSkills]);

  const toggle = useCallback(
    async (skill: Skill) => {
      const next = !skill.disableModelInvocation;
      setToggling((s) => new Set(s).add(skill.filePath));
      setSaveError(null);
      try {
        await getEnvironmentApiClient(environmentId).call("skills.set", {
          cwd,
          filePath: skill.filePath,
          disableModelInvocation: next,
        });
        setSkills((prev) =>
          prev.map((s) => (s.filePath === skill.filePath ? { ...s, disableModelInvocation: next } : s)),
        );
      } catch (e) {
        setSaveError(requestErrorMessage(e, t("skillVisibilitySaveFailed", "Failed to update skill visibility.")));
      } finally {
        setToggling((s) => {
          const n = new Set(s);
          n.delete(skill.filePath);
          return n;
        });
      }
    },
    [environmentId, cwd, t],
  );

  return {
    skills,
    loading,
    error,
    selected,
    setSelected,
    toggling,
    saveError,
    loadSkills,
    toggle,
  };
}
