import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ledgerFile = "scripts/design-debt/sync-io-ledger.json";
const symbols = new Set([
  "existsSync",
  "statSync",
  "lstatSync",
  "realpathSync",
  "readFileSync",
  "writeFileSync",
  "readdirSync",
  "mkdirSync",
  "renameSync",
  "unlinkSync",
  "rmSync",
  "rmdirSync",
  "openSync",
  "readSync",
  "closeSync",
  "accessSync",
  "copyFileSync",
  "chmodSync",
  "appendFileSync",
  "readlinkSync",
  "truncateSync",
  "writeSync",
  "fsyncSync",
]);
const fsModules = new Set(["fs", "node:fs"]);
const keyOf = ({ file, symbol }) => `${file}\u0000${symbol}`;

function sourceFiles(root) {
  const files = [];
  const walk = (directory) => {
    if (!existsSync(path.join(root, directory))) return;
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (file.includes("test-support")) continue;
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|mjs)$/.test(file) && !/\.test\./.test(file) && entry.name !== "schema-cases.mjs")
        files.push(file);
    }
  };
  walk("src/agent-host");
  if (existsSync(path.join(root, "src/shared/worktree.ts"))) files.push("src/shared/worktree.ts");
  return files.sort();
}

function origins(checker) {
  const imported = new Map();
  const bind = (name, origin) => {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol) imported.set(symbol, origin);
  };
  const gather = (node) => {
    if (ts.isImportDeclaration(node) && fsModules.has(node.moduleSpecifier.text) && !node.importClause?.isTypeOnly) {
      const clause = node.importClause;
      if (clause?.name) bind(clause.name, "fs");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) bind(bindings.name, "fs");
      if (bindings && ts.isNamedImports(bindings)) {
        for (const entry of bindings.elements) {
          const name = (entry.propertyName ?? entry.name).text;
          if (!entry.isTypeOnly && (symbols.has(name) || name === "default"))
            bind(entry.name, name === "default" ? "fs" : name);
        }
      }
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      fsModules.has(node.moduleReference.expression?.text)
    )
      bind(node.name, "fs");
    ts.forEachChild(node, gather);
  };
  const originOf = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return undefined;
    seen = new Set(seen).add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAwaitExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return originOf(node.expression, seen);
    if (ts.isIdentifier(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (imported.has(symbol)) return imported.get(symbol);
      for (const declaration of symbol?.declarations ?? []) {
        if (ts.isVariableDeclaration(declaration)) return originOf(declaration.initializer, seen);
        if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
          if (originOf(declaration.parent.parent.initializer, seen) === "fs") {
            const name = (declaration.propertyName ?? declaration.name).text;
            return symbols.has(name) ? name : undefined;
          }
        }
        if (ts.isParameter(declaration)) {
          const fn = declaration.parent;
          const call = fn.parent;
          if (
            ts.isCallExpression(call) &&
            ts.isPropertyAccessExpression(call.expression) &&
            call.expression.name.text === "then" &&
            originOf(call.expression.expression, seen) === "fs" &&
            fn.parameters[0] === declaration
          )
            return "fs";
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (
        (expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(expression) &&
            expression.text === "require" &&
            !checker.getSymbolAtLocation(expression)?.declarations?.length)) &&
        fsModules.has(node.arguments[0]?.text)
      )
        return "fs";
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = originOf(node.expression, seen);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression?.text;
      if (base === "fs") return symbols.has(name) ? name : name === "default" ? "fs" : undefined;
      if (symbols.has(base) && ["native", "bind", "call", "apply"].includes(name)) return base;
    }
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)
    ) {
      const left = originOf(node.left, seen);
      return left === originOf(node.right, seen) ? left : undefined;
    }
    return undefined;
  };
  return { gather, originOf };
}

function isDeclarationName(node) {
  const parent = node.parent;
  return (
    (parent.name === node && !ts.isShorthandPropertyAssignment(parent)) ||
    (ts.isBindingElement(parent) && parent.propertyName === node)
  );
}

export function scanSyncIo(root = repository) {
  const files = sourceFiles(root);
  const sources = new Map(
    files.map((file) => {
      const absolute = path.resolve(root, file);
      return [absolute, ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true)];
    }),
  );
  const options = { noResolve: true, noLib: true, allowJs: true, types: [] };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (file) => sources.get(path.resolve(file));
  host.readFile = (file) => sources.get(path.resolve(file))?.text;
  const program = ts.createProgram([...sources.keys()], options, host);
  const { gather, originOf } = origins(program.getTypeChecker());
  for (const source of sources.values()) gather(source);
  const findings = [];
  for (const file of files) {
    const source = sources.get(path.resolve(root, file));
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isTypeNode(node)) return;
      if (ts.isCallExpression(node)) {
        const symbol = originOf(node.expression);
        if (symbols.has(symbol)) {
          findings.push({
            file,
            symbol,
            line: source.getLineAndCharacterOfPosition(node.expression.getStart(source)).line + 1,
          });
          for (const argument of node.arguments) visit(argument);
          return;
        }
      }
      if (!isDeclarationName(node)) {
        const symbol = originOf(node);
        if (symbols.has(symbol) && ts.isVariableDeclaration(node.parent) && node.parent.initializer === node) return;
        if (symbols.has(symbol)) {
          findings.push({ file, symbol, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }
  return findings;
}

export function checkSyncIo({ root = repository, ledger } = {}) {
  const failures = [];
  const registered = new Map();
  const entries = ledger ?? JSON.parse(readFileSync(path.join(root, ledgerFile), "utf8"));
  if (!Array.isArray(entries)) return [`${ledgerFile} 必须是同步文件读写清单数组`];
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.file !== "string" ||
      !symbols.has(entry.symbol) ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 1
    ) {
      failures.push(`${ledgerFile} 有无效条目：必须填写文件、同步函数和正整数次数；零次请删掉整条`);
      continue;
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim())
      failures.push(`${entry.file} 的 ${entry.symbol} 必须登记保留原因`);
    const key = keyOf(entry);
    if (registered.has(key)) failures.push(`${entry.file} 的 ${entry.symbol} 在 ${ledgerFile} 重复登记`);
    registered.set(key, entry);
  }
  const found = new Map();
  for (const finding of scanSyncIo(root)) {
    const key = keyOf(finding);
    const entry = found.get(key) ?? { ...finding, lines: [] };
    entry.lines.push(finding.line);
    found.set(key, entry);
  }
  for (const [key, entry] of found) {
    const allowance = registered.get(key)?.count ?? 0;
    if (entry.lines.length > allowance)
      failures.push(
        `${entry.file}:${entry.lines.join(",")} 的 ${entry.symbol} 有 ${entry.lines.length} 处，清单只允许 ${allowance} 处：改用 node:fs/promises，不要提高同步读写限额`,
      );
  }
  for (const [key, entry] of registered) {
    const actual = found.get(key)?.lines.length ?? 0;
    if (actual < entry.count)
      failures.push(
        `${entry.file} 的 ${entry.symbol} 已从 ${entry.count} 处减到 ${actual} 处：把 ${ledgerFile} 中的次数降至 ${actual}${actual === 0 ? "，并删掉这条" : ""}`,
      );
  }
  return failures;
}
