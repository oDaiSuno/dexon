import postcss from "postcss";
import ts from "typescript";

const HEX = /(?<![\w&#])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const COLOR_FUNCTION =
  /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?:[-+.\d]|srgb|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz)[^)]*\)/gi;
const TAILWIND_PALETTE =
  /(?<![\w-])(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|shadow|decoration|accent|caret|placeholder)-(?:(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-(?:50|[1-9]00|950)|white|black)(?:\/\d+)?(?![\w-])/g;
const COLOR_PROPERTY =
  /color|background|border|outline|fill|stroke|shadow|filter|caret|accent|decoration|columnrule|column-rule/i;

const NAMED_COLORS = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];
const NAMED_COLOR = new RegExp(`(?<![\\w-])(?:${NAMED_COLORS.join("|")})(?![\\w-])`, "gi");

const normalize = (literal) =>
  literal
    .toLowerCase()
    .replace(/\s*([(),/])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

function matchesIn(text, patterns) {
  const found = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[0]);
  }
  return found;
}

function propertyNameOf(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function styleContextOf(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isConditionalExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isTemplateExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isAsExpression(parent) ||
      (ts.isBinaryExpression(parent) && parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
    ) {
      current = parent;
      continue;
    }
    if (ts.isPropertyAssignment(parent)) return propertyNameOf(parent.name);
    if (ts.isJsxAttribute(parent) || ts.isJsxExpression(parent)) {
      const attribute = ts.isJsxAttribute(parent) ? parent : parent.parent;
      return attribute && ts.isJsxAttribute(attribute) ? attribute.name.getText() : null;
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return propertyNameOf(parent.left);
    }
    if (ts.isCallExpression(parent) && parent.arguments[1] === current) {
      const [first] = parent.arguments;
      return first && ts.isStringLiteralLike(first) ? first.text : null;
    }
    return null;
  }
  return null;
}

function isModuleSpecifier(node) {
  const parent = node.parent;
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) ||
    ts.isLiteralTypeNode(parent)
  );
}

function scanScript(relative, source) {
  const kind = relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, kind);
  const findings = [];
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      !isModuleSpecifier(node)
    ) {
      const patterns = [HEX, COLOR_FUNCTION, TAILWIND_PALETTE];
      const property = styleContextOf(node);
      if (property && COLOR_PROPERTY.test(property)) patterns.push(NAMED_COLOR);
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      for (const raw of matchesIn(node.text, patterns)) findings.push({ file: relative, line, color: normalize(raw) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

function scanStylesheet(relative, source) {
  const findings = [];
  postcss.parse(source, { from: relative }).walk((node) => {
    const line = node.source?.start?.line ?? 0;
    if (node.type === "decl") {
      const patterns = [HEX, COLOR_FUNCTION];
      if (node.prop.startsWith("--") || COLOR_PROPERTY.test(node.prop)) patterns.push(NAMED_COLOR);
      for (const raw of matchesIn(node.value, patterns)) {
        findings.push({ file: relative, line, color: normalize(raw) });
      }
    }
    if (node.type === "atrule" && node.name === "apply") {
      for (const raw of matchesIn(node.params, [TAILWIND_PALETTE])) {
        findings.push({ file: relative, line, color: normalize(raw) });
      }
    }
  });
  return findings;
}

function scanMarkup(relative, source) {
  const findings = [];
  source
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "))
    .split("\n")
    .forEach((text, index) => {
      for (const raw of matchesIn(text, [HEX, COLOR_FUNCTION])) {
        findings.push({ file: relative, line: index + 1, color: normalize(raw) });
      }
    });
  return findings;
}

export function scanColorLiterals(relative, source) {
  if (relative.endsWith(".css")) return scanStylesheet(relative, source);
  if (relative.endsWith(".html")) return scanMarkup(relative, source);
  return scanScript(relative, source);
}
