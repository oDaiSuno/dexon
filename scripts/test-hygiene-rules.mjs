import ts from "typescript";

const OWN_SOURCE_EXT = /\.(?:ts|tsx|css|html|ya?ml|mjs)(?:["'`]|$)/;
const EXTERNAL_MODULE_FILTER = /electron|pi-coding-agent|pi-ai|typebox|^\/\^node/;

export function parseTestSupport(source) {
  return ts.createSourceFile("test-support.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

export function relativeTestImports(source) {
  const ast = parseTestSupport(source);
  const imports = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports.filter((name) => name.startsWith(".") && name.endsWith(".mjs"));
}

export function findTestHygieneViolations(source) {
  const ast = parseTestSupport(source);
  const hits = new Set();
  const sourceUrls = new Set();
  const sourceReaders = new Set();
  const queriedElements = new Set();
  const text = (node) => node?.getText(ast) ?? "";
  const propertyName = (node) => (ts.isPropertyAccessExpression(node) ? node.name.text : text(node));
  const hasNamespace = (node) => {
    let found = false;
    const visit = (child) => {
      if (ts.isPropertyAssignment(child) && text(child.name) === "namespace") found = true;
      ts.forEachChild(child, visit);
    };
    if (node) visit(node);
    return found;
  };
  const gather = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ["querySelector", "getElementById"].includes(propertyName(node.initializer.expression))
    ) {
      queriedElements.add(text(node.name));
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isNewExpression(node.initializer ?? ast) &&
      text(node.initializer.expression) === "URL"
    ) {
      if (OWN_SOURCE_EXT.test(text(node.initializer.arguments?.[0]))) sourceUrls.add(text(node.name));
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionDeclaration(node)) && /new URL\(\s*\w+\s*,/.test(text(node))) {
      const name = node.name ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name : null);
      if (name) sourceReaders.add(text(name));
    }
    ts.forEachChild(node, gather);
  };
  gather(ast);
  const visit = (node) => {
    const privateKey = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : "";
    if (privateKey.startsWith("__reactProps$")) hits.add("react-private-event-access");
    if (ts.isPropertyAccessExpression(node) && node.name.text === "$$typeof")
      hits.add("component-implementation-marker");
    if (ts.isCallExpression(node)) {
      const name = propertyName(node.expression);
      if (/ForTests?$/.test(name)) hits.add("test-only-introspection");
      const first = node.arguments[0];
      const argument = text(first);
      if (
        text(node.expression) === "assert.equal" &&
        ts.isNumericLiteral(node.arguments[1] ?? ast) &&
        Number(node.arguments[1].text) > 0
      ) {
        // Deliberately narrow: zero after disposal and a support tracker's
        // documented public contents remain legitimate observations.
        if (
          /^(?:timers\.length|(?:h\.)?(?:env|harness)\.[\s\S]*(?:Observers\.length|Listeners[\s\S]*\.length|EventHandlers\.length|rafSize\(\)))$/.test(
            argument,
          )
        ) {
          hits.add("active-resource-count");
        }
        const domCount = argument.match(/^(\w+)\.(?:children\.length|childNodes\.length|childElementCount)$/);
        if (domCount && queriedElements.has(domCount[1])) hits.add("dom-structure-count");
      }
      if (name === "startsWith" && ts.isStringLiteralLike(first ?? ast) && first.text === "__reactProps$")
        hits.add("react-private-event-access");
      if (/^read(?:File(?:Sync)?)?$/.test(name) && /new URL\(/.test(argument) && OWN_SOURCE_EXT.test(argument))
        hits.add("url-source-read");
      if (/^readFile(?:Sync)?$/.test(name) && sourceUrls.has(argument)) hits.add("url-variable-read");
      if (
        /^readFile(?:Sync)?$/.test(name) &&
        /path\.(?:join|resolve)\(/.test(argument) &&
        OWN_SOURCE_EXT.test(argument)
      )
        hits.add("path-source-read");
      if (["readStylePartial", "readRendererCssSources", "stylePartialNames", "rendererCssImportOrder"].includes(name))
        hits.add("css-source-helper");
      if (sourceReaders.has(name) && OWN_SOURCE_EXT.test(argument)) hits.add("read-helper-forward");
      if (name === "onResolve") {
        const filter = ts.isObjectLiteralExpression(first ?? ast)
          ? first.properties.find((property) => ts.isPropertyAssignment(property) && text(property.name) === "filter")
              ?.initializer
          : null;
        if (hasNamespace(node.arguments[1]) && !EXTERNAL_MODULE_FILTER.test(text(filter)))
          hits.add("own-module-replacement");
      }
      if (/globalThis\.__\w+\.push$/.test(text(node.expression))) hits.add("global-recording-trail");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...hits].sort();
}
