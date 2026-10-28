# Issue 57 交接材料

基线提交：`5fb0f5b`（main）。

| 文件 | 内容 |
| --- | --- |
| `issue57-repro.test.mjs` | 复现脚本。放进 `tests/dom/` 运行：在 main 上 5 条全红，套用原型补丁后 5 条全绿。 |
| `poc.patch` | 原型补丁，基于 `5fb0f5b`，`git apply` 后即可运行。其中 `tests/dom/zz-issue57-poc.test.mjs` 是原型自带的 11 条行为检查，正式实现时请改写成正式检查文件，不要直接合入。 |
| `before-cmd-p-stacked-menus.png` | main 上侧边栏展开时按 ⌘P：每一行的菜单同时弹出，叠成一摞（真实 Electron 截图）。 |
| `after-card-under-plus.png` | 原型：点“＋”后只出现一张卡片，右边缘对齐“＋”（真实 Electron 截图）。 |
| `framer-collapse-expand-spec.jpg` / `framer-motion-notes.jpg` | Framer 分支“项目空间清单：关闭、排序、失效文件夹”里的规格截图。 |
