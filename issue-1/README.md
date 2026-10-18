# Issue #1 附件胶囊误删：截图取证

对应问题：https://github.com/oDaiSuno/dexon/issues/1

- 取证时间：2026-10-18 03:38:29 UTC。
- 源码版本：`94b6d03b33e39d37b2ef50629abe181fa2d28b4e`。
- 实际运行版本：Electron `43.1.1`、Chromium `150.0.7871.114`。
- 三张截图由 Electron `capturePage` 抓取真实渲染结果；对照图只是纵向拼接，没有重绘输入框内容。

## 行为要求

当图片胶囊后已有 `hello` 且光标位于文字末尾时，按一次 Backspace 应保留图片并将文字改为 `hell`。

## 取证边界

加载仓库真实的 `ComposerEditable` 与 `interactive.css`，在隔离的 Electron 窗口中通过公开插入接口加入示例图片胶囊，再通过原生 `sendInputEvent` 输入文字及退格。

只观察公开组件的可见内容、公开 getValue 返回值和浏览器选区。不调用内部事件处理函数，不修改生产代码，不加载实际聊天数据，也不调用截图暂存或发送服务。

截图中的图片是本地生成的示例素材；外层标题、步骤和状态栏是取证页面，不是完整 Dexon 界面。运行结果与版本记录在 result.json。

## 输出

- 01-before-backspace.png：图片 + hello，光标在末尾。
- 02-after-one-backspace.png：按一次 Backspace 后的实际内容。
- 03-after-two-backspaces.png：再按一次 Backspace 后的实际内容。
- comparison.png：上述真实截图的纵向拼接，仅用于对照。

## 实际结果

| 操作 | 公开 getValue 返回值 | 浏览器光标位置 |
| --- | --- | --- |
| 插入图片并输入 hello | `@/tmp/shot.png hello` | 文字节点内偏移 6 |
| 按一次 Backspace | `hello` | 输入框起点，偏移 0 |
| 再按一次 Backspace | `hello` | 输入框起点，偏移 0 |

`result.json` 中的 `reproduced: true` 表示故障被重新复现，不表示修复通过。

本次取证期间曾因页面未加载构建生成的生产样式而拒收第一组截图；修正取证页面后重新运行。此分支只收录正确加载生产样式后的截图和记录，不含拒收内容。

这不是完整应用端到端验收，也不是修复后的通过证据。
