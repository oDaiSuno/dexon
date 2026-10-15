import path from "node:path";
import { createRequire } from "node:module";

/**
 * 装配「真实渲染模块图」的共用测试工具。
 *
 * 消息渲染域的行为测试必须加载真实的组件图（MarkdownBody 及其全部自家依赖：
 * 主题、词典、markdown 插件、语法高亮策略、mermaid 渲染器……），禁止用 stub
 * 替换自家模块（见 tests/README.md 宪法与 mock 白名单）。本工具把装配规则
 * 固化成一处：
 *
 * 1. 自家代码照常打包，路径别名走项目 tsconfig；
 * 2. npm 包一律标记为 external，由 Node 真实导入——react-markdown、remark
 *    插件、react-syntax-highlighter 都是真实包，与生产同一份代码；
 * 3. mermaid 与 refractor（代码高亮语言库）在真实实现里本来就躲在动态导入
 *    之后：不渲染流程图/不渲染代码块的测试永远不会加载它们；
 * 4. 唯一的路径修正：react-syntax-highlighter 的两个样式文件在生产源码里按
 *    打包器习惯写成了无扩展名路径，Node 的模块规则要求最终导入路径带扩展名。
 *    插件只是把这两个路径规范成真实存在的 .js 文件——没有替换任何实现。
 *    （曾尝试在生产源码里直接补 .js，但 @types 只为无扩展名写法提供声明，
 *    会破坏 typecheck；所以规范化属于测试装配层，不属于生产代码。）
 * 5. 环境常量：生产由 Vite 在打包时注入 import.meta.env.DEV；测试装配用
 *    esbuild 的 define 做同一件事（声明“生产形态构建”），SessionProfiler 的
 *    顶层常量随之成为字面量 false，不再触碰 window。这不是替换实现，
 *    而是完成构建器本来要做的常量替换。
 */
export function realRendererGraphOptions(projectRoot, overrides = {}) {
  const require = createRequire(path.join(projectRoot, "package.json"));
  return {
    packages: "external",
    loader: { ".png": "dataurl", ".css": "empty", ...overrides.loader },
    tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
    define: {
      "import.meta.env.DEV": "false",
      "import.meta.env.MODE": '"production"',
      "import.meta.env.PROD": "true",
      ...overrides.define,
    },
    plugins: [
      {
        name: "node-esm-deep-import-extension",
        setup(build) {
          // The icon package also uses extensionless relative ESM imports.
          // Bundle its real files while keeping React itself external.
          build.onResolve({ filter: /^@lobehub\/icons\/es\// }, (args) => ({
            path: require.resolve(`${args.path}.js`),
          }));
          build.onResolve(
            { filter: /react-syntax-highlighter\/dist\/esm\/styles\/prism\/(vs|vsc-dark-plus)$/ },
            (args) => ({ path: `${args.path}.js`, external: true }),
          );
        },
      },
    ],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "define" && key !== "loader")),
  };
}
