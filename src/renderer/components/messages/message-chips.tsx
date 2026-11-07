import { attachmentTokenName, resolveAttachmentRevealPath } from "@shared/attachment-tokens";
import { attachmentGlyphSvg, SKILL_CHIP_SVG } from "../chat-input/chip-glyphs";
import { useEnvironments } from "@/lib/environment-registry";
import { environmentAffordances } from "@/lib/environment-affordances";
import { useFileEnvironment } from "@/lib/use-file-environment";
import type { EnvironmentId } from "@contract/environment";

export function AttachmentChip({
  path,
  cwd,
  previewUrl,
  environmentId: requestedEnvironmentId,
}: {
  path: string;
  cwd?: string;
  previewUrl: string | null;
  environmentId?: EnvironmentId;
}) {
  const environmentId = useFileEnvironment(requestedEnvironmentId);
  const affordances = environmentAffordances(useEnvironments().find((view) => view.id === environmentId));
  const target = affordances.revealInFileManager ? resolveAttachmentRevealPath(path, cwd) : null;
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
      onClick={() => void window.piBridge?.showItemInFolder?.(target)}
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
