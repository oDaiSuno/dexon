# 聊天内页 UI 重设计计划 · Beautiful UI 视觉 + transitions.dev 动效

> 状态：**已实施完成**（2026-09-02）。
> 决策记录：范围 = 消息组件 + 欢迎页（composer 仅配色适配）；视觉 = Beautiful UI 语言（预览：`.artifacts/ui-redesign/preview-bui.html`）；动效 = transitions.dev 体系，关键时刻深度；流式文字 = transitions.dev streaming-text 词级/字级完整落地（用户确认）。

---

## 1. 范围（已交付）

**在范围内（全部完成）**

- 消息渲染组件：用户气泡、助手正文、流式状态、思考块、工具调用块、diff 视图、过程折叠组、compaction/extension 面板、失败提示
- 欢迎页（新会话空状态）
- 聊天区背景（网格纸 → 冷灰斜纹）
- 动效体系：transitions.dev motion tokens + 关键时刻动效

**不在范围内（未动）**

- ChatInput composer 的结构与逻辑（仅通过作用域令牌别名完配色适配）
- 小地图、右侧面板、侧边栏、分支导航器
- 任何数据流/会话/滚动/分支逻辑

---

## 2. 样式熵收敛结果

| 维度         | 实施前                  | 实施后                                                                           |
| ------------ | ----------------------- | -------------------------------------------------------------------------------- |
| 消息组件字号 | 8 档裸值（10–14）       | 6 档命名档（11 / 11.5 / 12 / 12.5 / 13 / 13.5，全部经 `scaledChatFont`，无裸值） |
| 圆角         | 12 种                   | 3 档令牌（chip 6 / control 8 / card 10）+ 气泡 12/4 + 胶囊 999                   |
| t/s 速度徽章 | 4 处硬编码 hex          | 主题语义色圆点（green/orange/red 分档）+ mono 文字                               |
| 动效时长     | 9 种 ad-hoc             | transitions.dev 五维令牌，触达文件 0 处 ad-hoc                                   |
| 组件文件     | MessageView.tsx 1958 行 | messages/ 目录 9 文件，最大 493 行                                               |
| 硬编码色     | t/s 徽章 + 通知条 3 处  | 0（通知条走语义变量）                                                            |

> 字号说明：Beautiful UI 参考系本身使用 10.5–13.5px 细分字阶，故采用 6 档命名档而非最初计划的 4 档；全部有名有义（micro/chip/meta/label/body/bubble），无任意值。

---

## 3. 交付明细（全部已勾选）

### A. 结构预重构

- [x] **A1.** MessageView.tsx（1958 行）拆分为 `messages/`：`shared` / `UserMessage` / `AssistantMessage` / `ThinkingBlock` / `ToolCallBlock` / `DiffViews` / `SystemMessages` / `tool-labels`；MessageView 仅 105 行调器。零行为变化，全测试通过。

### B. 视觉重构（Beautiful UI）

- [x] **B1.** 网格纸 + 四角刻度线移除；画布改为 `#f5f5f5` 上的 45° 斜向发丝条纹（暗色 `#1b1c1e`）
- [x] **B2.** 用户气泡：软灰 `--bui-field` + 1px 描边 + 12px 圆角尾角 4px + 墨色文字；渠道气泡（weixin/telegram/feishu）保留品牌色白字
- [x] **B3.** 助手正文去卡片化：无框直排，行高 1.7
- [x] **B4.** 流式元信息行：mono 模型名 + `N tok` + 速度圆点（≥50 绿 / ≥15 橙 / <15 红）+ `t/s`；流式文字按 streaming-text 词级/字级浮现（定型部分 Markdown 渲染 + 尾部 token 逐个 `stream-in`，以字符偏移为 key 防重播），圆点光标
- [x] **B5.** 思考块：星形图标 + shimmer「思考中」→ 结算「思考了 {n} 秒」，左侧 1px 细线引文迹线，手风琴展开
- [x] **B6.** 工具调用：动词标签（读取/编辑/运行…，未知工具回退原名）+ mono 参数芯片 + 耗时/±行数元信息；hover 图标交叉淡出为箭头；展开为左侧细线详情（入参/结果/diff 白卡）；错误态 danger 语义色
- [x] **B7.** 过程折叠组：同语言手风琴 + tabular-nums 计数
- [x] **B8.** compaction / extension / 失败提示统一块令牌；失败用 red-tint
- [x] **B9.** 欢迎页：居中构图图标 + 名称 + 问候语 i18n），交错浮现入场
- [x] **B10.** 悬停操作：复制按钮图标化 24px，fork/编辑小胶囊，统一 `--duration-quick`
- [x] **B11.** composer：作用域内别名应用级暖色变量到 BUI 冷灰系（`--border/--bg-panel/--text*/--accent/--bg-hover…`），零逻辑改动全量跟随

### C. 动效时刻（transitions.dev，全部带 prefers-reduced-motion 降级）

- [x] **C1.** 手风琴（21）：思考/工具/过程组/compaction，`grid-rows 0fr↔1fr` + 内容延迟卸载（`useDelayedUnmount`：展开即挂载，收起播完 350ms 再卸载，长会话零残留成本）
- [x] **C2.** 工具状态变形（41-spinner-check-morph 改造）：spinner → 对勾描边 + 弹性 pop（1.1s 后沉淀为工具图标）；错误 → 红色 ×；无 auto-revert；完成后重挂载不重播
- [x] **C3.** 欢迎页交错浮现（18-texts-reveal，纯 CSS stagger）
- [x] **C4.** 思考中 shimmer（15-shimmer-text）+ 等待模型阶段的 shimmer
- [x] **C5.** 流式文字（30-streaming-text 完整落地，见 B4）
- [x] **C6.** 悬停操作令牌化
- [x] **C7.** 通知条色点 → 语义变量
- [x] **C8.** motion tokens + Beautiful UI keyframe 集安装于 `chat.css`

### D. i18n

- [x] **D1.** 新增 13 对词条（thinkingActive / thoughtForDuration / toolRead–toolSearch / toolRunning / toolFailed / openInBrowser / welcomeGreeting），移除失效的 `collapsed`；`check:i18n` 1024 键全对齐

---

## 5. 验收核对结果（实施后复查）

| #   | 验收项        | 结果                                                                                                                                                                                                                |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 预重构        | ✅ MessageView 105 行；messages/ 最大文件 493 行（≤500）；`typecheck`/`lint`/`test`（898 例）/`check:i18n`/`check:desktop-security`/`smoke` 全绿                                                                    |
| 2   | 视觉落地      | ✅ 网格移除、正文无框、气泡软灰、工具轻条、diff 白卡；与已批准预览一致                                                                                                                                              |
| 3   | 令牌收敛      | ✅ 字号 6 档命名（见 §2 说明）、圆角 3 档 + 2 特例、无裸值（气泡 12/4 为 Beautiful UI 气泡规范值）                                                                                                                  |
| 4   | 动效令牌      | ✅ messages/ 与 ProcessDetailsGroup 0 处 ad-hoc 时长/缓动                                                                                                                                                           |
| 5   | 动效时刻      | ✅ C1–C8 可演示；每个都有 reduced-motion 降级（chat.css 内联块）                                                                                                                                                    |
| 6   | 硬编码色      | ✅ messages/ 内 0 处裸 hex；t/s、通知条已语义化；双主题人工核对通过                                                                                                                                                 |
| 7   | i18n          | ✅ `check:i18n` 通过                                                                                                                                                                                                |
| 8   | 行为零回归    | ✅ 展开存储/滚动策略/分支/fork/队列/deferred 加载逻辑未动；渲染契约测试（message-view / process-details-group / browser-renderer-contract / channel-message-style）全部通过（按新文件布局更新了断言目标，意图不变） |
| 9   | composer 隔离 | ✅ ChatInput.tsx 逻辑零 diff，仅经 CSS 变量别名跟随                                                                                                                                                                 |
| 10  | 文件规模      | ✅ 所有新/改文件 ≤500 行（chat.css 678 行为纯样式表，非组件）                                                                                                                                                       |

**有意取舍记录**

- JetBrains Mono：字体栈首位引用但不打包依赖（依赖契约约束）；用户安装该字体后自动生效，否则回退系统等宽。
- 流式尾部以「最后一个换行」为界：定型部分走 Markdown 渲染，尾部 token 纯文本浮现，行完成后并入 Markdown——与业界流式渲染行为一致。
- 工具行收起时不再显示完整结果预览（错误与浏览器摘要除外），信息进入手风琴详情；这是 B6「过程退后、结果向前」的一部分。

## 6. 实施顺序（已按序完成）

1. A1 拆分 → 2. 令牌安装 → 3. B1–B4 → 4. C1+B5/B6/B7+C2 → 5. B8/B9+C3/C4/C5 → 6. B10/B11+C6/C7+D1 → 7. 双主题核对+冒烟+本文件回写
