# Issue #46 证据：过长提问自动收起

这是复现和实验材料，**不是功能实现**，不要合并到 main。

- 源码版本：`a8c65fa`（main）
- 实际运行环境：Electron 43.1.1、Chromium 150.0.7871.114、macOS arm64，窗口 1280×860
- 运行方式：在独立的 Electron 窗口里加载仓库真实的 `ChatWindow`，样式和正式版完全相同，对话数据由测试替身提供

## 一键运行

```bash
git fetch origin evidence/issue-46-long-prompt
git checkout origin/evidence/issue-46-long-prompt -- evidence/issue-46
node evidence/issue-46/run.mjs
```

结果写到 `evidence/issue-46/out/`：`evidence.json` 是 38 项测量，`*.png` 是截图。
`ro-observe-self`、`ro-observe-inner` 两项故意制造了 2 条 `ResizeObserver loop` 报错，用来做对比；整次运行只有在**恰好**出现这 2 条时才算通过。

## 文件

| 文件 | 用途 |
| --- | --- |
| `renderer.mjs` | 挂载真实聊天窗口：1 条 60 行的长提问 + 30 轮问答；提供所有测量函数 |
| `harness.mjs` | 依次执行每个场景，并记录结果 |
| `run.mjs` | 复用 `scripts/renderer-electron-check.mjs` 完成构建和运行 |
| `design/` | Framer 分支「长消息气泡：自动折叠与展开」里 `Long Message` 组件的两个状态截图 |
