/**
 * 离线资产检查 —— 原 offline-assets.test.mjs 迁入（切片四批，2026-10-13）。
 *
 * 规则：生产渲染器必须是完全离线的——样式与字体只能来自随包分发的文件，
 * 不得引用任何运行时 CDN。KaTeX 的 CSS 必须从已安装的包里打包带走，
 * 数学字体的 url() 必须指向包内的相对路径。
 * 这些是打包/供应链约束，没有可观察的运行时行为，故属静态安全检查。
 */
export function offlineAssetSecurityChecks(read) {
  const html = read("src/renderer/index.html");
  const main = read("src/renderer/main.tsx");
  const katexCss = read("node_modules/katex/dist/katex.min.css");
  const protocol = read("src/main/protocol.ts");
  const appCsp = protocol.slice(protocol.indexOf("const CSP ="), protocol.indexOf("const HTML_PREVIEW_CSP"));

  return [
    [
      !/https?:\/\//i.test(html),
      "renderer index.html must not reference absolute http(s) URLs (the app ships fully offline)",
    ],
    [
      /import\s+["']katex\/dist\/katex\.min\.css["']/.test(main),
      "renderer must load KaTeX CSS from the installed package, not a runtime CDN link",
    ],
    [/@font-face/.test(katexCss), "packaged KaTeX CSS must embed its math font faces"],
    [
      /url\(fonts\/KaTeX_[^)]+\.woff2\)/.test(katexCss),
      "packaged KaTeX CSS must reference in-package woff2 font files",
    ],
    [
      !/fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net/.test(appCsp),
      "renderer CSP must not allow external font or CDN origins",
    ],
    [/style-src 'self' app:/.test(appCsp), "renderer CSP must restrict styles to packaged sources"],
    [/font-src 'self' app: data:/.test(appCsp), "renderer CSP must restrict fonts to packaged sources"],
  ];
}
