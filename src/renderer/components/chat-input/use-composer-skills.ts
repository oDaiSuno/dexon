import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useI18n } from "@/i18n";
import type { SkillRecord } from "@/lib/api-types";
import type { ComposerEditableHandle } from "./types";

interface Options {
  cwd?: string | null;
  visible: boolean;
  editableRef: MutableRefObject<ComposerEditableHandle | null>;
}

export function useComposerSkills({ cwd, visible, editableRef }: Options) {
  const { t } = useI18n();
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [remotePanelOpen, setRemotePanelOpen] = useState(false);
  const [skillsState, setSkillsState] = useState<{ skills: SkillRecord[]; loading: boolean; error: boolean }>({
    skills: [],
    loading: false,
    error: false,
  });
  const [skillRevealName, setSkillRevealName] = useState<string | null>(null);
  const skillRecordsRef = useRef<Map<string, SkillRecord>>(new Map());

  const loadSkills = useCallback(() => {
    setSkillsState((previous) => ({ ...previous, loading: true, error: false }));
    void import("@/lib/api-client")
      .then(({ call }) => call("skills.list", { cwd: cwd ?? undefined }))
      .then(({ skills }) => {
        skillRecordsRef.current = new Map(skills.map((skill) => [skill.name, skill]));
        setSkillsState({ skills, loading: false, error: false });
      })
      .catch(() => setSkillsState({ skills: [], loading: false, error: true }));
  }, [cwd]);

  const openSkillPicker = useCallback(() => {
    if (!visible) return;
    setPlusMenuOpen(false);
    setSkillRevealName(null);
    setSkillPickerOpen(true);
  }, [visible]);

  const pickSkill = useCallback(
    (skill: SkillRecord) => {
      setSkillPickerOpen(false);
      if (visible) editableRef.current?.focus();
      editableRef.current?.insertSkillAtStart(skill.name);
    },
    [editableRef, visible],
  );

  const closeTransientMenus = useCallback(() => {
    setPlusMenuOpen(false);
    setSkillPickerOpen(false);
    setRemotePanelOpen(false);
    setSkillRevealName(null);
  }, []);

  const openRemotePanel = useCallback(() => {
    if (!visible) return;
    setPlusMenuOpen(false);
    setSkillRevealName(null);
    setRemotePanelOpen(true);
  }, [visible]);

  const backToPlusMenu = useCallback(() => {
    setRemotePanelOpen(false);
    setSkillPickerOpen(false);
    setPlusMenuOpen(true);
    if (visible) editableRef.current?.focus();
  }, [editableRef, visible]);

  const revealSkill = useCallback((name: string) => {
    setSkillPickerOpen(false);
    setSkillRevealName(name);
  }, []);

  useEffect(() => {
    if (visible) return;
    closeTransientMenus();
  }, [closeTransientMenus, visible]);

  const transientMenuOpen = plusMenuOpen || skillPickerOpen || remotePanelOpen || Boolean(skillRevealName);

  useEffect(() => {
    if (!visible || !transientMenuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("[data-composer-anchor]")) closeTransientMenus();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [closeTransientMenus, transientMenuOpen, visible]);

  useEffect(() => {
    if (!visible || !plusMenuOpen) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPlusMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [plusMenuOpen, visible]);

  const openPlusMenu = useCallback(() => {
    if (!visible) return;
    if (!plusMenuOpen) loadSkills();
    setPlusMenuOpen(!plusMenuOpen);
    setSkillPickerOpen(false);
    setRemotePanelOpen(false);
    setSkillRevealName(null);
  }, [loadSkills, plusMenuOpen, visible]);
  const closePlusMenu = useCallback(() => setPlusMenuOpen(false), []);

  return {
    plusMenuOpen: visible && plusMenuOpen,
    skillPickerOpen: visible && skillPickerOpen,
    remotePanelOpen: visible && remotePanelOpen,
    skillsState,
    skillRecordsRef,
    skillRevealName: visible ? skillRevealName : null,
    loadSkills,
    openPlusMenu,
    closePlusMenu,
    openSkillPicker,
    openRemotePanel,
    backToPlusMenu,
    pickSkill,
    revealSkill,
    closeTransientMenus,
    setSkillRevealName,
    t,
  };
}
