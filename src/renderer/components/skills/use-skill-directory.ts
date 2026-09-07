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

export function useSkillDirectory(cwd: string): SkillDirectory {
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
      const response = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`, { signal: request.signal });
      const result = (await response.json()) as { skills?: Skill[]; error?: string };
      if (!skillsRequestRef.current.isCurrent(request.generation)) return;
      if (!response.ok || result.error) {
        throw new Error(
          result.error ?? t("httpErrorStatus", "HTTP {status}").replace("{status}", String(response.status)),
        );
      }
      const list = result.skills ?? [];
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
  }, [cwd, t]);

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
        const res = await fetch("/api/skills", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd,
            filePath: skill.filePath,
            disableModelInvocation: next,
          }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setSaveError(d.error ?? t("httpErrorStatus", "HTTP {status}").replace("{status}", String(res.status)));
          return;
        }
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
    [cwd, t],
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
