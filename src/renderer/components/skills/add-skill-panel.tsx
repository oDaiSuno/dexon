import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { SkillSearchResult } from "@/lib/api-types";
import { CapabilityRequired, parseCapabilityIssue, type CapabilityIssue } from "@/components/CapabilityRequired";
import { formatCompactNumber } from "@/lib/locale-format";
import { requestErrorMessage, safeInstallError, shortenPath, sourceLabelText } from "./skill-shared";

export function AddSkillPanel({ cwd, onInstalled }: { cwd: string; onInstalled: () => void }) {
  const { language, t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [capabilityIssue, setCapabilityIssue] = useState<CapabilityIssue | null>(null);
  const [pendingInstallPackage, setPendingInstallPackage] = useState<string | null>(null);
  const [installedPkgs, setInstalledPkgs] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"global" | "project">("global");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      setSearching(true);
      setSearchError(null);
      setResults([]);
      try {
        const res = await fetch("/api/skills/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q.trim() }),
        });
        const d = (await res.json()) as {
          results?: SkillSearchResult[];
          error?: string;
        };
        if (d.error) {
          setSearchError(d.error);
          return;
        }
        setResults(d.results ?? []);
        if ((d.results ?? []).length === 0) setSearchError(t("noSkillsFound", "No skills found"));
      } catch (e) {
        setSearchError(requestErrorMessage(e, t("skillSearchFailed", "Skill search failed.")));
      } finally {
        setSearching(false);
      }
    },
    [t],
  );

  const install = useCallback(
    async (pkg: string) => {
      setInstalling(pkg);
      setInstallError(null);
      setCapabilityIssue(null);
      try {
        const res = await fetch("/api/skills/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg, scope, cwd }),
        });
        const d = (await res.json()) as {
          success?: boolean;
          error?: string;
          code?: string;
          capability?: string;
        };
        if (!res.ok || d.error) {
          const issue = parseCapabilityIssue(d);
          if (issue) {
            setPendingInstallPackage(pkg);
            setCapabilityIssue(issue);
          } else {
            setInstallError(
              safeInstallError(
                d.error,
                t("httpErrorStatus", "HTTP {status}").replace("{status}", String(res.status)),
                t,
              ),
            );
          }
          return;
        }
        setPendingInstallPackage(null);
        setInstalledPkgs((prev) => new Set(prev).add(pkg));
        onInstalled();
      } catch (e) {
        setInstallError(
          safeInstallError(
            e instanceof Error ? e.message : String(e),
            t("skillInstallationFailed", "Skill installation failed."),
            t,
          ),
        );
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd, t],
  );

  const installPath = scope === "global" ? "~/.pi/agent/skills/" : `${shortenPath(cwd)}/.pi/agent/skills/`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Header area ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: "var(--text-body-lg)", fontWeight: 600, color: "var(--text)" }}>
          {t("addSkill", "Add skill")}
        </div>

        {/* Search row */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="search"
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search(query);
            }}
            placeholder={t("skillSearchExample", "e.g. react, testing, deploy")}
            aria-label={t("searchSkills", "Search skills")}
            style={{
              flex: 1,
              minHeight: 36,
              padding: "8px 12px",
              fontSize: "var(--text-body)",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              color: "var(--text)",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => search(query)}
            disabled={searching || !query.trim()}
            style={{
              minHeight: 36,
              padding: "8px 16px",
              fontSize: "var(--text-body)",
              borderRadius: "var(--radius-control)",
              border: "none",
              background: "var(--btn-bg)",
              color: "var(--btn-fg)",
              cursor: searching || !query.trim() ? "not-allowed" : "pointer",
              opacity: searching || !query.trim() ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {searching ? t("searching", "Searching…") : t("search", "Search")}
          </button>
        </div>

        {/* Scope + install path row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              display: "flex",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: "var(--text-label)",
              flexShrink: 0,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                style={{
                  padding: "4px 12px",
                  border: "none",
                  cursor: "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  borderRight: s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {sourceLabelText(s, t)}
              </button>
            ))}
          </div>
          <span
            style={{
              fontSize: "var(--text-label)",
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            → {installPath}
          </span>
        </div>

        {/* Errors */}
        {searchError && <div style={{ fontSize: "var(--text-label)", color: "var(--danger)" }}>{searchError}</div>}
        {capabilityIssue && pendingInstallPackage && (
          <CapabilityRequired
            issue={capabilityIssue}
            cwd={cwd}
            onContinue={() => install(pendingInstallPackage)}
            onCancel={() => {
              setCapabilityIssue(null);
              setPendingInstallPackage(null);
            }}
          />
        )}
        {installError && (
          <div style={{ fontSize: "var(--text-label)", color: "var(--danger)", wordBreak: "break-word" }}>
            {installError}
          </div>
        )}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {results.map((r) => {
            const isInstalled = installedPkgs.has(r.package);
            const isInstalling = installing === r.package;
            // split "owner/repo@skill" for cleaner display
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div
                key={r.package}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* skill name prominent */}
                  <div
                    style={{
                      fontSize: "var(--text-body)",
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 4,
                    }}
                  >
                    {skillpart ?? repopart}
                  </div>
                  {/* repo + installs + link row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-meta)",
                        color: "var(--text-dim)",
                      }}
                    >
                      {repopart}
                    </span>
                    {r.installs > 0 && (
                      <span
                        style={{
                          fontSize: "var(--text-label)",
                          color: "var(--text-muted)",
                          fontWeight: 500,
                        }}
                      >
                        {t("skillInstallCount", "{count} installs").replace(
                          "{count}",
                          formatCompactNumber(r.installs, language),
                        )}
                      </span>
                    )}
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: "var(--text-label)",
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        {t("skillsCatalogLink", "skills.sh ↗")}
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => !isInstalled && !isInstalling && install(r.package)}
                  disabled={isInstalled || isInstalling || installing !== null}
                  style={{
                    flexShrink: 0,
                    padding: "4px 16px",
                    fontSize: "var(--text-label)",
                    fontWeight: 500,
                    borderRadius: "var(--radius-control)",
                    border: "1px solid var(--border)",
                    cursor: isInstalled || isInstalling || installing !== null ? "not-allowed" : "pointer",
                    background: isInstalled ? "rgba(34,197,94,0.1)" : "none",
                    color: isInstalled ? "var(--success)" : isInstalling ? "var(--accent)" : "var(--text-muted)",
                    transition: "color 0.12s",
                  }}
                >
                  {isInstalled
                    ? t("skillInstalled", "✓ Installed")
                    : isInstalling
                      ? t("installing", "Installing…")
                      : t("install", "Install")}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        !searchError &&
        !searching && (
          <div style={{ fontSize: "var(--text-body)", color: "var(--text-dim)", lineHeight: 1.8 }}>
            {t("searchSkillsCatalogPrefix", "Search")}{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              {t("skillsCatalogName", "skills.sh")}
            </a>{" "}
            {t("searchSkillsCatalogSuffix", "to discover and install skills for your agent.")}
          </div>
        )
      )}
    </div>
  );
}
