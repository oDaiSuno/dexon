import { useI18n } from "@/i18n";
import { ComposerEditable } from "./ComposerEditable";
import type { ComposerViewProps } from "./composer-view";

type Props = Pick<
  ComposerViewProps,
  | "visible"
  | "value"
  | "restoreCaret"
  | "editableRef"
  | "isStreaming"
  | "onChange"
  | "onKeyDown"
  | "onPaste"
  | "onCompositionStart"
  | "onCompositionEnd"
  | "tokenPreviewsByPath"
  | "missingTokenInspections"
  | "onRevealToken"
  | "onSkillReveal"
  | "skillsByName"
  | "onJumpQuote"
  | "jumpingQuoteKey"
  | "detachedQuoteKeys"
>;

export function ComposerTextField(props: Props) {
  const { t } = useI18n();
  return (
    <ComposerEditable
      visible={props.visible}
      value={props.value}
      restoreCaret={props.restoreCaret}
      handleRef={props.editableRef}
      placeholder={
        props.isStreaming
          ? t("queuePlaceholder", "Agent is running… sending queues a follow-up")
          : t("messagePlaceholder", "Message… Type / for commands, @ for files")
      }
      onChange={props.onChange}
      onKeyDown={props.onKeyDown}
      onPaste={props.onPaste}
      onCompositionStart={props.onCompositionStart}
      onCompositionEnd={props.onCompositionEnd}
      previewsByPath={props.tokenPreviewsByPath}
      missingByPath={props.missingTokenInspections}
      onRevealToken={props.onRevealToken}
      onSkillReveal={props.onSkillReveal}
      removeLabel={t("remove", "Remove")}
      skillsByName={props.skillsByName}
      skillRemoveLabel={t("removeSkill", "Remove skill")}
      quoteRemoveLabel={t("removeQuote", "Remove quote")}
      onJumpQuote={props.onJumpQuote}
      jumpingQuoteKey={props.jumpingQuoteKey}
      detachedQuoteKeys={props.detachedQuoteKeys}
    />
  );
}
