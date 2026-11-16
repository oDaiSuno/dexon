import { attachmentTokenName, resolveAttachmentRevealPath } from "@shared/attachment-tokens";
import { attachmentGlyphSvg, SKILL_CHIP_SVG } from "../chat-input/chip-glyphs";
import { useEnvironments } from "@/lib/environment-registry";
import { environmentAffordances } from "@/lib/environment-affordances";
import type { EnvironmentId } from "@contract/environment";

export function AttachmentChip({
  path,
  cwd,
  previewUrl,
  onOpenFile,
  environmentId,
}: {
  path: string;
  cwd?: string;
  previewUrl: string | null;
  environmentId: EnvironmentId;
  onOpenFile?: (filePath: string, environmentId?: EnvironmentId) => void;
}) {
  const affordances = environmentAffordances(useEnvironments().find((view) => view.id === environmentId));
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
  if (!target || (!affordances.revealInFileManager && !onOpenFile)) {
    return (
      <span className="token-chip token-chip-static type-mono-label" title={path}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="token-chip type-mono-label"
      title={path}
      onClick={() => {
        if (onOpenFile) onOpenFile(target, environmentId);
        else void window.piBridge?.showItemInFolder?.(target);
      }}
    >
      {content}
    </button>
  );
}

export function SkillChip({ name }: { name: string }) {
  return (
    <span className="skill-chip type-label-medium" title={name}>
      <span className="skill-chip-glyph" dangerouslySetInnerHTML={{ __html: SKILL_CHIP_SVG }} />
      <span className="skill-chip-name">{name}</span>
    </span>
  );
}
