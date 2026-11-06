import { useConnectionLabel } from "@/lib/connection-labels";
import type { ProjectSpaceRow } from "./project-space-rows";

export function ProjectMenuHeader({ project }: { project: ProjectSpaceRow }) {
  const status = useConnectionLabel(project.connection);
  return (
    <div className="project-menu-header" data-tone={project.connection.tone}>
      <span className="project-menu-status type-mono-meta">
        <span className="project-host-dot" aria-hidden="true" />
        {project.environment.label} · {status}
      </span>
      <span className="project-menu-path type-mono-meta" title={project.path}>
        {project.path}
      </span>
    </div>
  );
}
