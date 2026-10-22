import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const LOCALIZED_OWNER_SUFFIXES = [
  "components/session-sidebar/worktree-switcher.tsx",
  "components/session-sidebar/worktree-remove-confirm.tsx",
  "components/session-sidebar/session-tree-item.tsx",
  "components/session-sidebar/session-item.tsx",
  "components/session-sidebar/session-item-actions.tsx",
  "components/session-sidebar/session-status-indicators.tsx",
  "components/session-sidebar/path-label.tsx",
  "components/session-sidebar/animated-dropdown.tsx",
  "components/session-sidebar/session-groups.tsx",
  "components/session-sidebar/session-row-status.tsx",
  "components/app-shell/session-breadcrumb.tsx",
  "components/messages/session-links.tsx",
  "components/settings/session-orchestration-settings.tsx",
  "components/app-nav/nav-sidebar.tsx",
  "components/app-nav/nav-space-menu.tsx",
  "components/app-nav/nav-history.tsx",
  "components/app-nav/resource-page.tsx",
  "components/FileViewer.tsx",
  "components/file-viewer/audio-viewer.tsx",
  "components/file-viewer/diff-segments.ts",
  "components/file-viewer/diff-view.tsx",
  "components/file-viewer/document-viewer.tsx",
  "components/file-viewer/download-link.tsx",
  "components/file-viewer/file-api-url.ts",
  "components/file-viewer/html-preview.tsx",
  "components/file-viewer/image-viewer.tsx",
  "components/file-viewer/text-file-content.tsx",
  "components/file-viewer/text-file-viewer.tsx",
  "components/file-viewer/text-mode-toggles.tsx",
  "components/file-viewer/types.ts",
  "components/file-viewer/use-blob-src.ts",
  "components/file-viewer/use-document-preview.ts",
  "components/file-viewer/use-file-watch.ts",
  "components/file-viewer/use-text-file.ts",
  "components/file-viewer/watch-indicator.tsx",
  "components/FileExplorer.tsx",
  "components/AppShell.tsx",
  "components/app-shell/top-bar.tsx",
  "components/app-shell/session-info-popover.tsx",
  "components/app-shell/right-panel-dock.tsx",
  "components/app-shell/sidebar-content.tsx",
  "components/app-shell/chat-placeholder.tsx",
  "components/SkillsConfig.tsx",
  "components/skills/skill-toggle.tsx",
  "components/skills/skill-detail.tsx",
  "components/skills/add-skill-panel.tsx",
  "components/skills/skill-list.tsx",
  "components/skills/unsaved-skill-prompt.tsx",
  "components/PluginsConfig.tsx",
  "components/plugins/plugin-controls.tsx",
  "components/plugins/resource-list.tsx",
  "components/plugins/add-plugin-panel.tsx",
  "components/plugins/package-detail.tsx",
  "components/plugins/plugin-list.tsx",
  "hooks/useAgentSession.ts",
];
const VISIBLE_ATTRIBUTE_NAMES = new Set(["title", "aria-label", "aria-valuetext", "placeholder", "alt"]);

export function checkRendererI18n({ root, rendererRoot, dictionaryPaths }) {
  const failures = [];
  const translations = new Map();

  for (const file of rendererSourceFiles(rendererRoot, dictionaryPaths)) {
    const sourceText = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    walk(source, (node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        !["t", "translate"].includes(node.expression.text)
      ) {
        return;
      }
      const [key, fallback] = node.arguments;
      if (!key || !fallback || !ts.isStringLiteralLike(key) || !ts.isStringLiteralLike(fallback)) {
        failures.push(`${relative(root, file)}:${lineOf(source, node)} dynamic translation key or fallback`);
        return;
      }
      const previous = translations.get(key.text);
      if (previous && previous.fallback !== fallback.text) {
        failures.push(
          `${key.text} uses inconsistent fallbacks at ${previous.location} and ${relative(root, file)}:${lineOf(source, node)}`,
        );
        return;
      }
      translations.set(key.text, {
        fallback: fallback.text,
        location: `${relative(root, file)}:${lineOf(source, node)}`,
      });
    });

    const browserFile = file.includes(`${path.sep}components${path.sep}browser${path.sep}`);
    const localizedOwner = isLocalizedOwner(root, file);
    if (browserFile || localizedOwner) {
      checkVisibleLiterals({ failures, root, file, source, browserFile });
    }
    if (localizedOwner && file.endsWith(`${path.sep}hooks${path.sep}useAgentSession.ts`)) {
      checkSessionUserFacingSinks({ failures, root, file, source });
    }
    if (browserFile) {
      checkRetiredBrowserTerminology({ failures, root, file, sourceText });
    }
  }

  const { enUS, zhCN, dictionaryFailures } = readDictionaries({ root, dictionaryPaths });
  failures.push(...dictionaryFailures);
  checkDictionaryParity(failures, enUS, zhCN);

  for (const [key, usage] of translations) {
    if (!enUS.has(key)) failures.push(`en-US is missing ${key} used at ${usage.location}`);
    if (!zhCN.has(key)) failures.push(`zh-CN is missing ${key} used at ${usage.location}`);
    if (enUS.get(key) !== usage.fallback) {
      failures.push(`${key} fallback at ${usage.location} does not match the registered en-US value`);
    }
  }
  for (const key of enUS.keys()) {
    if (!translations.has(key)) failures.push(`dictionary key ${key} has no static Renderer translation call`);
  }

  return { failures, keyCount: translations.size };
}

function rendererSourceFiles(directory, dictionaryPaths, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) rendererSourceFiles(file, dictionaryPaths, result);
    else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !dictionaryPaths.includes(file)
    ) {
      result.push(file);
    }
  }
  return result.sort();
}

const DICTIONARY_NAMES = new Set(["enUS", "zhCN"]);

function importAliases(source, sourcePath) {
  // Map<alias identifier> → { propertyName, resolvedPath } for top-level named imports.
  const aliases = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const named = statement.importClause.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    const resolvedPath = path.resolve(path.dirname(sourcePath), statement.moduleSpecifier.text);
    for (const element of named.elements) {
      const propertyName = (element.propertyName ?? element.name).text;
      const alias = element.name.text; // ImportSpecifier.name is always the local binding
      aliases.set(alias, { propertyName, resolvedPath });
    }
  }
  return aliases;
}

function readDictionaries({ root, dictionaryPaths }) {
  const enUS = new Map();
  const zhCN = new Map();
  const origins = new Map();
  const failures = [];
  const found = new Set();
  const checkedPaths = new Set(dictionaryPaths.map((file) => path.resolve(file)));
  for (const dictionariesPath of dictionaryPaths) {
    const sourceText = fs.readFileSync(dictionariesPath, "utf8");
    const source = ts.createSourceFile(dictionariesPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const fileLabel = relative(root, dictionariesPath);
    const isCompositionRoot = path.basename(dictionariesPath) === "i18n-dictionaries.ts";
    const aliases = isCompositionRoot ? importAliases(source, dictionariesPath) : undefined;
    walk(source, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !DICTIONARY_NAMES.has(node.name.text))
        return;
      if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) return;
      found.add(node.name.text);
      const values = node.name.text === "enUS" ? enUS : zhCN;
      for (const property of node.initializer.properties) {
        if (ts.isSpreadAssignment(property)) {
          // Spreads are the composition-root mechanism; every spread must name a
          // top-level static import of the same language from a checked dictionary
          // file. Anything else would hide non-static entries from every check.
          const alias = ts.isIdentifier(property.expression) ? aliases?.get(property.expression.text) : undefined;
          const sourceChecked =
            !!alias && checkedPaths.has(alias.resolvedPath) && alias.propertyName === node.name.text;
          if (!(isCompositionRoot && sourceChecked)) {
            failures.push(
              `${node.name.text} contains a non-static dictionary entry at ${fileLabel}:${lineOf(source, property)}`,
            );
          }
          continue;
        }
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
          failures.push(
            `${node.name.text} contains a non-static dictionary entry at ${fileLabel}:${lineOf(source, property)}`,
          );
          continue;
        }
        const key =
          ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : undefined;
        if (!key) {
          failures.push(
            `${node.name.text} contains a dynamic dictionary key at ${fileLabel}:${lineOf(source, property)}`,
          );
          continue;
        }
        if (values.has(key)) {
          const origin = origins.get(`${node.name.text}:${key}`);
          if (origin === fileLabel) {
            failures.push(
              `${node.name.text} contains duplicate key ${key} at ${fileLabel}:${lineOf(source, property)}`,
            );
          } else {
            failures.push(`dictionary key ${key} is defined in both ${origin} and ${fileLabel}`);
          }
        }
        values.set(key, property.initializer.text);
        origins.set(`${node.name.text}:${key}`, fileLabel);
      }
    });
  }
  for (const name of DICTIONARY_NAMES) {
    if (!found.has(name)) failures.push(`dictionary ${name} was not found`);
  }
  return { enUS, zhCN, dictionaryFailures: failures };
}

function checkDictionaryParity(failures, enUS, zhCN) {
  for (const [key, english] of enUS) {
    if (!zhCN.has(key)) {
      failures.push(`zh-CN is missing ${key}`);
      continue;
    }
    const expected = placeholders(english);
    const actual = placeholders(zhCN.get(key));
    if (expected.join(",") !== actual.join(",")) {
      failures.push(`${key} placeholder mismatch: en=[${expected}] zh-CN=[${actual}]`);
    }
  }
  for (const key of zhCN.keys()) {
    if (!enUS.has(key)) failures.push(`en-US is missing ${key}`);
  }
}

function checkVisibleLiterals({ failures, root, file, source, browserFile }) {
  walk(source, (node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (/[A-Za-z]/.test(text) && !isAllowedVisibleLiteral(text, browserFile)) {
        failures.push(`${relative(root, file)}:${lineOf(source, node)} visible English JSX literal: ${text}`);
      }
      return;
    }
    if (
      ts.isJsxAttribute(node) &&
      VISIBLE_ATTRIBUTE_NAMES.has(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      /[A-Za-z]/.test(node.initializer.text) &&
      !isAllowedVisibleLiteral(node.initializer.text, browserFile)
    ) {
      failures.push(
        `${relative(root, file)}:${lineOf(source, node)} visible English JSX literal: ${node.initializer.text}`,
      );
    }
  });
}

function checkSessionUserFacingSinks({ failures, root, file, source }) {
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    const callee = node.expression.text;
    if (callee === "addNotice" || callee === "complete") {
      const object = node.arguments[0];
      if (!object || !ts.isObjectLiteralExpression(object)) return;
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : "";
        if (!["message", "error"].includes(name) || !ts.isStringLiteralLike(property.initializer)) continue;
        failures.push(
          `${relative(root, file)}:${lineOf(source, property)} hardcoded session ${name}: ${property.initializer.text}`,
        );
      }
      return;
    }
    if (["setError", "setCompactError"].includes(callee) && ts.isStringLiteralLike(node.arguments[0])) {
      failures.push(
        `${relative(root, file)}:${lineOf(source, node)} hardcoded session error: ${node.arguments[0].text}`,
      );
    }
  });
}

function checkRetiredBrowserTerminology({ failures, root, file, sourceText }) {
  for (const forbidden of ["Unsafe Lab", "不安全 Profile", "高级 / 不安全", "New unsafe Profile"]) {
    if (sourceText.includes(forbidden)) {
      failures.push(`${relative(root, file)} contains retired Browser terminology: ${forbidden}`);
    }
  }
}

function isLocalizedOwner(root, file) {
  const normalized = relative(root, file).split(path.sep).join("/");
  return LOCALIZED_OWNER_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function relative(root, file) {
  return path.relative(root, file);
}

function placeholders(value) {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]).sort();
}

function isAllowedVisibleLiteral(value, browserFile) {
  if (value === "/path/to/project") return true;
  return (
    browserFile &&
    (/^(?:Electron|Chromium|CDP|JavaScript|Profile|User-Agent|Client Hints)(?:\s+.*)?$/.test(value) ||
      /^https:\/\/example\.com$/.test(value) ||
      /^Mozilla\/5\.0 … Chrome\/\d+\.0\.0\.0 …$/.test(value) ||
      /^macOS, Windows, Linux…$/.test(value))
  );
}
