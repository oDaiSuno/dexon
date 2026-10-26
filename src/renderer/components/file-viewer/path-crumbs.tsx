import { Fragment } from "react";
import { getRelativeFilePath } from "@/lib/file-paths";

export function PathCrumbs({ filePath, cwd }: { filePath: string; cwd?: string }) {
  const segments = getRelativeFilePath(filePath, cwd).split("/").filter(Boolean);
  const last = segments.length - 1;
  return (
    <div className="file-viewer-crumbs" title={filePath}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <>
              <span className="sr-only">/</span>
              <svg
                className="file-viewer-crumb-chevron"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </>
          )}
          <span className={`file-viewer-crumb type-mono-meta${index === last ? " file-viewer-crumb-current" : ""}`}>
            {segment}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
