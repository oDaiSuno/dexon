import { attachmentTokenName, resolveAttachmentRevealPath } from "@shared/attachment-tokens";
import { attachmentGlyphSvg, SKILL_CHIP_SVG } from "../chat-input/chip-glyphs";

export function AttachmentChip({ path, cwd, previewUrl }: { path: string; cwd?: string; previewUrl: string | null }) {
  const target = resolveAttachmentRevealPath(path, cwd);
  const content = (
    <>
      {previewUrl ? (
        <img className="token-chip-thumb" src={previewUrl} alt="" />
      ) : (
        <span className="token-chip-glyph" dangerouslySetInnerHTML={{ __html: attachmentGlyphSvg(path) }} />
      )}
      <span className="token-chip-name">{attachmentTokenName(path)}</span>
    </>
  );
  if (!target) {
    return (
      <span className="token-chip token-chip-static" title={path}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="token-chip"
      title={path}
      onClick={() => void window.piBridge?.showItemInFolder?.(target)}
    >
      {content}
    </button>
  );
}

export function SkillChip({ name }: { name: string }) {
  return (
    <span className="skill-chip" title={name}>
      <span className="skill-chip-glyph" dangerouslySetInnerHTML={{ __html: SKILL_CHIP_SVG }} />
      <span className="skill-chip-name">{name}</span>
    </span>
  );
}
