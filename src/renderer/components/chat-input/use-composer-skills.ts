import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { useI18n } from "@/i18n";
import type { ComposerEditableHandle } from "./types";
import type { CatalogSkill, SkillCatalog } from "./use-skill-catalog";

interface Options {
  skillCatalog: SkillCatalog;
  visible: boolean;
  editableRef: MutableRefObject<ComposerEditableHandle | null>;
}

export function useComposerSkills({ skillCatalog, visible, editableRef }: Options) {
  const { t } = useI18n();
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [remotePanelOpen, setRemotePanelOpen] = useState(false);
  const [skillRevealName, setSkillRevealName] = useState<string | null>(null);
  const { refresh } = skillCatalog;

  const openSkillPicker = useCallback(() => {
    if (!visible) return;
    setPlusMenuOpen(false);
    setSkillRevealName(null);
    setSkillPickerOpen(true);
  }, [visible]);

  const pickSkill = useCallback(
    (skill: CatalogSkill) => {
      if (skill.lockedByReadOnly) return;
      setSkillPickerOpen(false);
      if (visible) editableRef.current?.focus();
      editableRef.current?.fillCommandSlot({ kind: "skill", name: skill.name });
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
    if (!plusMenuOpen) refresh();
    setPlusMenuOpen(!plusMenuOpen);
    setSkillPickerOpen(false);
    setRemotePanelOpen(false);
    setSkillRevealName(null);
  }, [refresh, plusMenuOpen, visible]);
  const closePlusMenu = useCallback(() => setPlusMenuOpen(false), []);

  return {
    plusMenuOpen: visible && plusMenuOpen,
    skillPickerOpen: visible && skillPickerOpen,
    remotePanelOpen: visible && remotePanelOpen,
    skillRevealName: visible ? skillRevealName : null,
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
