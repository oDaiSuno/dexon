# 测试规格清单 — 第 0 步（挖矿）产出

> **2026-10-15 后续状态：** 评审 1–4 项的修复已修改测试支持层及相关用例，尚未重新运行；下文历史“通过/全绿”数据不是当前工作区的通过证明。详情见 `docs/test-rebuild-review.md` 开头。评审 5–9 项不在此次修复范围。

> 本轮还修正一项证明边界：技能目录改验切换目录后旧回复不能覆盖新选择，不再把内部取消信号当作跨进程请求已取消的证据。下方最初挖矿时的用例列表保留作历史记录。

> 生成日期：2026-10-13。本文件是测试重构计划第 0 步的产出：在删除或改写任何测试之前，
> 把现有 1,390 个测试中蕴含的行为规则全部挖出来存档，作为重构期间的『活规格』对照。

## 一、基线（实测）

| 项目           | 数值                                        |
| -------------- | ------------------------------------------- |
| 测试文件       | 321 个（src 内 309 + scripts 内 12）        |
| 测试代码总行数 | 42,788 行                                   |
| 测试总数       | 1,390（通过 1,389，跳过 1，失败 0）         |
| 全套件耗时     | 22.7 秒                                     |
| 命令           | `npm test`（node --test src/**/*.test.mjs） |

套件当前全绿，退出码 0。跳过的 1 个为 Windows 专属路径（macOS 上跳过）。

## 二、结构类家族判定表（人工逐测试分析）

结构类家族最终确认为 **45 个文件**（多轮扫描+人工甄别，方法见第五节）。判定含义：

| 判定   | 含义                                                          |
| ------ | ------------------------------------------------------------- |
| 保留   | 文件里混居的真行为测试，原样留下                              |
| 删除   | 同一规则已有其他行为测试覆盖，正则版是冗余镜像                |
| 流放   | 静态约束（设计/架构/配置），移入 `check:*` 脚本，不再称为测试 |
| 转化   | 规则真实且**无**行为覆盖（孤立规则），需改写为行为测试        |
| 待确认 | 疑似有覆盖但未逐条核实，迁移时需人工确认                      |

| 文件                                                                   | 测试数 | 判定           | 依据 / 去处                                                                                                         |
| ---------------------------------------------------------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| src/renderer/App.theme.test.mjs                                        | 1      | 流放           | 令牌使用是设计约束 → check:design                                                                                   |
| src/renderer/theme-init.test.mjs                                       | 4      | 保留3 流放1    | 前3个是真行为（模块级主题初始化、注入边界依赖）；第4个是源码顺序正则 → check:build                                  |
| src/renderer/styles/css-structure.test.mjs                             | 5      | 流放           | CSS 导入顺序/无孤儿文件/行数 → check:architecture                                                                   |
| src/renderer/i18n-dictionaries-structure.test.mjs                      | 5      | 流放           | 词典分片完整性/指纹/行数 → check:i18n（该脚本已存在）                                                               |
| src/renderer/i18n-critical-ui.test.mjs                                 | 1      | 流放           | 词典值相等=数据校验；owner 用法正则=结构 → check:i18n                                                               |
| src/renderer/offline-assets.test.mjs                                   | 2      | 流放           | CSP/零CDN 是安全约束 → check:desktop-security                                                                       |
| src/renderer/semantic-colors.test.mjs                                  | 4      | 流放           | 语义色令牌覆盖是设计契约 → check:design                                                                             |
| src/renderer/theme-tokens.test.mjs                                     | 1      | 流放           | 已删令牌不得回归 → check:design                                                                                     |
| src/shared/font-stack.test.mjs                                         | 1      | 流放           | TS 常量与 CSS 变量一致性 → check:design                                                                             |
| src/renderer/components/app-nav/nav-motion.test.mjs                    | 2      | 流放           | reduced-motion 回退/无裸色值 → check:design                                                                         |
| src/renderer/components/shell-line-budget.test.mjs                     | 1      | 流放           | 500 行预算 → check:architecture                                                                                     |
| src/renderer/components/resource-line-budget.test.mjs                  | 1      | 流放           | 同上                                                                                                                |
| src/renderer/components/chat-input-line-budget.test.mjs                | 2      | 流放           | 同上（含拆分存在性检查）                                                                                            |
| src/renderer/components/app-nav/nav-line-budget.test.mjs               | 2      | 流放           | 同上                                                                                                                |
| src/renderer/hooks/agent-session/agent-session-line-budget.test.mjs    | 1      | 流放           | 同上                                                                                                                |
| src/main/desktop-workflow.test.mjs                                     | 5      | 流放           | CI 工作流/打包配置校验 → check:production-artifacts 家族                                                            |
| scripts/smoke-electron-isolation.test.mjs                              | 1      | 流放           | 保护的是测试基础设施（smoke 隔离目录）→ check:test-infra                                                            |
| src/renderer/components/app-nav/nav-sidebar.test.mjs                   | 6      | DOM+原生 流放1 | 交互4条保留真实 DOM；宽度、长名截断与溢出转为 test:nav-layout-electron；禁止反向依赖的静态约束 → check:architecture |
| src/main/main-bootstrap.test.mjs                                       | 1      | 删除           | 『main 会启动』已被 smoke E2E（真实启动应用）证明，正则断言文件末尾有 startMainProcess() 是冗余                     |
| src/renderer/components/chat-window-visibility-contract.test.mjs       | 2      | 删除           | hidden/aria-hidden/inert 已被 chat-input-visibility（真实 DOM）逐条断言覆盖                                         |
| src/renderer/components/skills-unsaved-changes-contract.test.mjs       | 6      | 删除           | 未保存离开守卫已被 use-skill-leave-guard（7 个行为测试）与 skills-config-journey 完整覆盖                           |
| src/renderer/hooks/model-list-error-contract.test.mjs                  | 1      | 删除           | 已覆盖：use-session-models『aborted load applies nothing』『failed refresh keeps cached list』                      |
| src/renderer/hooks/queued-command-error-contract.test.mjs              | 3      | 删除           | 已覆盖：use-session-queue 对 steer/follow-up/prompt 失败的『通知+抛出』行为测试                                     |
| src/renderer/components/settings-toggle-error-contract.test.mjs        | 3      | 删除2 待确认1  | 后台模式两条已被 general-settings-behavior 覆盖；自动更新检查一条待核实                                             |
| src/renderer/components/skills-config-request-contract.test.mjs        | 2      | 删除           | 已覆盖：use-skill-directory 的 superseded refresh 三个行为测试 + 『unmounting cancels in-flight request』           |
| src/renderer/components/settings-chat-appearance.test.mjs              | 4      | 删除1 流放3    | 保存失败提示已被 general-settings-behavior 覆盖；选项表/CSS 缩放表是设计常量 → check:design                         |
| src/renderer/lib/latest-abortable-request.test.mjs                     | 4      | 保留3 待确认1  | 前3个是该原语的行为测试（保留）；第4个 ChatInput 接线正则待核实 chat-input 行为测试覆盖度                           |
| src/renderer/lib/branch-navigator-model.test.mjs                       | 5      | 保留4 转化1    | 前4个是优秀行为测试（手工构造2万层深树、独立算例）；第5个监听器接线 → DOM 行为测试                                  |
| src/renderer/lib/directory-refresh.test.mjs                            | 3      | 保留2 转化1    | 前2个纯函数行为测试；第3个 FileExplorer 接线 → 转化（需真实 DOM 验证展开时重新加载）                                |
| src/renderer/lib/draft-persistence.test.mjs                            | 5      | 保留5          | 真行为测试（注入持久化边界）；注记：calls 序列断言偏 HOW，迁移时改看最终状态                                        |
| src/renderer/lib/router-compat.test.mjs                                | 4      | 保留3 流放1    | 前3个行为测试；第4个『AppShell 不得用响应式订阅』是架构约束 → check:architecture                                    |
| src/renderer/lib/session-performance.test.mjs                          | 4      | 保留2 转化2    | 前2个行为测试；第3-4个 trace 清理规则是孤立的 → 转化                                                                |
| src/renderer/lib/image-file-processing.test.mjs                        | 2      | 待确认2        | 剪贴板图片规则疑似被 chat-input 行为测试部分覆盖，未逐条核实                                                        |
| src/preload/preload-location-policy.test.mjs                           | 2      | 保留1 流放1    | 信任来源策略是优秀行为测试（攻击者样例独立判据）；exposeInMainWorld 白名单 → check:desktop-security                 |
| src/main/ipc-trust.test.mjs                                            | 2      | 保留1 流放1    | 信任策略函数是行为测试；『全部注册走包装器』是结构 tripwire → check:desktop-security                                |
| src/renderer/components/oauth-detail-lifecycle.test.mjs                | 2      | 转化           | 孤立规则：OAuth 详情的生命周期清理/取消顺序 → 真实组件行为测试                                                      |
| src/renderer/components/app-shell-copy-contract.test.mjs               | 1      | 转化           | 孤立规则：复制失败出现本错误提示 → 真实 DOM 行为测试                                                                |
| src/renderer/components/html-preview-error-contract.test.mjs           | 2      | 转化           | 孤立规则：预览创建失败的占位提示/URL 释放 → 行为测试                                                                |
| src/renderer/components/managed-process-ui-contract.test.mjs           | 4      | 转化           | 孤立规则：日志截断/生命周期按钮/能力开关 → 行为测试                                                                 |
| src/renderer/components/session-sidebar-timer-contract.test.mjs        | 3      | 转化2 流放1    | timer 卸载规则孤立 → 转化；第2条 doesNotMatch tripwire → check:architecture                                         |
| src/renderer/components/browser/browser-renderer-contract.test.mjs     | 7      | 转化5 待确认2  | store 层已有 main 侧行为测试；面板接线/授权门规则孤立 → 转化                                                        |
| src/agent-host/managed-process/tools-contract.test.mjs                 | 2      | 转化           | 工具激活/拒绝规则可用真实 ctx 行为测试                                                                              |
| src/agent-host/handlers-composition.test.mjs                           | 2      | 转化1 流放1    | 清理顺序断言 → 改为后果断言（真实服务+临时目录：清单为空/目录可重开）；81 注册数 → check:contract（已存在）         |
| src/renderer/components/markdown-body-component-identity.test.mjs      | 1      | 转化           | 组件类型稳定性规则 → 真实 DOM 渲行为测试，撤掉约10个内部 stub                                                       |
| src/renderer/components/interactive-tools/tool-card-structure.test.mjs | 2      | 流放1 转化1    | 行数预算 → check:architecture；卡片在输入区上方的组合规则 → DOM 行为测试                                            |

## 三、判定汇总

| 去向                               | 测试数（约） |
| ---------------------------------- | ------------ |
| 保留（真行为测试，结构文件中混居） | 29           |
| 删除（行为测试已覆盖同一规则）     | 18           |
| 流放（静态约束 → check:* 脚本）    | 46           |
| 转化（孤立规则 → 需新写行为测试）  | 25           |
| 待确认                             | 6            |

**结构家族合计：45 个文件、124 个测试**（与判定明细可能差 ±2，因混居文件按测试拆分计）。

## 四、行为规格清单（机械提取的 1,332 个测试名）

以下清单就是现有套件中最值钱的资产——绝大多数测试名本身就是一句行为规格。
重构期间，任何被删除的测试若其规则未在此清单或二节中留有对应物，即为回归。

### scripts

- **bundled-tools-targets.test.mjs**（3 个测试）
  - release and default modes use the actual host architecture
  - unsupported host release targets fail before any preparation starts
  - explicit release matrices are validated and deduplicated
- **check-contract-coverage.test.mjs**（6 个测试）
  - AST extraction ignores comments and formatting while finding real contract nodes
  - coverage diagnostics distinguish missing, duplicate, unknown, and empty extraction
  - stream coverage reports a contract topic with no real server emitter
  - Browser dispatch extraction reads equality guards and switch cases only from the dispatch method
  - the repository contract has non-empty exact AST coverage
  - server handler extraction aggregates across split modules and still flags duplicates
- **check-dependency-contract.test.mjs**（3 个测试）
  - dependency inspection uses the native npm launcher on Windows
  - dependency manifest pins the supported Node and build toolchain
  - tsup and bundle-require share the exact top-level esbuild
- **dev.test.mjs**（2 个测试）
  - Vite readiness retries failures until an OK health response
  - Vite readiness has a total timeout with the last failure
- **generate-windows-sbom.test.mjs**（2 个测试）
  - Windows SBOM is deterministic and distinguishes shipped, native-build, and cross-gate components
  - Windows SBOM fails closed on helper bytes or release provenance drift
- **package-desktop.test.mjs**（2 个测试）
  - pack and release plans use Node JS entries and set signing discovery in the child environment
  - packaging rejects unknown modes and diagnoses spawn failures, signals, and missing statuses
- **phase-8-fixture-restoration.test.mjs**（0 个测试）
- **process-utils.test.mjs**（5 个测试）
  - script dependencies resolve to real package files and the Electron executable
  - external dependency builds use the OS temp directory with explicit project resolution
  - failed dependency linking removes the partially-created temp directory
  - spawn result validation reports errors, signals, missing statuses, and exit codes
  - process tree termination targets Windows descendants and POSIX process groups
- **renderer-i18n-checker.test.mjs**（11 个测试）
  - accepts static calls with exact bilingual dictionary and placeholder parity
  - rejects visible literals and hardcoded session notification sinks in migrated owners
  - rejects dynamic calls, fallback drift, missing and duplicate entries, orphan keys, and placeholder mismatch
  - merges bilingual partials across dictionary files with a spread composition root
  - rejects the same dictionary key defined in two partial files
  - rejects spread entries inside dictionary partials while allowing them in the composition root
  - accepts legal type-only imports in the composition root without crashing
  - rejects a root spreading a non-renamed binding that is not a dictionary language
  - rejects composition-root spreads from unknown sources or wrong languages
  - enforces bilingual parity across partial files
  - fails closed when no dictionary file declares a language
- **smoke-electron-isolation.test.mjs**（1 个测试）
  - Electron smoke uses and removes an isolated userData directory
- **test-bundle.test.mjs**（3 个测试）
  - bundles TypeScript in an OS temp directory and removes it after import
  - rejects output overrides and identifies legacy per-test bundling
  - repository policy reports every legacy bundle owner
- **test-runner.test.mjs**（4 个测试）
  - test discovery uses one glob regardless of fixture count and applies a per-test timeout
  - timeout parsing rejects malformed, zero, and unsafe values
  - spawn diagnostics distinguish start errors, signals, missing statuses, and failures
  - legacy test modules are cleaned before and after every result

### src/agent-host

- **auth-login.test.mjs**（4 个测试）
  - a cancelled OAuth flow cannot clear the active replacement flow
  - ModelRuntime auth notifications and prompts map onto the desktop login stream
  - pending login tokens are cancelled and resolved by exact provider ownership
  - OAuth credential synchronization failure emits success with a safe warning after read-back
- **browser-agent-runtime.test.mjs**（7 个测试）
  - attempt ledger blocks equivalent non-retryable navigation and allows only one transient retry
  - Browser budgets issue one replan checkpoint and stop before call 61
  - browser inspect is screenshot-free by default and requires deltas after two full observations
  - JavaScript has independent explore and verify budgets with one explore replan checkpoint
  - specialized Browser tools must precede JavaScript and detailed network access
  - JavaScript execution failures stay in the attempt ledger while corrected source can continue
  - workflow guard asks locally for same-target curl and Playwright routes but ignores unrelated coding
- **credential-sync.test.mjs**（4 个测试）
  - credential state matching respects provider, type, and desired presence
  - a committed credential with a successful cache refresh is fully synchronized
  - a committed credential with a failed cache refresh returns a safe warning
  - a synchronization error cannot be called success when read-back misses the target state
- **extension-diagnostics.test.mjs**（1 个测试）
  - Pi runtime extension diagnostics remain non-fatal and safe for the status UI
- **extension-preflight.test.mjs**（1 个测试）
  - a broken provider extension reports diagnostics without blocking a base session
- **extension-ui-lifecycle.test.mjs**（8 个测试）
  - aborting an SDK dialog releases its waiter and notifies the renderer
  - explicit abandonment ends a custom UI even when it ignores control-C
  - timeout closes and removes the request, and replay cannot extend its deadline
  - retry after a lost acknowledgement settles the backend waiter only once
  - malformed confirmation cannot authorize or settle the request
  - shutdown releases a factory still constructing its custom panel
  - a custom factory finishing synchronously does not orphan its promise
  - stopping a task releases ordinary and custom requests before awaiting agent shutdown
- **file-access-cache.test.mjs**（1 个测试）
  - an invalidation during a roots scan retries and never caches the stale snapshot
- **file-access.test.mjs**（8 个测试）
  - accepts a root and its descendants without accepting prefix collisions
  - normalizes traversal, repeated separators, and trailing separators
  - resolves existing symlinks and rejects escapes
  - resolves the nearest existing ancestor before appending missing segments
  - allows a non-existent child when its existing parent is inside the root
  - applies case-insensitive Windows drive rules and path boundaries
  - supports UNC roots without accepting a sibling share prefix
  - rejects unrelated relative and mixed-style paths
- **file-suggestions.test.mjs**（10 个测试）
  - empty queries browse one directory without starting a search
  - enforces the direct, search, response, timeout and output budgets
  - scopes an existing directory query and keeps a missing prefix as a full-path root search
  - hides dot entries by default and allows an explicit dot-directory browse
  - searches on demand and excludes a large home system directory before traversal
  - allows an explicitly scoped home Library and same-named directories outside home
  - degrades to the current scope instead of recursively walking when search is unavailable
  - filters search results and directory symlinks that escape the authorized root
  - normalizes safe relative queries and rejects traversal or absolute paths
  - classifies unavailable, timeout and generic search failures
- **file-watch.test.mjs**（1 个测试）
  - file watch leases release shared refs independently and shutdown closes the remainder
- **handlers-composition.test.mjs**（2 个测试）
  - every contract method is registered exactly once through split registrars
  - the composition root runs all five host cleanups in the original order
- **handlers.test.mjs**（11 个测试）
  - registerHandlers exposes every contract method exactly once
  - agent.new uses a unique temporary lock key for every request
  - auto-title keeps the local fallback when service creation fails
  - conditional auto-title writes never replace a manual session name
  - channel initialization failure is reported without an unhandled rejection
  - credential mutation failures distinguish committed state from an unverified mutation
  - model list projection isolates provider availability failures and keeps the last known state
  - file, git, worktree, skill, plugin, and system handlers return contract-shaped results
  - sessions.get reconstructs context usage when no live agent session exists
  - session, model configuration, and auth handlers isolate state and preserve error codes
  - sessions.get returns the contract shape without rescanning known session paths
- **interactive-tool-session.test.mjs**（4 个测试）
  - real SDK command: trigger, collapse, read context, reconnect, answer, finish and continue
  - public SDK override preserves tool registration, toggles, full input, events and result meaning
  - unrelated same-named tools are not replaced
  - a deterministic model tool call receives the full questionnaire and resumes exactly once
- **model-runtime.test.mjs**（7 个测试）
  - offline catalog refresh creates cache services without requesting network
  - provider failures are stable warnings while successful catalogs remain refreshed
  - catalog refresh times out and reports an aborted cache-preserving result
  - the timeout bounds service creation even when an extension ignores cancellation
  - the timeout also bounds final model-list projection
  - a replacement refresh cancels the older cwd generation
  - explicit cancellation aborts the matching request only once
- **npx.test.mjs**（5 个测试）
  - runs the resolved absolute Node and npx CLI with the resolution environment
  - retries a network failure once with an isolated cache and one registry socket
  - does not retry a non-recoverable CLI failure
  - reports an actionable error when the developer command times out
  - fails with TOOLCHAIN_NODE_REQUIRED and never falls back to Electron or PATH
- **personal-directory.test.mjs**（11 个测试）
  - personal directory paths follow platform rules without hardcoding a username or dates
  - preparing a fresh home creates .dexon exactly once and reports not reused
  - repeated preparation reuses the same directory without clearing content
  - a same-name regular file is never overwritten and the conflict is retryable
  - an unresolvable realpath is a real failure, never a silent success
  - a directory that disappears between stat and realpath resolution fails honestly
  - a racing caller that completes the directory first is reported as reuse
  - a same-name file appearing mid-flight is classified as a conflict without touching it
  - mkdir failures that leave nothing behind surface the real cause
  - preparation failures against a real filesystem carry the real cause and succeed after the blocker is removed
  - a symlinked .dexon pointing at a directory is reused through its canonical target
- **plugin-worker-client.test.mjs**（4 个测试）
  - runs Plugins in an isolated process with the selected npm command and revision
  - normalizes a worker npm ENOENT into TOOLCHAIN_NODE_REQUIRED
  - fails closed when the worker does not return a bounded protocol response
  - timeout terminates the Plugin worker process tree before rejecting
- **plugins-service.test.mjs**（2 个测试）
  - plugin sources select only their required managed toolchains
  - configured versions and resource names are derived without executing packages
- **process-tree.test.mjs**（2 个测试）
  - parses Linux proc stat start time even when comm contains spaces and parentheses
  - reads a stable fingerprint for the current POSIX process
- **project-tree.test.mjs**（5 个测试）
  - compresses linear descendants in source order while preserving the root
  - preserves branch points, leaves, and multiple roots
  - does not mutate input or retain stale compressed ids
  - rejects cycles and shared node objects
  - bounds projected depth without recursive stack usage
- **runtime-version.test.mjs**（1 个测试）
  - runtime version resolves through the public ESM entry despite package export restrictions
- **session-content-cache.test.mjs**（1 个测试）
  - content snapshots reuse stable files and invalidate on append or explicit removal
- **session-context-usage.test.mjs**（7 个测试）
  - counts the last valid assistant usage plus trailing estimates
  - estimates every message when no assistant usage exists
  - skips aborted and error assistant usage when trusting the last response
  - returns unknown usage without a context window instead of guessing one
  - reports unknown usage after compaction until a post-compaction response exists
  - resumes counting once an assistant responds after the compaction boundary
  - reconstruction glues the session manager to the shared computation
- **session-history.test.mjs**（8 个测试）
  - history pages preserve complete turns and reconstruct the full display history
  - oversized text blocks are deferred within the byte budget and can be read exactly
  - oversized inline images are deferred and restored as the original block
  - oversized thinking and tool inputs cannot empty the newest page
  - channel markers cross page boundaries and settings match the active branch
  - compaction and branch summaries survive page boundaries with aligned entry ids
  - stale or malformed cursors are rejected
  - append-only growth keeps cursors valid while truncation invalidates them
- **session-idle-eviction.test.mjs**（1 个测试）
  - an idle session is evicted so reopening reconstructs usage from the file
- **session-index.test.mjs**（4 个测试）
  - refreshAll reuses unchanged records and derives parent ids
  - refreshPath updates only one changed file and removePath deletes it
  - unchanged invalid files are recorded without repeated parsing
  - a file appended during parsing is retried before its info is committed
- **session-reader.test.mjs**（2 个测试）
  - message entries adopt the entry completion timestamp over the inner start timestamp
  - message entries keep the inner timestamp when the entry timestamp is unusable
- **session-title.test.mjs**（9 个测试）
  - sanitizeGeneratedTitle strips wrapping quotes and trailing punctuation
  - sanitizeGeneratedTitle collapses newlines and whitespace
  - sanitizeGeneratedTitle caps output at 40 characters
  - sanitizeGeneratedTitle returns null for empty or punctuation-only output
  - sanitizeGeneratedTitle keeps astral characters intact (length by code points)
  - makeFallbackTitle reuses the first characters of the message
  - makeFallbackTitle never returns an empty string
  - makeFallbackTitle caps output at 40 characters
  - takeCodePoints splits by code points, not UTF-16 units
- **session-tool-store.test.mjs**（2 个测试）
  - Desktop session tools persist outside Pi session JSONL with normalized defensive copies
  - Desktop session tool store tolerates a corrupt sidecar without touching Pi data
- **session-watcher.test.mjs**（2 个测试）
  - session watcher refreshes exact session files and rejects traversal
  - ambiguous session metadata requests a full refresh while unrelated files are ignored
- **skill-frontmatter.test.mjs**（3 个测试）
  - removes only the frontmatter invocation key and preserves the same line in the body
  - preserves multiline YAML and comments while setting the invocation key
  - creates frontmatter without changing CRLF body bytes
- **skills-service.test.mjs**（3 个测试）
  - pins the skills CLI and keeps npx flags before the executable
  - normalizes CLI install counts to numbers for locale-aware rendering
  - normalizes and sorts API install counts without English suffixes
- **tool-environment.test.mjs**（2 个测试）
  - removes inherited credential variables from project tool environments
  - keeps non-credential URLs and ordinary project environment
- **toolchain-bash.test.mjs**（3 个测试）
  - pins Agent Bash to the resolved executable and context-local environment
  - removes host credentials from Agent Bash environment
  - reports structured Bash absence and never falls back to PATH
- **toolchain-git.test.mjs**（1 个测试）
  - routes direct Git operations through the resolved capability and revision context
- **toolchain-runtime.test.mjs**（6 个测试）
  - builds an immutable credential-sanitized environment with selected bins and revision
  - ignores stale snapshots and refreshes mismatched resolutions
  - returns a structured capability error instead of falling back to PATH
  - executes the absolute descriptor with context-only environment
  - keeps trusted and untrusted project resolutions in separate caches
  - keeps PortableGit native Git and MSYS Bash environments isolated
- **toolchain-search.test.mjs**（2 个测试）
  - Desktop grep/find use only injected absolute descriptors and disable upstream downloads
  - missing injected search capabilities fail closed instead of invoking upstream ensureTool

### src/agent-host/channels

- **channel-core.test.mjs**（10 个测试）
  - channel config persists normalized accounts and bindings
  - channel config preserves Feishu App ID and normalizes the Feishu/Lark domain
  - channel command parser recognizes only the additive built-in command set
  - versionless config migrates and corrupt config is quarantined
  - state checkpoints cursor, context, dedupe, pairing, and redacted activity
  - policy defaults to pairing and keeps group authorization independent
  - lane scheduler serializes a route while allowing other routes to progress
  - lane scheduler bounds concurrency across independent routes
  - channel redaction removes structured and inline credentials
  - outbound text splitting preserves Unicode and readable boundaries
- **channel-manager.test.mjs**（17 个测试）
  - concurrent starts create only one adapter runtime per account
  - initialization can retry after a transient media directory failure
  - fake adapter runs inbound message through binding, Pi bridge, and delivery
  - account tool changes update bindings and synchronize their existing sessions
  - accepted media is staged privately and passed to the existing Pi turn
  - Feishu generated files use the shared outbound capability and preserve the source reply route
  - progressive adapters receive Agent events and own the final delivery
  - unknown sender receives pairing code without invoking Pi
  - opt-in IM commands execute locally while unknown and disabled commands remain Agent prompts
  - account connect probes before persisting and cleans up a rejected credential
  - Feishu scan login persists credentials, probes the bot, and enforces owner-only defaults
  - Feishu scan login falls back to pairing when the provider omits the scanner open_id
  - Feishu scan login rolls back a newly written secret when config persistence fails
  - Feishu scan login does not create an account when the encrypted vault rejects the secret
  - Feishu scan login retains encrypted credentials for retry when the bot probe fails
  - Telegram DMs and forum topics resolve to isolated sessions and reply routes
  - Feishu and Lark accounts isolate the same open_id and hot-reload account changes
- **channel-session-scheduler.test.mjs**（6 个测试）
  - UI prompts and messaging-channel turns share one serial session scheduler
  - session tool changes use Desktop persistence and can enable tools after an empty initialization
  - legacy JSONL session tools use the latest valid state for sidecar migration
  - session destroy notifies every teardown owner once and isolates failures
  - a transient extension binding failure is retried by the next prompt
  - concurrent session disposal aborts and releases the inner agent exactly once
- **config-store.test.mjs**（2 个测试）
  - channel config persists normalized accounts and cascades account deletion
  - corrupt configs are quarantined while unsupported versions fail closed
- **media-store.test.mjs**（5 个测试）
  - media staging randomizes disk names, sanitizes display names, and uses private permissions
  - media staging rejects invalid images, oversized data, and attachment floods
  - expired channel media is removed without touching fresh events
  - media staging refuses a symlinked root
  - periodic and opportunistic cleanup stop when the media store is disposed
- **outbound-files.test.mjs**（2 个测试）
  - explicitly linked existing and newly created workspace files are authorized for IM delivery
  - symlinks escaping the bound workspace are never authorized
- **pi-session-bridge.test.mjs**（4 个测试）
  - restoring a channel session applies the binding tool names
  - a new dedicated session uses current account defaults instead of the stale binding snapshot
  - tool synchronization updates a live Desktop session without writing through the bridge sidecar
  - tool synchronization persists inactive sessions only in the Desktop sidecar
- **redaction.test.mjs**（3 个测试）
  - structured channel redaction recursively removes every sensitive key
  - text and error redaction covers headers, query parameters, Telegram bot URLs, and JSON
  - secret fingerprints reveal only the final four trimmed characters

### src/agent-host/channels/adapters/feishu

- **adapter-runtime.test.mjs**（17 个测试）
  - normalizes Feishu group mentions, thread routes, DMs, post text, and media metadata
  - downloads accepted Feishu image, file, audio, and video resources before the Agent turn
  - normalizes supported Feishu native menu events into existing DM commands
  - long-connection runtime acknowledges quickly and suppresses message replay
  - failed Channel Core handling does not persist the Feishu message as processed
  - recoverable terminal WebSocket errors rebuild the connection with bounded jitter
  - credential and permission WebSocket errors remain terminal
  - native Feishu menu dispatches existing commands and suppresses replay
  - native Feishu menu is ignored when channel commands are disabled
  - text replies preserve the source message and thread across chunks
  - media replies preserve Feishu thread routing and return the final attachment receipt
  - progressive turns stream process and Markdown then fold details in the final card
  - Feishu reaction failures never prevent a durable final reply
  - missing CardKit permission falls back to one durable Markdown card without losing the answer
  - a streaming update failure is isolated and the existing card still receives the final answer
  - an ambiguous streaming-card send failure never creates a duplicate fallback message
  - probe reports the bot identity and domain without exposing App Secret
- **api.test.mjs**（11 个测试）
  - bot identity probe uses the selected Feishu/Lark domain through the official SDK client
  - message create/reply requests preserve receive ID, content, source message, and thread
  - message resources download through the official API with MIME and size enforcement
  - image, voice, video, and file uploads send the matching Feishu message types
  - SDK errors never expose the App Secret
  - inline Markdown cards preserve reply and thread routing through the official SDK
  - CardKit session creates, sends, streams, and finalizes one card with monotonic sequences
  - CardKit finalization patches the same message when full card update is rejected
  - message reactions are added and removed through the official SDK
  - slow initial WebSocket stays alive, reports reconnecting, then reaches ready and closes on demand
  - aborting a pending WebSocket startup closes the SDK client without leaking handles
- **app-registration.test.mjs**（11 个测试）
  - official registerApp creates a new Feishu bot with the exact Pi channel capabilities
  - Lark domain switching is reflected in safe account metadata
  - an expired local session aborts and clears the QR state
  - provider expiry aborts the SDK even when the Renderer stops polling
  - registration errors and untrusted QR links fail closed without leaking provider details
  - cancelling an active session aborts the SDK and clears any future credential
  - scan-created account IDs are deterministic and domain-separated
  - the official SDK transport is bounded, domain-fixed, and supports pending plus Lark switching
  - the official SDK transport propagates slow_down and aborts an in-flight poll
  - simulated registration responses fail closed on terminal and malformed protocol cases
  - transport timeout, oversized response, redirect, and wrong registration hosts are rejected
- **rich-renderer.test.mjs**（5 个测试）
  - builds a JSON 2.0 streaming card with a stable Markdown element
  - preserves standard Markdown while blocking raw card tags and unsafe links
  - streams thinking, tool progress, and answer then folds process details in the final card
  - oversized answers explicitly switch to the lossless plain-text fallback
  - partial and hostile tool snapshots cannot crash card rendering

### src/agent-host/channels/adapters/telegram

- **adapter-runtime.test.mjs**（15 个测试）
  - normalizes DM, group topic, mention, reply context, and attachment metadata
  - normalizes a basic Telegram group independently of forum topic support
  - runtime checkpoints update offset and suppresses replay after Host restart
  - runtime isolates a failed inbound turn and advances past the poison update
  - runtime keeps provider media references private while allowing policy-approved download
  - runtime retries a transient getMe failure during offline startup
  - runtime syncs the opt-in command menu without making menu failures fatal
  - runtime reconnects after a transient failure and fails closed on 409 conflicts
  - send retries 429, escapes HTML, and splits long Unicode text
  - sendRichMessage preserves Markdown and blocks model-injected Rich HTML
  - an ambiguous Rich Message network failure does not trigger a duplicate plain send
  - private turns stream Rich drafts and persist folded process details
  - Telegram reaction failures never prevent a durable final reply
  - group turns skip ephemeral drafts and send only a Rich final message
  - malformed tool progress cannot escape the Telegram draft timer
- **api.test.mjs**（9 个测试）
  - getMe verifies the BotFather token without exposing it in a request body
  - getUpdates sends the confirmed offset, long-poll timeout, and message filter
  - sendMessage uses safe HTML, topic routing, and modern reply parameters
  - Rich Message APIs preserve draft identity, topic routing, and replies
  - Telegram command menu can be installed and removed
  - Telegram message reaction replaces the bot status on the source message
  - Telegram API errors preserve 409 and 429 classification metadata
  - getFile downloads provider bytes from the fixed bot file origin with a byte limit
  - Telegram media upload uses multipart fields while preserving topic and reply routing
- **rich-renderer.test.mjs**（3 个测试）
  - sanitizes model Markdown while preserving safe formatting and links
  - streams thinking and tools open, then folds them in the final rich message
  - normalizes partial Pi tool-call snapshots before rendering a draft

### src/agent-host/channels/adapters/weixin

- **adapter-runtime.test.mjs**（7 个测试）
  - delay removes its abort listener after timeout and abort completion
  - runtime checkpoints cursor and suppresses duplicate inbound events
  - runtime isolates a failed inbound turn and checkpoints the following message
  - runtime downloads Weixin media only through the private adapter capability
  - runtime fails closed when Tencent reports a stale login token
  - runtime reconnects after a transient long-poll disconnect
  - QR confirmation returns a fresh credential for re-login
- **api.test.mjs**（4 个测试）
  - starts QR login with Tencent iLink headers and no credential
  - getUpdates sends cursor and preserves it on an aborted long poll
  - sendText includes provider context token and a stable client id
  - normalizes text, transcribed voice, and unsupported attachment metadata
- **media.test.mjs**（5 个测试）
  - Weixin CDN image and file payloads are downloaded and AES-128-ECB decrypted
  - Weixin media refuses provider-controlled non-Tencent download origins
  - Weixin voice detects and decodes SILK bytes even when encode_type is unexpected
  - Weixin voice with a platform transcript does not duplicate the audio attachment
  - Weixin image upload encrypts CDN bytes and sends a provider media item

### src/agent-host/handlers

- **system.test.mjs**（5 个测试）
  - defaultCwd prepares .dexon inside the injected home and authorizes exactly that root
  - repeated defaultCwd calls keep one authorized root and a stable generation
  - defaultCwd reports a conflict when a same-name file blocks the directory
  - defaultCwd surfaces real preparation failures and recovers on retry
  - system.home reflects the injected home provider and preparation is repeatable

### src/agent-host/managed-process

- **helper-codec.test.mjs**（4 个测试）
  - Windows helper codec handles fragmented and coalesced frames
  - Windows helper codec rejects unknown kinds, sequence replay, truncation, and oversize before payload
  - Windows helper codec enforces exact bootstrap, control, and output boundaries
  - Windows helper codec handles a bounded deterministic random-byte corpus without unbounded buffering
- **output-buffer.test.mjs**（8 个测试）
  - cursor is generation scoped
  - ring evicts oldest records and reports a gap
  - decoder handles split utf8, CR progress and long line truncation
  - decoder handles flood-sized lines in bulk without changing line or CR semantics
  - output sanitizer strips terminal controls and common secrets
  - output sanitizer handles long URL-free flood lines without a quadratic scan
  - decoder replaces malformed utf8 without losing following output
  - decoder reports a high invalid UTF-8 ratio only once
- **owner-identity.test.mjs**（2 个测试）
  - managed process owner identity is exact and one-time per Host generation
  - managed process owner identity fails closed when creation time is unavailable
- **posix-backend.test.mjs**（2 个测试）
  - POSIX backend implements prepare, commit, I/O, stop, and verified group cleanup
  - POSIX backend reports host-failure and retains uncertainty when group cleanup is unverified
- **service.test.mjs**（11 个测试）
  - starts, observes readiness, reads output, writes stdin and stops an owned process
  - late readiness output cannot revive a stopping process
  - user stop creates a barrier that only a user restart can clear
  - concurrent restarts create exactly one new generation
  - feature, trust and platform gates fail before spawning
  - stale runs, oversized waits and concurrent Agent waits fail closed
  - cancelling start before spawn leaves no worker
  - a synchronous POSIX worker spawn failure leaves no containment uncertainty
  - user stop before spawn settles immediately as a stopped run
  - service drives the real worker and releases its verified process group
  - service reaps an ignored-signal descendant after the root shell exits first
- **session-redaction.test.mjs**（5 个测试）
  - managed process command, stdin and output are omitted from persisted messages
  - managed process errors retain only a safe whitelisted error projection
  - unrecognized error text is omitted without inventing a process id or refresh action
  - session redaction changes only the persisted copy
  - unrelated tool messages are preserved by identity
- **tools-contract.test.mjs**（2 个测试）
  - managed process tools activate only with a non-empty local tool selection
  - managed process tools reject messaging-channel turns and bound literal waits
- **worker.test.mjs**（3 个测试）
  - worker strips its Electron bootstrap flag and does not load login profiles
  - worker keeps a POSIX process group leased, forwards stdin/output, and reaps descendants
  - worker lease disconnect cleans the process group without a Host stop message

### src/contract

- **rpc.test.mjs**（14 个测试）
  - performs request/response calls and reports missing methods
  - serializes RpcError detail and maps ordinary errors to INTERNAL
  - preserves structured toolchain errors across the RPC boundary
  - returns a minimal error when a handler result cannot be structured-cloned
  - matches exact and wildcard subscriptions and isolates subscriber errors
  - unsubscribe prevents later events
  - client close rejects pending calls
  - client calls time out and remote close settles pending calls
  - postMessage failure rejects and removes a pending call
  - subscribe throws without retaining a local subscription when postMessage fails
  - server attach/detach is idempotent and removes message and close listeners
  - port leases replace, release explicitly, and finalize on detach
  - remote port close finalizes owned resources
  - server detaches a port when response fallback or event delivery also fails

### src/main

- **attachment-staging.test.mjs**（5 个测试）
  - stageClipboardImage writes owner-only pi-clipboard files in the temp dir
  - stageClipboardImage normalizes extensions case-insensitively
  - stageClipboardImage rejects unsupported extensions
  - stageClipboardImage rejects empty and invalid payloads
  - stageClipboardImage rejects payloads above the staging size limit
- **deep-link.test.mjs**（2 个测试）
  - parses desktop session links with case-insensitive schemes
  - finds only a valid desktop deep link in second-instance argv
- **desktop-workflow.test.mjs**（5 个测试）
  - main pushes package every supported desktop target
  - Windows runs pure quality checks and Electron smoke without an Xvfb dependency
  - package metadata is cross-checked against each platform artifact
  - unsigned Windows releases remain explicitly Beta until Authenticode provenance exists
  - Windows packages and draft releases require an exact CycloneDX SBOM and notices asset
- **diagnostics-redaction.test.mjs**（2 个测试）
  - redacts private roots, auth headers, registry tokens, JSON secrets, and proxy credentials
  - toolchain diagnostic summaries contain health and revisions but no candidate paths or raw errors
- **file-associations.test.mjs**（4 个测试）
  - Windows command parser handles quoted executables, spaces, and escaped quotes
  - Open With invocation supports common placeholders without a shell
  - Open With invocation appends a target when the command has no placeholder and rejects placeholder executables
  - Open With hides shell-backed and unresolved handler commands
- **file-context-policy.test.mjs**（3 个测试）
  - file context validation resolves real paths and enforces project containment
  - file context validation rejects untrusted shapes, missing files, and non-file URLs
  - file inspection reports missing, file type, and containment without throwing
- **host-install-recovery.test.mjs**（2 个测试）
  - restarts a Host only after its previous child exits
  - does not restart when the application resumed quitting while waiting
- **host-restart-core.test.mjs**（3 个测试）
  - resolves a Host exit signal exactly once
  - converts synchronous Host spawn exceptions into a result
  - bounds Host restart attempts inside a rolling crash window
- **ipc-trust.test.mjs**（2 个测试）
  - desktop IPC trusts only the live main window main frame
  - all desktop IPC registrations pass through the trusted wrappers
- **logger-core.test.mjs**（5 个测试）
  - sanitizes sensitive values and truncates log lines
  - batches Host output by line and bounds an unterminated line
  - writes asynchronously and rotates bounded log generations
  - drops oldest entries when the in-memory queue is full
  - retains a bounded batch across a transient disk error
- **main-bootstrap.test.mjs**（1 个测试）
  - single-instance lock failure returns before Main registers lifecycle listeners
- **menu-policy.test.mjs**（1 个测试）
  - reload and DevTools roles are exposed only in development menus
- **open-directory.test.mjs**（3 个测试）
  - opens the canonical real path of an existing directory
  - rejects paths that do not exist, are not absolute, or are not directories
  - surfaces the opener failure message instead of faking success
- **packaged-cleanup-fault-validation.test.mjs**（1 个测试）
  - packaged cleanup fault validation retains uncertainty and prevents installer launch
- **protocol.test.mjs**（2 个测试）
  - HTML preview assets stay inside the source document directory
  - HTML preview registry expires, caps, and releases owned entries
- **renderer-crash-recovery.test.mjs**（2 个测试）
  - classifies intentional exits and non-recoverable renderer failures
  - applies exponential backoff and halts a renderer crash loop
- **ui-state-patch.test.mjs**（3 个测试）
  - renderer UI state accepts only complete, known appearance preferences
  - renderer UI state rejects unknown fields and malformed background mode
  - renderer UI state accepts lastSpaceCwd only as an absolute path or null
- **update-adapter.test.mjs**（4 个测试）
  - production adapter applies the stable, consent-first updater policy
  - development update config requires an explicit adapter option
  - production downloads use a cancellable token
  - production platform policy enables macOS and unsigned Windows releases
- **update-manager.test.mjs**（13 个测试）
  - development and unsupported platforms remain disabled by default
  - explicit test mode permits a development updater only on supported platforms
  - adapter events drive a subscribed, sanitized update state
  - checks are reused and mutually exclusive with downloads
  - download progress, installation guards, and preparation are enforced
  - a stalled download is cancelled and releases the active operation for retry
  - invalid state operations fail with stable errors without mutating state
  - a synchronous installer failure restores the surrounding application lifecycle
  - a failed containment cleanup aborts installation and restores the application lifecycle
  - an installer error event restores the surrounding application lifecycle
  - network and signature failures are normalized while logs are redacted
  - redaction handles token, email, Windows home, and cache paths
  - automatic checks honor delay, interval, preference, jitter, and disposal
- **update-metadata.test.mjs**（3 个测试）
  - release metadata must exactly match artifact bytes, sizes, and blockmaps
  - metadata parser accepts quoted scalars and rejects documents without file entries
  - AppImage metadata validates its embedded block map without requiring a sidecar
- **window-load-failure.test.mjs**（3 个测试）
  - load failure page escapes diagnostics and blocks active content
  - renderer crash page is inert, escaped, and exposes only the exact retry link
  - failure pages use shared CJK fonts and native light or dark colors
- **window-menu-command.test.mjs**（2 个测试）
  - menu command shows and focuses a live loaded window before sending
  - menu command waits for load and rechecks destruction before sending
- **window-navigation-policy.test.mjs**（1 个测试）
  - main-window navigation requires an exact trusted origin
- **window-show-fallback.test.mjs**（3 个测试）
  - ready-to-show wins once and clears the fallback timer
  - hide, close, and closed cancel both ready and fallback show paths
  - fallback shows exactly once when its injected deadline fires
- **window-state-core.test.mjs**（3 个测试）
  - persists only finite normal bounds from a normal or maximized window
  - recenters Windows minimized sentinel and disconnected-display bounds
  - keeps visible secondary-display placement and clamps oversized bounds

### src/main/browser

- **browser-agent-header-rule-registry.test.mjs**（3 个测试）
  - scopes Agent header rules by owner session and never restores them in a new registry
  - retains a shared secret reference until its last Agent owner is cleared
  - replacing one owner cannot exceed the shared scope limit
- **browser-authorization-coordinator.test.mjs**（8 个测试）
  - persistent policy grants without prompting and explicit deny fails closed
  - same-tier requests coalesce and a session response grants both calls once
  - higher-tier requests queue behind the current dialog and stale responses are rejected
  - authorization dialogs are globally serialized across sessions
  - settings can resolve a pending request while timeout and unavailable Renderer fail closed
  - a prompt grant failure immediately clears pending state and advances the queue
  - a persistent-policy grant failure follows the same cleanup rule
  - denial cooldowns expire on read, clear with sessions, and remain bounded
- **browser-cdp-coordinator.test.mjs**（2 个测试）
  - CDP coordinator reference-counts domains and does not detach concurrent users
  - CDP coordinator routes events and cleans listeners and attachment on tab disposal
- **browser-console-buffer.test.mjs**（2 个测试）
  - Console buffer captures bounded primitive data, redacts secrets, filters, waits, and cleans up
  - Console cursor expires after bounded ring-buffer eviction
- **browser-devtools-shortcut.test.mjs**（2 个测试）
  - all supported DevTools shortcuts are blocked
  - nearby browser and editing shortcuts remain available
- **browser-download-manager.test.mjs**（1 个测试）
  - download filenames are normalized and cannot traverse the approved directory
- **browser-error.test.mjs**（1 个测试）
  - Browser errors always expose stable recovery semantics
- **browser-header-rule-store.test.mjs**（2 个测试）
  - migrates legacy rules as local and persists only local ownership
  - drops Agent-owned records if they are injected into the persistent v2 file
- **browser-header-rules.test.mjs**（2 个测试）
  - header rules validate scope and apply set, append, remove, secret, and resource filters
  - header rules reject transport, Authorization plaintext, and site-security response overrides
- **browser-identity-manager.test.mjs**（2 个测试）
  - identity profile drives Chromium UA metadata and network Client Hints from one source
  - custom identity rejects a mismatched UA and Client Hints Chromium major
- **browser-inspection-store.test.mjs**（2 个测试）
  - inspection store returns compact unchanged deltas and rejects cross-session ids
  - inspection store bounds records and clears tab/session state
- **browser-network-policy.test.mjs**（5 个测试）
  - private address classification covers local, RFC1918, link-local, CGNAT, IPv6 local, and metadata names
  - confirmed proxy virtual DNS mappings do not look like private-network destinations
  - virtual DNS compatibility stays fail-closed for literals, untrusted resolvers, PTR mismatches, and mixed results
  - URL policy blocks unsafe protocols, credentials, HTTP, literal private targets, and DNS rebinding results
  - explicit local approval is scoped to a request and strict mode fails without an enforcing sandbox
- **browser-network-recorder.test.mjs**（4 个测试）
  - network recorder captures redacted metadata, bounded bodies, sealed replay data, and cleanup
  - network recorder creates replay response entries with provenance
  - network recorder reports truncation and evicts body files in deterministic LRU order
  - network recorder suspends body and sealed replay capture after idle while retaining metadata
- **browser-permission-grants.test.mjs**（2 个测试）
  - permission checks peek without consuming an allow-once grant
  - session grants survive consumption and clear removes every grant
- **browser-persistent-grant-store.test.mjs**（2 个测试）
  - persistent Browser grants are private, atomic, reloadable, and support inherit deletion
  - persistent Browser grant corruption recovers empty and GC removes deleted sessions
- **browser-policy.test.mjs**（4 个测试）
  - browser capability leases are session-bound, permission-ranked, and invalidated by policy revisions
  - channel access and Advanced Browser Mode are gated without a second hidden advanced-channel switch
  - advanced runtime policy is atomic and fail closed
  - confirmation proofs are payload-bound, one-time, and expiring
- **browser-profile-manager.test.mjs**（5 个测试）
  - profiles use isolated persistent, temporary, and unsafe partitions
  - only persistent profile metadata survives relaunch and is private on disk
  - profile data clearing, proxy changes, and disposal respect profile lifetime
  - deleting a persistent profile clears its session and verified partition directory
  - locked persistent partitions keep profile metadata and return a retryable error
- **browser-response-body.test.mjs**（5 个测试）
  - rejects an oversized Content-Length before reading the body
  - counts streamed bytes when Content-Length is missing or misleading
  - returns a bounded streamed body without changing its bytes
  - aborts a stalled response at the timeout and settles the task
  - propagates parent cancellation into a running response task
- **browser-secret-vault.test.mjs**（2 个测试）
  - BrowserSecretVault stores only encrypted values and uses private file permissions
  - BrowserSecretVault fails closed when secure storage is unavailable or corrupt
- **browser-sensitive-control.test.mjs**（1 个测试）
  - sensitive approval resumes only the unchanged waiting control generation
- **browser-settings-confirmation.test.mjs**（3 个测试）
  - invalid settings patches fail before consuming their confirmation proof
  - confirmation proof digest is bound to the validated canonical patch
  - prepared settings patches are isolated canonical clones without disable rewriting
- **browser-settings.test.mjs**（7 个测试）
  - browser defaults are usable for local browsing and fail closed for automation and advanced capabilities
  - browser settings reject unknown fields, invalid ranges, unsafe URLs, and incomplete custom identities
  - patches preserve unrelated settings and launch-only advanced mode is removed before persistence
  - invalid settings recover to safe defaults while a future schema is read-only
  - v1 settings migrate configuration drafts but never migrate an active advanced grant
  - v2 automation defaults always migrate to ask and active advanced state is discarded
  - BrowserSettingsStore writes atomically with private mode, recovers corruption, and preserves future state
- **browser-snippet-store.test.mjs**（4 个测试）
  - snippet store saves explicitly approved code, deduplicates, scopes by host, and persists privately
  - snippet scanner rejects credential APIs and secret-like literals without echoing source
  - snippet store enforces per-host LRU capacity
  - snippet store recovers corruption and migrates entries created before enabled state existed
- **browser-tab-restoration.test.mjs**（1 个测试）
  - restores normal Profiles even after or during an advanced Agent action

### src/main/managed-process

- **capability.test.mjs**（4 个测试）
  - managed process capability preserves the real platform and fails closed by health
  - Windows Job capability becomes ready only with helper, reaper, and current owner
  - Windows Server and pre-Windows-10 releases remain unsupported
  - POSIX capability does not depend on the Windows helper or owner ACK
- **reaper-journal.test.mjs**（5 个测试）
  - journal round trips minimal reaper records
  - journal rejects unsafe permissions, oversized and malformed input
  - record validation rejects pid/pgid mismatch
  - journal migrates POSIX v1 records and validates the Windows union
  - journal rejects old versions and duplicate identities
- **reaper.test.mjs**（3 个测试）
  - reaper registers and removes exact nonce identity
  - reaper fails closed when a live pid fingerprint does not match
  - reaper fails closed when a verified process group cannot be terminated
- **shutdown-cleanup.test.mjs**（3 个测试）
  - ordinary quit is bounded and retains uncertain reaper records
  - prepare-to-install fails closed for uncertain identity without clearing the journal
  - prepare-to-install rejects reaper failures and successful cleanup requires zero records

### src/main/toolchains

- **bundled-core.test.mjs**（3 个测试）
  - loads only bundled core executables and licenses matching the signed manifest
  - discovers legacy upstream rg/fd read-only with the lowest provider priority
  - resolves development and packaged core roots without consulting PATH
- **candidate-normalizer.test.mjs**（6 个测试）
  - normalizes Windows paths, drive letters, quotes, and comparison case
  - normalizes PATH entries without accepting relative or duplicate paths
  - handles Windows UNC containment without prefix confusion
  - redacts the longest matching root and preserves Unicode relative paths
  - deduplicates symlinked candidates by resolved executable while retaining the preferred source
  - sorts healthy project, custom, system, bundled, managed, and legacy candidates stably
- **catalog.test.mjs**（1 个测试）
  - loads the shipped fixed catalog for every current release platform
- **component-entrypoint.test.mjs**（1 个测试）
  - selects PortableGit cmd/git.exe and bin/bash.exe from the same component root
- **darwin-binary-integrity.test.mjs**（3 个测试）
  - keeps the executable digest stable when codesign replaces or adds a Mach-O signature
  - rejects modified executable bytes and non-zero signing alignment padding
  - rejects malformed Mach-O load commands and signature ranges
- **discovery-registry.test.mjs**（6 个测试）
  - finds Homebrew versioned Node when Finder PATH omits its bin directory
  - finds macOS user installs for Bun, fnm, Conda, and python.org outside Finder PATH
  - uses bounded version-manager roots without executing shell profiles
  - resolves an existing npmCommand wrapper from bounded known locations as a probed custom seed
  - collects Windows official, Git, Scoop, launcher, where, and PEP 514 candidates
  - parses Python Launcher and PEP 514 paths with spaces and UNC roots
- **downloader.test.mjs**（4 个测试）
  - streams an exact allowlisted artifact and reports bounded progress
  - rejects size and checksum mismatches and removes the partial artifact
  - rejects a redirect outside the fixed download host set
  - aborts an in-flight download and removes its partial artifact
- **electron-runtime-fetch.test.mjs**（5 个测试）
  - follows only an allowlisted Electron redirect and streams its response
  - rejects an Electron redirect outside the runtime host allowlist
  - does not treat close during a followed redirect as a terminal failure
  - enforces the redirect limit before synchronously following
  - aborts an Electron request when the caller cancels
- **environment.test.mjs**（2 个测试）
  - converts only absolute native Windows paths to supported MSYS syntax
  - keeps PortableGit native and MSYS path/environment additions separate
- **installer.test.mjs**（10 个测试）
  - installs a fixed single-binary jq artifact without an external extractor
  - PortableGit special installer probes and activates coupled native Git and MSYS Bash
  - probes before atomically activating a managed runtime
  - a failed staging probe leaves the previous active runtime untouched
  - a state write failure restores the previous same-version runtime
  - a live component lock rejects a concurrent installer without disturbing the active install
  - startup recovery removes partial/install residue and restores interrupted runtime renames
  - startup recovery restores a component staged by an interrupted removal
  - cancelling an install cleans partial data and never activates the component
  - startup recovery leaves runtime and staging ownership untouched for a future state schema
- **legacy-npm-command.test.mjs**（2 个测试）
  - reads the existing global npmCommand without modifying Pi settings
  - rejects malformed, oversized, and command-injection-shaped legacy values
- **manager.test.mjs**（15 个测试）
  - builds a redacted, stable public inventory and selects only healthy candidates
  - coalesces concurrent rescans and advances one immutable inventory revision
  - auto switches from managed to a newly installed system tool while an explicit managed preference stays pinned
  - keeps a managed Bun package cache inside app-private toolchain data
  - an invalid packaged catalog fails closed without preventing offline system discovery
  - deduplicates shims by the probed real executable while preserving PATH priority
  - resolves compatible coupled Node and Python distributions per project intent
  - uses a verified legacy npmCommand only for plugin compatibility without mutating the setting
  - probes and selects a project Python environment only after trust
  - retains one rollback per component and parallel CPython minors
  - measures private tool directories without following symlinks or returning partial oversized totals
  - probes Main-selected custom executables before persisting private paths
  - prunes superseded runtime directories only during startup before Host sessions exist
  - refuses to remove managed runtimes while Agent commands may still be using them
  - cooperatively cancels the active install for a fixed component ID
- **portable-git-installer.test.mjs**（2 个测试）
  - runs only the verified PortableGit SFX with fixed non-elevated staging arguments
  - rejects invalid Authenticode before executing the PortableGit artifact
- **process-runner.test.mjs**（3 个测试）
  - runs a probe with argv and stdin without invoking a shell
  - bounds stdout and terminates a noisy probe
  - times out a stalled probe
- **project-detector.test.mjs**（3 个测试）
  - parses bounded project declarations without activating an untrusted environment
  - evaluates Node and Python requests without executing version-manager scripts
  - ignores project data symlinks and virtual environments outside the project root
- **runtime-manifest.test.mjs**（2 个测试）
  - loads only active managed entrypoints whose key-file hashes still match
  - keeps installed rollback versions discoverable after the release catalog advances
- **secure-extractor.test.mjs**（4 个测试）
  - normalizes safe archive paths and rejects traversal, absolute, drive, UNC, and backslash paths
  - allows contained relative links and rejects escaping or absolute links
  - extracts a bounded tar.gz without invoking a system archive tool
  - fails before extraction exceeds the declared byte budget
- **shims.test.mjs**（2 个测试）
  - creates and repairs private POSIX python/python3 aliases
  - creates native cmd and Git Bash aliases for Windows paths
- **state-store.test.mjs**（5 个测试）
  - persists app-private state atomically and recovers from its backup
  - rejects path traversal in state and runtime paths
  - loads schema 2 state written before custom selections were introduced
  - drops retired Corepack, pnpm, and Yarn selections from schema 2 state
  - future state is read-only and neither the state file nor runtime data is deleted on rollback

### src/main/toolchains/probes

- **capabilities.test.mjs**（6 个测试）
  - probes every reported Phase 1 capability without network or shell-profile execution
  - marks Microsoft Store-style Python aliases broken when the isolated probe cannot run
  - rejects wrong-platform Python and retains x64 macOS Python only as a lower-priority Rosetta candidate
  - classifies noexec and executable permission failures without presenting an error code as a version
  - does not auto-select Cygwin, standalone MSYS2, or legacy WSL bash
  - reports an unknown future Bun major but does not mark it auto-selectable
- **node.test.mjs**（4 个测试）
  - pairs Homebrew Node, npm, and npx through one absolute Node executable
  - reports npm and npx as incomplete instead of claiming Node is missing
  - classifies old and unknown-future Node versions without selecting them
  - rejects mismatched platform or architecture while retaining a lower-priority Rosetta candidate

### src/preload

- **early-event-replay.test.mjs**（2 个测试）
  - an early event replays consistently to every subscriber within its generation
  - listener failures do not block live delivery or replay
- **preload-message-policy.test.mjs**（2 个测试）
  - host port messages require exactly one port-shaped transferable
  - deep-link messages accept only canonical session ids

### src/renderer

- **i18n-dictionaries-structure.test.mjs**（5 个测试）
  - every dictionary partial is wired into the composition root
  - partial key sets are disjoint and together cover the composed dictionaries
  - composed dictionary values match the verified pre-split baseline
  - composition root keeps the historical export contract
  - dictionary files stay within the 500-line budget
- **theme-tokens.test.mjs**（1 个测试）
  - removed unused theme tokens stay out of the global contract

### src/renderer/components

- **capability-required.test.mjs**（2 个测试）
  - parses structured capability errors and never guesses from raw ENOENT text
  - recommends only the managed component that can satisfy the missing capability
- **chat-input-draft-migration.test.mjs**（6 个测试）
  - an initial v3 draft is materialized before the first edit
  - hidden plain-text insertion preserves attachment token separation
  - StrictMode replay keeps legacy attachments restartable until migration completes
  - same-key edits own the draft when legacy migration resolves late
  - unmount invalidates a pending legacy migration before it can publish
  - a partially failed legacy migration keeps successful later files and reports no stale overwrite
- **chat-input-file-reference.test.mjs**（14 个测试）
  - @ project file autocomplete completes into a chip and sends the literal token
  - @ autocomplete requests each query and ignores a late response for an older token
  - @ autocomplete shows degraded scope and reuses a recent query from the bounded cache
  - local file references are sent as literal @path tokens
  - ＋ button expands the attachment menu and each row opens its own picker
  - streaming queue delivers token references as plain queued text
  - pasted clipboard images are staged and referenced as chips
  - backspace at a chip boundary removes the whole reference atomically
  - chips reveal in the file manager and the ✕ removes them
  - serialized values rebuild into chips and round-trip idempotently
  - typing a path then a space materializes it into a chip
  - Esc then a space closes a drill-down directory as a chip
  - a space inside an unfinished quoted query closes it as a chip
  - a non-path @word keeps its space as plain text
- **chat-input-focus-frame.test.mjs**（1 个测试）
  - hiding cancels a queued focus-return frame before it can run
- **chat-input-line-budget.test.mjs**（2 个测试）
  - ChatInput is split into the approved responsibility modules
  - ChatInput responsibility modules stay within the 500-line budget
- **chat-input-skill-reference.test.mjs**（9 个测试）
  - a picked skill becomes a chip at message start, serialized as /skill:name
  - picking another skill replaces the existing leading skill chip
  - typing a leading /skill command materializes on the closing space
  - an open /skill query stays plain text so the slash palette keeps working
  - mid-message /skill text is prose, not a command chip
  - draft-restore style setValue materializes the leading command (rebuild path)
  - backspace at the chip boundary removes the whole skill chip atomically
  - clicking the skill chip opens the details card and ✕ removes the chip
  - sending submits the serialized /skill command text
- **chat-input-visibility.test.mjs**（9 个测试）
  - visible to hidden to visible keeps the same editor and commits its draft
  - legacy draft migration cannot overwrite a newer draft key after staging resolves
  - a file batch that crosses hide keeps every staged and local token
  - composition Enter and native IME key codes never submit before the grace window expires
  - hiding during composition resets IME state before the editor returns
  - a newer draft wins when a queued submission fails
  - hidden input loses focus, becomes non-editable, and restores editing on return
  - hiding closes local menus and the body-mounted model menu
  - the hidden composer does not consume Escape intended for another page
- **chat-window-composition.test.mjs**（6 个测试）
  - retained ChatWindow hides reading work while the runtime continues
  - an active minimap drag and a pending follow frame are cancelled by hiding
  - delayed element readiness attaches the viewport observer
  - a rejecting bundle acquisition restores the environment and host
  - the ordered teardown alone restores a rejecting acquisition
  - an originally absent fetch is absent again after the ordered release
- **form-controls.test.mjs**（2 个测试）
  - Field associates its label with every shared input type
  - compact shared controls expose at least a 32px pointer target
- **managed-process-ui-contract.test.mjs**（4 个测试）
  - managed process UI pulls bounded plain-text logs from availability events
  - managed process UI exposes lifecycle controls and independent Browser opening
  - managed process setting defaults off and follows the Main capability projection
  - containment failures are explicit and retain stop-all plus diagnostics actions
- **markdown-body-component-identity.test.mjs**（1 个测试）
  - Markdown custom component types are module-stable
- **message-view.test.mjs**（8 个测试）
  - MessageView is memoized to preserve unchanged historical messages
  - keeps the user copy action without timestamp or branch actions
  - channel attachment placeholders expose meaningful copy text
  - legacy attachment placeholders without metadata disable copy
  - renders an empty provider failure as a persistent alert
  - renders actionable fallback text when a failed response has no provider detail
  - continues to hide a completed empty non-error assistant message
  - renders compaction summaries collapsed by default
- **oauth-detail-lifecycle.test.mjs**（2 个测试）
  - OAuthDetail has one provider lifecycle effect and only its cleanup cancels the captured provider
  - each explicit login attempt awaits one cancellation before creating its replacement stream
- **process-details-group.test.mjs**（3 个测试）
  - process details header prefers the whole-turn duration when available
  - process details header falls back to counts without a duration
  - process details expansion survives a component remount and remains isolated by session store
- **process-flow.test.mjs**（3 个测试）
  - thinking row renders a summary chip and a gray full-text box without any chevron
  - tool call rows keep their detail expansion but expose no chevron
  - items render in the given order with a running spinner state preserved
- **resource-dom-environment-present.test.mjs**（2 个测试）
  - installDomEnvironment overwrites a pre-existing property
  - restoreGlobals restores the exact pre-import descriptor and value
- **resource-dom-environment.test.mjs**（6 个测试）
  - restoreGlobals removes globals that did not exist before the fixture import
  - a disposed beforeunload tracker observes no later registrations
  - tracker cleanup runs even when an assertion fails mid-test
  - native addEventListener still works after tracker disposal
  - the managed DOM root unmount awaits container removal and is idempotent
  - the managed DOM root removes its container even when the render body already threw
- **resource-line-budget.test.mjs**（1 个测试）
  - resource and settings modules stay within the 500-line budget
- **shell-line-budget.test.mjs**（1 个测试）
  - shell and sidebar modules stay within the 500-line budget
- **toolchains-config.test.mjs**（1 个测试）
  - renders verified providers, incomplete Node distributions, and the no-network promise
- **user-message-skill-badge.test.mjs**（3 个测试）
  - a message starting with /skill:name renders a blue badge plus the prose
  - a bare /skill:name message renders only the badge
  - mid-message /skill text is prose and gets no badge

### src/renderer/components/app-nav

- **nav-history-search.test.mjs**（6 个测试）
  - search stays closed until the header icon opens it, then it is focused
  - filtering matches names and first messages
  - filtering matches the five approved fields: id, cwd and branch
  - a deep hit keeps its whole ancestor chain visible
  - the clear button empties the filter and closes the search
  - Escape inside the input closes the search and clears the filter
- **nav-language.test.mjs**（1 个测试）
  - every phase-4 navigation key exists in both dictionaries with distinct translations
- **nav-line-budget.test.mjs**（2 个测试）
  - phase-4 targets exist (nav modules, preview assembly, capture script)
  - app-nav modules, preview assembly and capture script stay within the 500-line budget
- **nav-motion.test.mjs**（2 个测试）
  - styles/nav.css exists and degrades app-nav motion under reduced motion
  - nav.css stays a motion-only partial without palette or typography values
- **nav-sidebar.test.mjs**（6 个测试）
  - expanded sidebar is 224px wide and lays out the four regions
  - the active page is marked on the matching main entry only
  - collapsed rail is 52px with exactly four interactive entries and no history
  - expanding the sidebar after a collapse clears the on-demand search
  - the space name is ellipsified instead of breaking the top row
  - nav components stay presentation-only and import no api client
- **nav-space-menu.test.mjs**（5 个测试）
  - the menu is closed by default and opens with the path line and four actions
  - choosing a space action fires exactly its callback and closes the menu
  - Escape closes the space menu
  - a mousedown outside the menu closes it
  - the top row carries the collapse toggle and the decorative app icon
- **resource-page.test.mjs**（4 个测试）
  - the active tab renders its embedded config and only that one
  - the page exposes a tablist with the two approved tabs and correct selection state
  - clicking and arrow keys request tab changes through the controlled callback
  - arrow-key switches move keyboard focus to the newly selected tab once accepted

### src/renderer/components/app-shell

- **app-shell-space-echo.test.mjs**（1 个测试）
  - a deep link resolving alongside the startup restore wins without echo oscillation
- **space-coordination-persistence.test.mjs**（3 个测试）
  - a new space commit starts unconfirmed and is remembered only after its own write
  - unmounting invalidates in-flight restores so a stale owner never writes
  - production default I/O reads the preference once per mount, not per render
- **use-right-panel-dock.test.mjs**（11 个测试）
  - tracks the managed process badge from availability snapshots
  - auto-opens the processes tab when a process requests UI activation
  - does not collapse the sidebar for desktop process activation
  - closes the panel when the last file tab closes on the files tab
  - keeps the panel open when a file tab closes while a tool tab is active
  - restores per-kind preferred widths when the panel kind changes
  - adjusts and persists the width from the keyboard
  - opens the browser tab on a desktop open-browser-tab request
  - follows the open-on-agent-use setting for agent tab creation
  - ignores agent tab creation when the panel open setting is disabled
  - collapses the sidebar when the viewport is too narrow for both panels
- **use-space-coordination.test.mjs**（16 个测试）
  - first run prepares the personal space, readies it, and remembers it
  - stored space is restored through real validation without preparing
  - the decision waits for the explicit-session branch and defers to a found session
  - a confirmed-absent explicit session falls through to the stored space
  - an invalid stored space becomes unavailable without silently replacing it
  - retry recovers the stored space once validation succeeds again
  - personal prepare failure surfaces the reason and return-to-personal recovers
  - a user space change discards late validation results and is not overwritten
  - echoes of the committed space are ignored and do not re-persist
  - session cwd changes align the space (deep link / session creation path)
  - preference write failure never fakes being remembered
  - retry from a ready space is a no-op and no decision reruns after one commit
  - a committed external space short-circuits the pending startup decision
  - openCurrentFolder forwards the ready space to the desktop bridge
  - openCurrentFolder does nothing without a ready space
  - remounting the shell re-runs the startup decision and re-authorizes the space
- **use-workspace-navigation.test.mjs**（10 个测试）
  - keeps the open session when the cwd moves within the same project
  - closes the open session when the cwd crosses projects
  - keeps a matching new-session cwd and clears a stale one
  - suppresses the cwd bump exactly once after a restore selection
  - routes normal selection and closes the mobile sidebar
  - adopts created sessions and hydrates the missing project root
  - swaps the selected session identity on fork and keeps the row context
  - opens deep-linked sessions after resolving them from the list
  - wires the desktop menu actions for new and switch session
  - marks the initial restore as done for the not-found path

### src/renderer/components/browser

- **browser-error-message.test.mjs**（1 个测试）
  - Browser errors are localized by stable code without exposing Main messages
- **browser-renderer-contract.test.mjs**（7 个测试）
  - Browser remains a fixed right-panel resource and hides its native surface behind Settings
  - BrowserDock synchronizes native bounds, visibility, session ownership, and tool-result navigation
  - Main fails closed across Renderer reloads and hidden screenshots never present the native View
  - Browser access is demand-prompted and AppShell never eagerly grants a selected session
  - Browser Settings is reachable and separates permanent policy from temporary grants
  - Settings categories use a vertical sidebar with matching keyboard navigation
  - Browser Settings and Browser panel use the app language dictionary

### src/renderer/components/channels

- **channels-config.test.mjs**（8 个测试）
  - Telegram token dialog renders connection failures without closing
  - channel account settings expose the opt-in IM command switch
  - Feishu setup dialog provides one-click batch permission import and concise guidance
  - Feishu connection defaults to scan-create while keeping the existing-app fallback
  - Feishu existing-app setup remains available when manual mode is selected
  - generic channel login dialog renders Feishu QR state without exposing credentials
  - Feishu permission import JSON contains only tenant scopes required by the channel
  - Feishu account settings expose App ID, domain, and hot credential rotation
- **quick-channel-binding.test.mjs**（1 个测试）
  - active session header switches from quick bind to connected status

### src/renderer/components/interactive-tools

- **tool-card-structure.test.mjs**（2 个测试）
  - interactive tool modules and refactored integration owners stay under 500 lines
  - cards are composed above the input without replacing safety authorization
- **tool-cards.test.mjs**（16 个测试）
  - hidden ordinary cards ignore text, Enter, and response buttons
  - hidden questionnaire controls do not change answers
  - hidden terminal controls do not consume keys or send panel input
  - question card Close and Escape collapse three times without responding
  - single selection advances once, last question waits for manual submit
  - pending automatic advance is cancelled by ${action}
  - multi choice includes two selected labels and the unmodified supplemental text
  - multi choice permits only custom text
  - single custom text and options are mutually exclusive
  - skip is local, partial submit includes explicit empty slots, all empty cannot submit
  - preview renders the full source inertly without selecting or submitting
  - abandonment is confirmed inside the card and never sends drafts
  - ${method} uses the real non-modal card and preserves its return meaning
  - input-method Enter does not submit an ordinary text input
  - failed submission shows a retryable error and no restart execution button
  - custom panel Tab remains available without trapping keyboard focus

### src/renderer/components/messages

- **assistant-message-usage.test.mjs**（4 个测试）
  - completed messages show the model usage line
  - compact mode suppresses the per-message footer (usage row + copy button)
  - streaming messages never show the usage row
  - streaming header shows the live token estimate

### src/renderer/components/plugins

- **plugins-capability-prompt.test.mjs**（1 个测试）
  - the repair prompt disappears once a later successful install clears the pending operation
- **use-plugin-library-update.test.mjs**（4 个测试）
  - the shared scope unmounts probes even when the test body fails
  - a successful update posts the original identity, applies the returned package, and clears the busy mark
  - a failed update keeps the previous package and reports the error
  - the update response shape the hook commits matches the documented PluginsResponse
- **use-plugin-library.test.mjs**（12 个测试）
  - loads plugins on mount, groups by scope, and selects the first entry
  - an empty package list opens the add panel with no selection
  - a refresh keeps the selection when it still exists and falls back otherwise
  - the disable action updates the data and reports the outcome
  - removing the last package clears the selection and opens the add panel
  - removing one of several packages selects the first remaining package
  - a failed action maps missing developer tools to the repair guidance
  - a capability requirement holds the operation; retry re-runs it and cancel clears it
  - installing a source aligns the selection with the installed package and clears the form
  - a failed install keeps the form populated and reports the error
  - reload session chains the agent command, the reloaded callback, and a refresh
  - reload without a session does nothing and a failed reload reports the error

### src/renderer/components/session-sidebar

- **project-workspace-worktrees.test.mjs**（6 个测试）
  - creates worktrees, registers them optimistically, and refreshes the list
  - reports worktree creation failures without moving the cwd
  - reports dirty removals for confirmation and succeeds on force
  - moves the effective cwd back to the project root after removing it
  - an opened inactive-worktree hint keeps its 4s state across project switches
  - keeps worktree operation state alive across project switches
- **project-workspace.test.mjs**（8 个测试）
  - resolves the project root from loaded worktree data first
  - falls back to session project roots and then to the raw path
  - notifies the parent once per distinct cwd across data refreshes
  - syncs the selected cwd from the parent prop without feedback loops
  - validates custom paths and reports failures without moving the cwd
  - applies the default directory only when the host provides one
  - supports the native directory picker with validation outcomes
  - derives the switcher visibility and guidance for the current workspace
- **session-directory.test.mjs**（12 个测试）
  - loads sessions, the fetched running fallback, and the home directory on mount
  - the live running stream outranks later fetched snapshots
  - reconnects the running stream and refetches after a host restart
  - flags background completions as unread and clears them when running again
  - keeps a completion of the selected session out of the unread set
  - clears the unread marker of the session the user opens
  - applies incremental session upserts in modified order
  - removes deleted sessions, prunes their unread flag, and notifies the parent
  - a full refresh event triggers a reload of the session list
  - persists unread markers and prunes ids that no longer exist
  - shows refresh feedback until the sidebar timer clears it
  - runs deferred focus callbacks through the sidebar-owned timer and cleans up
- **session-groups.test.mjs**（5 个测试）
  - sessions render under the three date groups in group order
  - child sessions nest after their parent inside the same group
  - rows sort newest-first within a layer
  - loading and error states render their own messages
  - empty states distinguish a filtered search from an empty directory
- **session-item.test.mjs**（7 个测试）
  - commits a rename through the session API and notifies the parent
  - skips the rename request when the name is unchanged
  - blocks deleting a running session behind an alert
  - confirms deletion and reports the deleted id
  - surfaces delete failures through an alert and keeps the row usable
  - toggles fork collapse from the row button
  - closes the actions menu on Escape
- **session-sidebar-pickers.test.mjs**（8 个测试）
  - lists projects, selects one, and closes the dropdown
  - an outside click closes the dropdown and resets the custom path entry
  - escape in the project filter clears it and closes the dropdown
  - custom path validation failures stay visible until the path is fixed
  - a dirty removal surfaces the inline confirmation until it is resolved
  - creating a worktree submits the branch and closes the entry on success
  - a failed creation keeps the entry open and shows the error
  - escape closes the new-worktree entry without submitting
- **session-sidebar-startup.test.mjs**（3 个测试）
  - startup without a session link no longer auto-selects the most recent project
  - startup still restores an explicit URL session and aligns its directory
  - a missing explicit session reports not-found without choosing any space

### src/renderer/components/settings

- **general-settings-behavior.test.mjs**（5 个测试）
  - loaded ui state populates both toggles
  - a ui-state load failure leaves a visible error and defaults stay selected
  - a background-mode save failure rolls back the checkbox and reports the failure
  - a managed-process save failure rolls back and reports the failure
  - a chat appearance save failure surfaces the alert

### src/renderer/components/skills

- **add-skill-panel.test.mjs**（5 个测试）
  - searching renders catalog results with install actions
  - an empty catalog response reports that no skills were found
  - install success marks the package installed and notifies the parent
  - a failed install surfaces the error and keeps the install action available
  - a missing developer tool offers the capability repair prompt with retry and cancel
- **skill-detail.test.mjs**（5 个测试）
  - loads the skill file through the api client and disables saving while clean
  - editing marks the editor dirty through the imperative handle and callback
  - saving writes the edited content to the original cwd and file, then reports success
  - a failed save keeps the edited content and the dirty flag, and reports failure
  - saving an unchanged editor returns true without issuing a request
- **skills-config-journey.test.mjs**（6 个测试）
  - an editor switch with unsaved changes is held by the prompt; cancel keeps the current skill
  - discarding switches to the requested skill and clears the dirty flag
  - saving from the add-skill prompt continues only after the save succeeds
  - closing the dialog with unsaved changes is held; discard closes, cancel keeps it open
  - escape inside the prompt cancels the held transition
  - a clean close and a clean skill switch run immediately without a prompt
- **use-skill-directory.test.mjs**（10 个测试）
  - loads the skill list on mount and selects the first entry
  - a failed load keeps the list empty and surfaces the error
  - changing cwd clears the prior list and the replacement response wins
  - a superseded refresh success cannot overwrite the current list
  - a superseded refresh rejection cannot set the error state
  - a superseded refresh finalization cannot clear the current loading state
  - selection is kept when still present and falls back to the first entry otherwise
  - toggle success updates the visibility flag and releases the busy mark
  - toggle failure reports the error and never mutates the list
  - unmounting cancels an in-flight list request
- **use-skill-leave-guard.test.mjs**（7 个测试）
  - a clean editor lets the requested transition run immediately
  - a dirty editor holds the transition and the prompt appears instead
  - discarding continues the held action and clears the dirty flag
  - cancelling dismisses the prompt and keeps the current editor state
  - saving continues the held action only when the save succeeds
  - while the detail ref is detached the tracked dirty flag gates transitions
  - the beforeunload guard follows the tracked dirty flag over time

### src/renderer/hooks

- **active-session-live-sync.test.mjs**（1 个测试）
  - an idle active session subscribes before local prompts and refreshes only for its external changes
- **chat-scroll-policy.test.mjs**（4 个测试）
  - external-turn follow starts near the bottom and stops only for a meaningful upward scroll
  - run spacer must not count as content: bottom stays near even with a full-viewport spacer
  - explicit upward input disengages the scroll magnet during a session transition
  - upward key and touch intent are classified without intercepting editor keys
- **use-agent-session-context-usage.test.mjs**（1 个测试）
  - context usage survives session switches without a live runtime
- **use-agent-session-i18n.test.mjs**（2 个测试）
  - localizes stable event stream connection errors
  - registers critical session notification flows in both languages
- **useAudio.test.mjs**（3 个测试）
  - sound preference defaults to enabled when storage is empty or unavailable
  - sound preference preserves stored boolean semantics
  - sound preference writes are best effort
- **useObservedElementHeight.test.mjs**（4 个测试）
  - observed heights are rounded, non-negative, and published immediately
  - ResizeObserver updates height and disconnects during cleanup
  - the hook attaches when a visible ref element appears after the first render
  - disabled observation does not measure or construct a ResizeObserver

### src/renderer/hooks/agent-session

- **agent-session-line-budget.test.mjs**（1 个测试）
  - every chat engine file and the facade stay within the 500-line budget
- **session-hook-harness.test.mjs**（9 个测试）
  - a single harness restores every swapped global descriptor
  - two harnesses in one test restore the true pre-test descriptors
  - releasing the last lease twice is harmless and leaves the environment clean
  - a fresh install after a full release starts from the true pre-test state
  - a stale handle cannot release a later installation
  - releasing in reverse order still restores the true pre-test state
  - a second install preserves the active window and frame scheduler identity
  - later leases share listeners and storage with the first
  - a second install shares the task queue: retained frames still run
- **use-agent-session-facade.test.mjs**（2 个测试）
  - the public return shape of useAgentSession is stable for consumers
  - readingVisible flows through the facade to the reading branch
- **use-session-actions.test.mjs**（12 个测试）
  - sending appends an optimistic bubble and enters the streaming state
  - a blank message is never sent
  - sending while a run is active is ignored
  - a failed send rolls back the bubble, notifies and rethrows for the draft restore
  - the first message of a new session prepares, connects, prompts and promotes exactly once
  - a chosen model is applied to an already-created new session before prompting
  - a slash-command send settles through the host poll when no stream event arrives
  - a settlement poll for a superseded run cannot finish the newer run
  - abort asks the host to stop the run and tolerates failures
  - fork reports the new session only when the host did not cancel
  - navigate walks the tree first and loads the target context only after success
  - manual compaction reports success and failure without getting stuck
- **use-session-commands.test.mjs**（8 个测试）
  - /compact compacts with custom instructions and reports the result
  - /compact reports failures and cannot run twice at once
  - /reload refreshes the session, commands and models together
  - /name renames the session through the host
  - /session opens the stats panel with the host stats
  - /copy writes the last assistant text and complains when there is none
  - unknown or malformed commands are handed back to the extension layer
  - command errors surface as error notices
- **use-session-connection.test.mjs**（4 个测试）
  - concurrent new-session preparation shares one ensure_session call
  - promotion reports the new session exactly once
  - a failed ensure is retried on the next call
  - the event stream subscription is wired through the connection module
- **use-session-events.test.mjs**（14 个测试）
  - agent_start and agent_end drive the run lifecycle and refresh from the host
  - a late agent_end after the reconcile finish must not trigger completion twice
  - a delivered user message consumes the optimistic twin; a queued delivery appends
  - an assistant message_end is appended with a receive-time stamp
  - streaming updates after the run finished are dropped (no ghost bubble)
  - tool execution phases track their tools and settle back to waiting_model
  - retry and compaction events update their dedicated banners
  - prompt and extension failures surface as error notices
  - queue updates arrive from the host as the single source of truth
  - an external channel turn follows a reader near the bottom
  - an external channel turn does not drag a reader away from the bottom
  - a hidden external turn preserves visible away intent through mid-run and completion
  - the state reconcile net finishes a stalled run when the host reports idle
  - a reconcile response for a superseded run is dropped entirely
- **use-session-history-visuals.test.mjs**（3 个测试）
  - history visual scheduling survives StrictMode effect replay
  - history pagination passes a stable content anchor to visual restoration
  - history restoration attributes hidden growth to the stable content anchor
- **use-session-history.test.mjs**（11 个测试）
  - a late initial-history response cannot overwrite a newer navigation
  - a session that no longer exists clears the view without an error banner
  - loading older history prepends and preserves the reading offset
  - history pagination keeps data while hide cancels visual anchor compensation
  - a queued history frame cannot mutate a surface after unmount
  - a stale generation drops an in-flight older page
  - a stale cursor resets to a full reload
  - a revision mismatch between page and current history forces a full reload
  - deferred content replaces the placeholder block and keeps siblings
  - the deferred cache evicts the oldest key beyond the cap
  - a deferred response for a superseded generation is not applied
- **use-session-lifecycle.test.mjs**（8 个测试）
  - mounting a session subscribes live sync and loads the initial state
  - the mount load restores an in-flight external run
  - a prompt-running session settles through the prompt path
  - unmount tears down the live subscription and the connection manager
  - switching sessions re-subscribes to the new identity and cleans the old one
  - a session-changes event after unmount does not reload the session
  - a mount-load completing after unmount schedules no follow-up work
  - mount-load mirrors the host runtime state into the hook
- **use-session-models.test.mjs**（5 个测试）
  - the model directory loads into every derived shape
  - a fresh session picks the host default model for display
  - an aborted model load applies nothing
  - a new load cancels an in-flight manual refresh
  - a failed refresh keeps the cached list and reports the failure
- **use-session-queue.test.mjs**（8 个测试）
  - steer sends the running agent a steering command
  - a failed steer notifies that nothing was queued and rethrows
  - queueing without an active session is a loud failure, not a silent drop
  - follow-up and streaming-behavior prompts reach the host verbatim
  - a failed follow-up notifies that nothing was queued and rethrows
  - a failed streaming-behavior prompt notifies that nothing was queued and rethrows
  - recalling the queue clears it locally and returns the texts to the input
  - aborting compaction and changing thinking level reach the host; auto stays local
- **use-session-reading.test.mjs**（6 个测试）
  - reading wiring defaults to fully visible behavior
  - readingVisible=false detaches reading activity while the runtime keeps working
  - flipping readingVisible back on re-attaches reading and restores presence
  - a hidden page never masquerades zero geometry as scroll-to-bottom restoration
  - hiding an active reading surface tears down listeners, observers and timers; showing restores them
  - the follow loop pauses while hidden and resumes after re-visibility

### src/renderer/lib

- **api-fetch.test.mjs**（1 个测试）
  - fetch shim handles only relative API paths or the exact app origin
- **auto-session-title.test.mjs**（8 个测试）
  - auto titles are enabled by default
  - setting persistence round-trips through localStorage
  - a real first message qualifies
  - slash commands never qualify
  - messages shorter than two characters never qualify
  - qualification respects the settings toggle
  - missing window (non-renderer context) keeps the default enabled state
  - unknown localStorage values keep auto titles enabled
- **channel-message-style.test.mjs**（3 个测试）
  - channel bubbles keep distinct light/dark brand palettes; local follows the chat surface
  - every channel bubble palette meets WCAG AA text contrast
  - the local bubble tokens meet WCAG AA text contrast in both themes
- **chat-appearance.test.mjs**（4 个测试）
  - DOM application writes only normalized, controlled data attributes
  - controller loads defaults after a read failure without blocking startup
  - controller applies immediately and rolls back a failed save
  - serialized updates never let a late failure roll back a newer value
- **code-highlight-policy.test.mjs**（1 个测试）
  - large code blocks skip syntax highlighting using UTF-8 byte size
- **composer-submission.test.mjs**（2 个测试）
  - composer snapshots capture the raw value including token references
  - submission restore only applies when the input did not change meanwhile
- **copy-feedback.test.mjs**（2 个测试）
  - successful repeated copies replace the timer and disposal clears the last timer
  - clipboard rejection clears feedback and does not schedule copied state
- **display-path.test.mjs**（3 个测试）
  - POSIX home abbreviation requires an exact path-segment boundary
  - Windows paths compare case-insensitively with either separator
  - empty home and root homes remain well-defined
- **docx-preview-html.test.mjs**（1 个测试）
  - DOCX previews inject readable light and dark theme tokens with shared fonts
- **event-stream-connection.test.mjs**（2 个测试）
  - a subscription resolving after timeout is immediately closed and cannot emit
  - a late old connection cannot overwrite or close its replacement
- **file-suggestion-client.test.mjs**（4 个测试）
  - uses authoritative Host matches and preserves degradation metadata
  - falls back to the legacy files projection when matches is absent
  - normalizes Windows cache keys case-insensitively
  - bounds entries with LRU eviction and expires stale values
- **file-tab-state.test.mjs**（3 个测试）
  - consecutive closes reduce from the latest tabs and never select a closed id
  - closing an inactive tab preserves the active tab
  - opening selects a tab and refreshes its source session without duplicating it
- **file-viewer-load-state.test.mjs**（3 个测试）
  - a successful load structurally clears an earlier error
  - a refresh keeps the prior content as the diff baseline
  - reset removes every prior terminal state
- **image-normalization.test.mjs**（8 个测试）
  - base64ByteLength handles padding correctly
  - GIFs pass through byte-identical and reject when oversized
  - unsupported formats are rejected before decoding
  - small in-limit images pass through without re-encoding
  - AVIF is decoded and re-encoded even within the size limit
  - oversized images are downscaled to the max long edge before re-encoding
  - images within the size limit but beyond the max edge are still downscaled
  - images that stay oversized after compression are rejected
- **interactive-tool-store.test.mjs**（15 个测试）
  - collapse and reopen three times preserves answers and sends no commands
  - three mixed requests retain arrival order and count down exactly once
  - in-flight delivery and double click keep the card until confirmation
  - failed delivery preserves drafts and permits a successful retry
  - switches, page remounts and renderer reloads restore only host-verified drafts
  - backend restart expires pending cards and rejects old runtime replay
  - out of order snapshots cannot resurrect a closed request
  - a missing acknowledgement cannot overwrite authoritative completion
  - late delivery for session A cannot clear session B
  - custom render updates do not reopen collapsed content
  - corrupted or unavailable draft storage cannot block answering
  - a renderer reload after host shutdown reports expired drafts without reviving them
  - late custom-input failures do not resurrect an ended panel
  - queued old-runtime replay cannot revive a saved draft after verified shutdown
  - a request expiring while the renderer is absent produces an explicit stale-draft notice
- **latest-abortable-request.test.mjs**（4 个测试）
  - starting a request aborts its predecessor and advances generation
  - old cleanup cannot abort or finish its replacement
  - exact cancellation aborts the signal and prevents stale finally ownership
  - ChatInput passes signals and gates file suggestion result, error, and settlement
- **latest-request-gate.test.mjs**（1 个测试）
  - only the newest model-list request may publish its result
- **layout-preferences.test.mjs**（5 个测试）
  - loads a valid preferred width and falls back for missing or invalid values
  - saves a rounded usable preference without throwing on storage failures
  - caps the panel at 40vw while preserving the chat column
  - allows the panel to become narrower only when the viewport cannot fit all minimums
  - keyboard resizing follows the separator direction and respects bounds
- **locale-format.test.mjs**（2 个测试）
  - formats relative time with the selected locale and fixed thresholds
  - formats numbers and file sizes with locale-aware separators
- **mermaid-renderer.test.mjs**（2 个测试）
  - Mermaid SVGs are cached by code, theme, and renderer version
  - failed Mermaid renders are evicted so corrected runtime state can retry
- **message-render-key.test.mjs**（2 个测试）
  - entry-backed message keys survive history prepend and distinguish render roles
  - messages without entry ids retain object-local keys without using array indices
- **model-selection.test.mjs**（4 个测试）
  - null preferences enable every available model and disabling one expands exact refs
  - bare ids and thinking suffixes are recognized while unknown refs are preserved
  - enabling every known model collapses preferences back to all models
  - modelSupportsImages reads declared modalities and stays null when unknown
- **models-config-state.test.mjs**（6 个测试）
  - editing one model preserves v0.84 sampling, nullable headers, and unknown fields
  - setting a built-in provider base URL creates an override without redefining models
  - clearing a provider base URL preserves other provider fields and removes empty overrides
  - provider rename rejects conflicts and reserved or empty names without changing config
  - provider deletion and model addition compute config and selection without side effects
  - consecutive custom providers derive unique names from the reducer current state
- **notice-queue.test.mjs**（3 个测试）
  - adding a notice does not extend the oldest notice lifetime
  - a pending notice receives its full lifetime when it becomes visible
  - marking a notice as exiting preserves its absolute expiry
- **plugin-presentation.test.mjs**（2 个测试）
  - formats plugin resource counts with the selected locale
  - localizes plugin status and version summaries
- **process-flow.test.mjs**（6 个测试）
  - formatTurnDuration renders compact seconds/minutes/hours
  - computeTurnDurationSeconds needs both timestamps and a positive gap
  - flattens thinking/toolCall/text interleaved across messages in original order
  - empty thinking/text blocks are skipped but keep their original block index
  - final message block subset uses subset indices and counts toward totals
  - custom messages always contribute one item
- **quick-channel-binding-layout.test.mjs**（4 个测试）
  - right-aligns the desktop popover without crossing the viewport gutter
  - shrinks and clamps the desktop popover in a narrow window
  - centers the mobile popover within the viewport
  - places the popover above the trigger when a short viewport lacks room below
- **session-history-update.test.mjs**（2 个测试）
  - streamed local messages stay aligned and survive an older-page prepend
  - optimistic replacement and rollback update messages and entry ids together
- **session-list.test.mjs**（9 个测试）
  - groups sessions into calendar-aware recency buckets
  - searches useful session metadata and retains matching ancestors
  - builds stable compact titles from names, prompts, and ids
  - initial session restore waits for a successful list result
  - a successfully loaded empty list completes the not-found restore path
  - initial session restore returns the matching session
  - derives recent projects deduped by project root in activity order
  - derives recent projects from the raw cwd when no project root is known
  - derives no projects from an empty or cwd-less session list
- **session-pagination.test.mjs**（3 个测试）
  - tail refresh preserves loaded older pages and replaces overlapping tail entries
  - revision changes and non-overlapping tails reset pagination
  - prepend deduplicates entries and rejects stale revisions
- **session-sidebar-state.test.mjs**（2 个测试）
  - upserts and sorts individual session changes
  - deletes one session and requests full refresh for ambiguous events
- **session-tree.test.mjs**（5 个测试）
  - builds a flat forest sorted by most recent modification
  - nests children under their existing parent and sorts every level
  - nests a multi-generation chain through each direct parent
  - a session whose direct parent is missing stays at root level
  - sessions whose parents reference each other stay out of the root list
- **space-startup.test.mjs**（7 个测试）
  - startup space waits while the stored preference has not been read
  - startup space restores the stored directory immediately without an explicit session
  - startup space prepares the personal space on first run without an explicit session
  - startup space waits while an explicit session link is unresolved
  - startup space defers to the explicit session once it is found
  - startup space falls back to the space tiers after the explicit session is confirmed absent
  - stored space parsing keeps valid paths and normalizes garbage shapes to no record
- **strict-integer.test.mjs**（3 个测试）
  - strict decimal integers accept safe in-range ASCII digits
  - strict decimal integers reject exponent, decimal, sign, whitespace, zero, and unsafe values
  - invalid optional integer edits preserve the current value while empty clears it
- **syntax-highlight.test.mjs**（3 个测试）
  - custom aliases and common grammars go through the real highlighter
  - languages outside the startup set remain available after the async load
  - plain text and unknown ids fall back without highlighting
- **text-diff.test.mjs**（4 个测试）
  - bounded diff preserves ordinary line edits
  - two high-difference 256 KB inputs enter fallback before Myers allocation
  - line, edit-distance, and trace budgets each produce a summary fallback
  - bounded Myers scripts reconstruct both inputs across varied edits
- **thinking-expansion-store.test.mjs**（2 个测试）
  - thinking expansion uses stable ids and synchronizes subscribers without storing content
  - registry isolates sessions, bounds retained stores, and clears deleted sessions
- **tool-message-index.test.mjs**（2 个测试）
  - tool results and durations are indexed once for only their owning assistant
  - sub-second runs keep their millisecond duration instead of rounding away
- **unread-session-storage.test.mjs**（4 个测试）
  - prefers the desktop key and removes a stale legacy key
  - migrates valid legacy data exactly once
  - handles missing and corrupt data without throwing
  - writes only the desktop key and removes both keys for an empty set

### src/shared

- **allowed-roots.test.mjs**（3 个测试）
  - TTL is short without a healthy watcher and long with one
  - allowFileRoot updates the live cache and invalidates an in-flight scan generation
  - an invalidated async scan cannot restore a stale cache entry
- **ansi.test.mjs**（4 个测试）
  - strips ANSI escape sequences
  - normalizes boxed custom panel lines while preserving ANSI codes
  - parses ANSI style segments and reset codes
  - maps 256-color SGR codes
- **attachment-tokens.test.mjs**（9 个测试）
  - findAttachmentTokens parses unquoted, quoted and mixed tokens in order
  - findAttachmentTokens ignores prose mentions and emails
  - insertAttachmentToken appends a trailing space and quotes spacey paths
  - removeAttachmentToken deletes the token and one trailing space
  - backspaceAtTokenEnd deletes the whole token when the caret sits at its end
  - looksLikePath and isImagePath gate chip rendering
  - attachmentTokenName reduces staged paths to their basename
  - segmentByAttachmentTokens splits mixed prose into text and token segments
  - attachmentTokenText round-trips through findAttachmentTokens
- **channel-message.test.mjs**（4 个测试）
  - attachment-only prompts use a non-empty metadata-free text block
  - actual user text is passed through byte-for-byte
  - attachment copy text preserves useful filenames and media types
  - legacy image messages derive copy text from their image blocks
- **chat-appearance.test.mjs**（4 个测试）
  - chat appearance exposes the four font sizes and two layout modes
  - normalization preserves known values and repairs fields independently
  - normalization migrates the removed full-width value to wide
  - malformed chat appearance values use backward-compatible defaults
- **compaction-summary.test.mjs**（3 个测试）
  - separates pi file metadata tags from the visible compaction summary
  - leaves normal summaries unchanged
  - keeps file-like tags that are part of the summary body
- **draft-store.test.mjs**（5 个测试）
  - draft storage clones values, writes only on flush, and removes empty drafts
  - v3 drafts never persist legacy attachment fields
  - loading a v2 draft surfaces legacy images and files for token migration
  - draft controller flushes ownership on key changes and disposal
  - draft controller reports persistence failures
- **file-fuzzy.test.mjs**（3 个测试）
  - at queries require a token boundary and support open quoted paths
  - file entries derive directories and rank exact, prefix, path, and fuzzy matches
  - insertions preserve drill-down caret and quote paths containing spaces
- **file-links.test.mjs**（9 个测试）
  - resolves absolute markdown file links and strips line suffixes
  - resolves absolute file links outside cwd
  - resolves relative markdown file links against cwd
  - does not let relative links escape cwd
  - resolves markdown assets from the document directory within cwd
  - does not treat app or external URLs as file links
  - resolves Windows file URLs without a synthetic leading slash
  - resolves UNC file URLs and backslash UNC paths
  - rejects malformed four-slash file URLs instead of treating them as UNC
- **file-types.test.mjs**（3 个测试）
  - detects image, audio, and document preview paths
  - extracts extensions from mixed path styles
  - does not invent extensions for bare names, dotfiles, trailing dots, or directories
- **file-url.test.mjs**（5 个测试）
  - canonical file URLs round trip POSIX, Windows, and UNC paths
  - rejects relative, escaping, malformed, and four-slash file paths
  - markdown serialization escapes labels and emits the canonical URL
  - serialized local file references parse back into structured queue segments
  - path containment uses component boundaries and Windows case folding
- **font-stack.test.mjs**（1 个测试）
  - renderer CSS uses the shared system and CJK font stacks
- **git-status.test.mjs**（2 个测试）
  - git status counts staged, modified, untracked, and conflict records
  - rename source records are skipped and empty output is clean
- **heartbeat-liveness.test.mjs**（3 个测试）
  - heartbeat remains healthy while ticks and acknowledgements are current
  - heartbeat times out only when the local timer kept running
  - sleep, event-loop stalls, and wall-clock rollback re-establish the heartbeat baseline
- **managed-process-policy.test.mjs**（5 个测试）
  - command policy blocks detach patterns and LAN binds
  - command policy accepts the exact 32 KiB worst-case escaping boundary and rejects one byte more
  - cwd must remain under real owner root
  - output is sanitized and loopback URLs are credential safe
  - label removes control characters and is bounded
- **markdown.test.mjs**（7 个测试）
  - Markdown plugins preserve GFM/math, add AST path links, and sanitize raw HTML
  - links POSIX, Windows, UNC, and canonical file URLs from ordinary text nodes
  - links multiple paths while preserving trailing punctuation and @ project references
  - separates adjacent local paths joined by English or Chinese prose
  - links local filenames containing spaces and absolute directories without extensions
  - AST transform skips existing links, images, code, inline code, HTML, and math
  - does not treat web URLs, relative @ references, or bare drive roots as local paths
- **message-display.test.mjs**（7 个测试）
  - splits trailing final answer blocks from process blocks
  - keeps pre-tool text in process blocks
  - does not expose text before a trailing tool call as final answer
  - drops empty thinking blocks after completion
  - keeps empty thinking while streaming
  - keeps an empty failed assistant message renderable and exposes its provider detail
  - renders a generic failure state when the provider omits error detail
- **normalize.test.mjs**（2 个测试）
  - assistant tool calls normalize legacy ids, names, arguments, and malformed inputs
  - non-assistant and scalar assistant messages retain identity
- **patch.test.mjs**（6 个测试）
  - parses paired changes into split diff rows
  - pads one-sided additions and removes timestamp suffixes from file paths
  - treats header-shaped deletion and addition lines as hunk content
  - consumes exact hunk counts across multiple files and preserves no-newline markers
  - rejects malformed or incomplete hunks so callers can render the raw patch
  - returns null for text without diff lines
- **questionnaire.test.mjs**（6 个测试）
  - questionnaire multi choices and raw text survive the model envelope
  - unanswered questions are explicit and never guessed
  - single choice echoes the full preview and preserves original result fields
  - empty submissions, invalid indices, and conflicting single answers are rejected before settlement
  - abandonment returns the canonical decline without draft answers
  - structured adaptation accepts only supported schema and original semantic guards
- **session-file-references-core.test.mjs**（2 个测试）
  - session ids require a complete UUID shape
  - file references match exact nested, encoded, Windows, and line-suffixed paths
- **skill-commands.test.mjs**（8 个测试）
  - findLeadingSkillCommand parses the leading command with greedy name
  - findLeadingSkillCommand accepts a bare command with no arguments
  - findLeadingSkillCommand ignores commands that are not at message start
  - findLeadingSkillCommand rejects invalid or incomplete names
  - findLeadingSkillCommand stops the name at the separator
  - isValidSkillName enforces pi name rules
  - splitLeadingSkillCommand splits badge from prose and keeps the separator
  - splitLeadingSkillCommand requires a separator or end of text after the name
- **windows-managed-process-helper.test.mjs**（5 个测试）
  - Windows helper resolution accepts only the fixed development or packaged directory
  - Windows helper resolution fails closed on manifest drift and byte tampering
  - Windows update gate proves the fixed helper can be atomically moved and restored
  - Windows update gate fails closed when the helper is locked and never starts a move
  - Windows update gate rejects a real sharing lock and succeeds after release
- **worktree-path.test.mjs**（7 个测试）
  - Windows worktree paths compare independent of slash, drive case, path case, and trailing separators
  - comparison helpers work without a process global, as in the sandboxed renderer
  - POSIX worktree paths normalize separators without changing case
  - git dir and common dir comparisons share the same Windows canonical rules
  - worktree removal matches alternate separators and passes Git its canonical path
  - resolveProject returns the same git-reported projectRoot for main and linked worktree toplevels
  - resolveProject keeps a repo subdirectory as its own project
- **worktree.test.mjs**（3 个测试）
  - parses staged, modified, untracked, and conflicted git status entries
  - skips the original path record emitted for porcelain rename entries
  - reports a clean repository for empty porcelain output

### src/shared/toolchains

- **action-validation.test.mjs**（1 个测试）
  - accepts only fixed toolchain actions with exact safe fields
- **catalog-schema.test.mjs**（6 个测试）
  - parses a fixed, allowlisted catalog and normalizes hashes
  - rejects latest aliases and placeholders in versions or URLs
  - rejects non-HTTPS, credentialed, and non-allowlisted artifact URLs
  - rejects missing integrity metadata, zero sizes, and duplicate variants
  - restricts installer and archive combinations
  - rejects unknown schema fields and duplicate component versions while allowing retained versions
- **errors.test.mjs**（2 个测试）
  - preserves stable toolchain metadata without exposing an arbitrary cause
  - bounds low-level cause codes and normalizes unknown failures

### src/smoke

- **ui-preview-data.test.mjs**（5 个测试）
  - the sample space is the fixed personal workspace
  - sessions span all three date groups with unique ids at every reference instant
  - sample sessions include parent-child chains and status sets
  - titles and chat copy include long Chinese and long English samples
  - plugins cover both scopes and skills cover several sources

## 五、方法与诚实的局限

1. **提取方法**：用正则从源码提取 `test(...)` 名称，共得 1,401 个；套件实跑 1,390 个，相差 11 个（约 0.8%），
   来源为注释/字符串里的 `test(` 误匹配、循环生成的测试名（如 phase-8-fixture-restoration 无法静态提取）。
2. **结构家族的边界是模糊的**：共用了三种识别模式仍经历三轮补漏（`new URL` 直读、辅助函数包装、path.join/变量中转）。
   最终名单以『有 assert.match 且有文件读取』的 46 个候选逐个人工甄别后确定，不能保证 100% 无遗漏。
3. **覆盖判定深度**：『删』判定基于目标行为测试的名称与抽查（如 leave-guard 7 个行为测试逐条读过），
   未对每个正则断言与行为断言做逐字语义对照。标『待确认』的条目在迁移前必须人工核实。
4. **跳过的 1 个测试**未查明跳过原因（疑似 Windows 平台守卫），迁移时需在 Windows 上补验。
5. 本清单只挖规则，不评价规则本身的对错——某条规则是否值得保留，在垂直切片迁移时再决定。

---

## 六、第 1 步执行记录（立骨架，2026-10-13）

**交付物：**

1. **测试卫生守卫**（`scripts/test-hygiene.mjs`）：`npm test` 启动前机器拦截两类反模式——把自家源码当文本读取后做断言、stub 自家模块/记录内部调用顺序。七条静态规则，接入 `scripts/test.mjs`。
2. **豁免账本**（`scripts/test-hygiene-allowlist.mjs`）：43 个存量文件，每条带判定与迁移去处。名单清空 = 迁移完成；守卫每轮报告"检测不再命中"的条目，需人工确认后移除。
3. **流放地**（`scripts/check-architecture.mjs`）：首批居民为原 5 个行数预算测试（7 个测试）的全部约束，已从测试套件删除并迁入。注册为 `npm run check:architecture`，接入 `verify.mjs`。
4. **宪法**（`tests/README.md`）：三判据、五边界、四层分区、mock 白名单、迁移协议，入库成文。测试运行器同步接入 `tests/` 发现区。

**守卫上线即修正第 0 步的两处错误：**

- 误判：`draft-persistence.test.mjs` 原判"保留 5"，实为"保留 4 转化 1"（第 5 个测试读源码做正则，第 0 步只读了文件前半部分）。
- 漏判：第 0 步未发现 stub 自家模块家族的 3 个文件（`user-message-skill-badge`、`process-flow`、`assistant-message-usage`，均 stub 自家 MarkdownBody/SessionProfiler）。已补入账本，判定"新发现 待确认"。

**验证证据：**

- 注入故意违规的探针测试 → `npm test` 在套件启动前拦截，点名文件与规则，退出码 1（探针已删除）。
- `PI_ARCH_BUDGET_LINES=10 node scripts/check-architecture.mjs` → 列出全部超标文件，退出码 1；正常预算 → 退出码 0。
- 完整套件：1,383 个测试（1,390 − 已流放 7），1,382 通过，1 跳过，0 失败，退出码 0。
- 守卫进度表：42 个存量命中豁免，1 个检测盲区（`nav-sidebar` 的 readdirSync 扫描形式，静态识别盲区已文档化）。
- eslint 与 prettier 对全部新增/改动文件通过。

**诚实声明：** 守卫的静态识别无法覆盖所有读取形式（readdirSync 目录扫描、模板字符串拼路径），它是减速带与进度表，不是完美监狱；造句关与独立关仍靠评审执行。本次未运行完整 `npm run verify`（含打包与多组 Electron E2E，耗时长），验证以单项检查逐个执行代替。

---

## 七、政策修订记录（2026-10-13，第 1 步补充）

**行数预算降级为卫生指标。** 复核结论：行数是复杂度的间接代理，不是危害本身——把它设为永久阻断会绝对化一条经验性规则，并诱发"为过检查而人为假拆分"。

- `check-architecture.mjs` 改为两级执法：**不变量**（结构契约：必备模块到岗、目录存在）阻断；**卫生指标**（500 行预算）默认只报告、退出码 0，`--strict` 可临时强制。
- 硬约准入三条件入宪（tests/README.md）：保护真实边界、检查关系本身而非代理指标、不冤枉好人。满足者（如依赖方向禁令）才配阻断；经验性规则只配报告。
- 顺带修复：目录/文件缺失时从崩溃改为优雅 FAIL；`group.files` 全部纳入存在性契约（原实现缺失时会直接抛异常）。

---

## 八、第 2 步执行记录（切片一批：会话侧栏 + 技能配置，2026-10-13）

**处置明细（账本 43 → 40）：**

1. **session-sidebar-timer-contract.test.mjs（3 个测试）——删除**，规则去向：
   - 目录刷新反馈计时器卸载取消 → 新行为测试 2 个（session-directory.test.mjs，含"迟到响应不排期"守卫规则）；
   - 延迟聚焦经属主 deferFocus → 已有行为测试覆盖（"runs deferred focus callbacks…"，第 0 步曾误判为孤立——当时 grep 证被截断，本次断言级核实纠正）；
   - 行内重命名选定/标题乱码计时器卸载取消 → 新行为测试 2 个（session-item / pi-agent-title）；
   - 下拉焦点不得自建 setTimeout → 所有权禁令流放至 check-architecture.mjs（PATTERN_BANS，阻断级）。
2. **skills-unsaved-changes-contract.test.mjs（6 个测试）——删除**：5 条规则由 use-skill-leave-guard / skills-config-journey / skill-detail 既有行为测试断言级覆盖；第 6 条（Settings 层 Escape/关闭/切页过守卫）为孤立规则，新增 settings-config-journey.test.mjs 3 个真 DOM 行为测试补上后删除。
3. **skills-config-request-contract.test.mjs（2 个测试）——删除**：use-skill-directory 既有 9 个行为测试断言级覆盖。

**牙齿验证（突变测试，全部先红后恢复）：** 删除四处生产代码的清理逻辑/守卫逻辑，对应测试逐一变红（1/1/1/3 个失败），git 恢复后全绿。禁令注入违规文件 → check-architecture FAIL、退出码 1。

**守卫执法记录：** 新写的 pi-agent-title 测试因命名空间含 "stub" 字样被守卫当场拦截，改名后通过——禁令对新代码生效的第一次实战。

**套件：** 1,379 个测试（1,383 − 删除 11 + 新增 7），1,378 通过，1 跳过，0 失败，退出码 0。本剩 40 个文件（39 命中豁免 + 1 个 readdir 盲区待人工）。

**已知事项：** session-directory.test.mjs 达 504 行，行数卫生指标（建议级）正确告警——经判断保留内聚性，不动刀。

---

## 九、第 2 步执行记录（切片二批：chat input 域，2026-10-13）

**处置明细（账本 40 → 35）：**

1. **chat-window-visibility-contract.test.mjs（2 个测试）——删除**：可见性边界规则由 chat-input-visibility（hidden/aria-hidden/inert/编辑器同一性）与 chat-window-composition（观察者/监听器/几何读写计数器在可见→隐藏→可见→卸载全程断言）行为级覆盖。
2. **queued-command-error-contract.test.mjs（3 个测试）——删除**：失败通知+重抛已由 use-session-queue 三个行为测试覆盖；缺会话竞态从仅测 steer 扩展到三条路径（steer/followUp/promptWithStreamingBehavior 各自拒绝并报通知）；纯文本队列与失败还原由 file-reference/visibility 既有行为测试覆盖。
3. **image-file-processing.test.mjs（2 个试）——删除**：剪贴板图片管线由"pasted clipboard images are staged and referenced as chips"行为测试覆盖（规范化输出 base64、暂存请求形状、chip 落位）；role=alert 语义由新行为测试"an unsupported attach surfaces as a dismissible alert banner"覆盖（触发真实失败路径并断言可关闭）。
4. **latest-abortable-request.test.mjs——瘦身**：删第 4 个接线正则测试，前 3 个行为测试留存。新增行为测试补齐建议错误路径的门控（"a late failed suggestion response cannot override a newer success" + "a failed suggestion for the current token announces itself"）。
5. **draft-persistence.test.mjs——瘦身**：删第 5 个接线正则测试，前 4 个行为测试留存。新增行为测试覆盖切键提交与卸载提交（"switching draft keys commits the previous key and unmount commits the current one"）。

**突变验证（5 个突变，4 红 1 不红）：**

- 切键显式提交行移除 → 测试不红：该行与控制器自身的键切换 flush 冗余，移除是行为保持的重构——测试通过"重构不红"判据，证明其测行为而非代码行。
- 卸载提交移除 → 红（承重行为）；建议错误门控移除 → 红；followUp/prompt 缺会话报错篡改 → 红；role=alert 移除 红。

**套件：** 1,374 个测试（1,379 − 删除 9 + 新增 4），1,373 通过，1 跳过，0 失败，退出码 0。账本 35（34 命中豁免 + 1 readdir 盲区）。

## 十、第 2 步执行记录（切片三批：样式与设计令牌域，2026-10-13）

**处置明细（账本 35 → 27）：**

1. **整删 7 个测试文件（18 个测试），约束全部流放**：
   - App.theme（1）→ check-design §A：App 启动/崩溃表面令牌与弃用值禁令；
   - semantic-colors（4）→ check-design §B-E：组件状态色禁令、ModelsConfig 连接测试徽章语义色、亮暗语义契约完整性、WCAG AA 对比度（期望值 4.5 来自 WCAG 规格而非项目自定）；
   - theme-tokens（1）→ check-design §F：已删令牌回归禁令；
   - font-stack（1）→ check-design §G：CSS 变量与 TS 常量一致性 + CJK 字族；
   - nav-motion（2）→ check-design §H：reduced-motion 回退与 motion-only 边界；
   - settings-chat-appearance（4）→ 常量部分 → check-design §I-L（选项表/文案/CSS 缩放/dock 接线/字号缩放）；**行为部分转写**（见第 3 条）；
   - css-structure（5）→ check-architecture 新增「CSS 接线契约」（导入顺序=级联契约、孤儿分片、渲染器树内样式清点、globals.css 入口契约），行数并入其卫生指标组（chat.css 忠实原豁免注释，不计预算）。
2. **theme-init.test.mjs——瘦身**：删除第 4 条（源码顺序正则）。其规则三分解：index.html 加载顺序 → check-design §M（防主题闪烁的构建契约）；theme-init 的 colorScheme 同步 → 新行为断言（导入时刻的平台面上断言 style.colorScheme）；useTheme 的 colorScheme 同步 → 新行为测试（见第 3 条）。前 3 条行为测试原样保留。
3. **行为规则补齐（转化）**：
   - 新增 `src/renderer/hooks/use-theme.test.mjs`（2 个测试）：平台边界替身（宪法白名单的「不可真实化平台」）+ 真实 hook + react-test-renderer，从 DOM 表现断言「无存储偏好时跟随系统浅色」「每次切换同步 dark class、colorScheme 与存储」；
   - 新增 `general-settings-behavior` 1 个测试：保存进行中时聊天外观两个下拉禁用、语言与主题保持可用、落定后全部恢复（原第 1 条里 `disabled={chatAppearanceSaving}` 孤立规则的写；保存失败提示已由既有行为测试覆盖，经断言级核实）。
4. **辅助迁移**：`src/renderer/styles/css-sources.mjs` → `scripts/css-sources.mjs`（迁移后读取者只剩 check 脚本；测试引用它仍会被卫生守卫 css-source-helper 规则拦截）。

**搬迁忠实性的过程记录（诚实）：** check-design 初版有两处搬迁偏差，被「先跑原测试作为基准真值」当场暴露——ModelsConfig 区段索引错用了全源文件坐标（原文在 modelDetail 切片内取索引，源文件 178 行处有更早的 onClick={onDelete}）；字号缩放断言漏拼 chat-window/welcome.tsx（scaledChatFont(20) 在 welcome.tsx:36）。修正后 13 组契约全绿。此为流程设计使然：流放搬迁以原测试为基准真值逐条对照，不信任搬迁者自己的记忆。

**突变验证（6 个突变，全部先红后恢复，git diff 确认零残留）：**

- tokens.css dark 主题删 --danger → check-design FAIL（点名「dark 主题缺少语义令牌」）；
- main.tsx 交换 tokens/base 导入顺序 → check-architecture FAIL（级联契约）；
- useTheme.ts 删 colorScheme 行 → use-theme 行为测试 2/2 红；
- theme-init.ts 删 colorScheme 行 → theme-init 新行为断言红（其余 3 条不受影响）；
- general-settings.tsx 删 disabled={chatAppearanceSaving} → 新行为测试红；
- 生产代码回滚后全套件复绿。

**套件：** 1,359 个测试（1,374 − 删 18 + 新增 3：use-theme 2 + general-settings 1，theme-init 内 −1 +1），1,358 通过，1 跳过（Windows），0 失败，退出码 0，21.4 秒。守卫于套件前通过，无新增违规。

**其他验证：** eslint 与 prettier 对全部新增/改动文件通过（prettier 格式化后复跑测试与检查，全绿）；双 typecheck（main/renderer）通过（确认删除的 .mjs 辅助无生产引用）；`npm run smoke`（真实 Electron 启动 + host 连接 + 渲染器 RPC/会话/worktree/git/watch/download/skills/channels/**chat-appearance**/toolchain 检查）通过，exit code 0。

**已知事项与未做：** 未运行完整 `npm run verify`（含多组重型 E2E 与打包，耗时长；与切片一、二批同政策，以单项验证代替，smoke 已覆盖本切片域的现实验证）；Windows 跳过的 1 个测试仍待 Windows 环境补验（沿用第 0 步遗留事项）。账本余 27 个文件。

## 十一、第 2 步执行记录（切片四批：i18n 词典与离线资产域，2026-10-13）

**处置明细（账本 27 → 22）：**

1. **整删 5 个测试文件（14 个测试），全部为纯流放**——判定表所示，这 5 个文件没有孤立行为规则，只含静态约束：
   - i18n-dictionaries-structure（5）→ **check:i18n** 新增词典组合结构检查（`scripts/renderer-i18n-structure.mjs` 纯函数库 + `check-renderer-i18n.mjs` 接线）：分片全量接入组合根、分片键集互斥且合并与组合导出严格相等、值钉在拆分前逐键核对的基准指纹（排除 interactive-tools 模块与 Phase 4 导航键，忠实原豁免）、历史导出契约；**行数预算**（≤500 行）并入 check-architecture 新「i18n 词典」卫生组（报告级）。
   - i18n-critical-ui（1）→ **check:i18n**：关键 UI 场景（空态/删除确认/外部冲突/频道状态/更新失败）双语值逐字相等 + 属主源码确实以 t("key") 消费。
   - offline-assets（2）→ **check:desktop-security** 新模块 `desktop-security/offline-assets.mjs`（7 条不变量，总数 79 → 86）：零 CDN、KaTeX CSS 本地打包、数学字体包内相对路径、CSP 字体/样式源白名单。
   - desktop-workflow（5）→ 新脚本 **check:desktop-workflow**（`npm run check:desktop-workflow`，接入 verify.mjs）：四目标打包矩阵、Windows 质量门（无 Xvfb 依赖）、更新元数据逐平台交叉核对、未签名 Beta 状态、SBOM/第三方声明随包。
   - smoke-electron-isolation（1）→ 新脚本 **check:test-infra**（`npm run check:test-infra`，接入 verify.mjs）：冒烟隔离 userData 目录必须先设后清。
2. **新增检查器行为测试 6 个**（`scripts/renderer-i18n-structure.test.mjs`）：检查器是纯函数库，全部输入由调用方注入，测试用合成词典夹具验证各失败路径（孤儿分片、缺导出、键冲突、合并不等值、指纹漂移、豁免键不误报、导出契约、关键场景缺值/缺消费）。
3. **词典校验走真实数据**：CLI 直接动态导入真实词典 TS 模块做结构校验（Node 22.18+ 默认类型剥离），比解析源码文本更接近被保护的事实；`check:i18n`/`check:browser-i18n` 命令补齐 strip-types 标志（与 check:design 同式）。

**基准真值：** 迁移前 5 个文件 14/14 全绿；流放搬迁逐条对照原断言。

**突变验证（6 组，全部先红后恢复，git 零残留）：**

- 组合根删掉 settings 分片接线（孤儿分片，无编译错误的静默失效）→ check:i18n **7 条失败，四层独立检查同时咬住**（接线点名 / 合并不等值 / 指纹漂移 / 关键场景文案失配——updateErrorOffline 恰在 settings 分片里）；
- 词典值单字符漂移（"No skills found" → "No skills found."）→ 三条规则同时点名（既有兜底一致性 / 指纹基线 / 关键场景）；
- CSP 混入 fonts.googleapis.com → check:desktop-security FAIL 精确报告；
- 工作流 windows-2025 → windows-2022 → check:desktop-workflow FAIL 精确报告；
- 冒烟启动器删 rmSync 清理 → check:test-infra FAIL 精确报告；
- `PI_ARCH_BUDGET_LINES=300` → 「i18n 词典」组正确报告超标分片（报告级，政策允许默认不阻断）。

**搬迁忠实性的过程记录（诚实）：** check 流放与检查器测试各暴露两处人因偏差，均被"原测试为基准真值"与红绿循环当场纠正——modelConfigConflict 中文文案漏句尾句号（对照原文补齐）；检查器测试的期望构造错误（夹具让同一分片既缺导出又贡献键冲突，与实现的跳过语义矛盾；zh 侧重复键漏报），期望必须来自独立构造的事实，不是从实现的输出里抄回来。

**套件：** 1,346 个测试（1,354 − 删 14 + 新增 6），受限并发（`--test-concurrency=3`）下 1,345 通过、1 跳过（Windows）、0 失败。守卫于套件前通过，无新增违规；账本 22（21 命中豁免 + 1 readdir 盲区 nav-sidebar，沿用）。

**诚实声明（满并发下的偶发）：** 满并发跑全套件时，agent-host 的 file-watch（租约释放，隔离复跑 47.5 秒通过）与 plugin-worker（进程树终止，隔离复跑 4 次中 1 次失败）两个进程类测试在系统高负载（负载均值 55–95，正常约为核数）下偶发超时；两者均不在本切片域内、文件未改动、受限并发全套件全绿——判定为机器过载下的偶发，非切片回归。留档以供复验。

**其他验证：** eslint 0 错误（全部新增/改动文件）；prettier 格式化 6 个新文件后全绿复验；check:i18n（1063 静态键 + 11 分片组合满足基准）、check:desktop-security（86 条）、check:desktop-workflow、check:test-infra、check:architecture 全绿。

**已知事项与未做：** 未运行完整 `npm run verify`（同前三批政策：重型 E2E 与打包耗时长；本切片无 UI 行为变更，两个新 check 已直接静态核验其域，且已接入 verify 供后续统一执法）；1 个 readdir 盲区条目沿用；Windows 跳过的 1 个测试待 Windows 环境补验（第 0 步遗留）。账本余 22 个文件。

## 十二、第 2 步执行记录（切片五批：消息渲染域，2026-10-13）

**处置明细（账本 22 → 18）：**

本切片处理「stub 自家模块」家族：四个账本文件（identity + 三个"新发现 待确认"）外加一个盲区补获文件。它们共有的病灶：断言本身大多是真行为（真实 DOM 挂载或渲染树断言用户可见结果），但为了让组件图能在 Node 里跑起来，把十几家自家模块换成了假实现。

1. **markdown-body-component-identity.test.mjs——转化完成**。身份稳定性规则（react-markdown 按组件类型调和，components 每次返回新对象会让代码块/图片/表格每次渲染重挂载——丢选区、闪烁）只有对真实模块图才有意义：旧版证明的是十个假叶子的稳定性，对出厂的 MarkdownBody 什么都证明不了。现在加载真实模块图断言同一规则。
2. **user-message-skill-badge.test.mjs——确认+转化**。四个测试全是真行为（jsdom 真实挂载，断言徽章与正文），病灶仅在 13 家 stub；撤 stub 后同一断言跑在真实模块图上。
3. **process-flow.test.mjs——确认+转化**。三个测试是真行为（思维行展开状态、工具行无箭头、顺序与旋转态），两套 stub（i18n + MarkdownBody/SystemMessages）全撤。i18n 真实现无需 DOM（模块级有 typeof 守卫）；MarkdownBody 此前渲染 null 的位置现在真渲染 markdown。
4. **messages/assistant-message-usage.test.mjs——确认+转化**。同上，用量行/紧凑页脚/流式行为断言原样保留。
5. **message-view.test.mjs——盲区补获**。本切片审读时发现：它 stub 自家 MarkdownBody，但命名空间叫 "message-view-test"（不含 "stub"），守卫正则咬不住、第 0 步三轮扫描也没入账——命名规避盲区的实证。仅改装配（+5/−18 行），8 个测试断言逐字保留。

**「待确认」判定结论**：三个"新发现"文件均为「保留断言、转化装配」——断言是真行为，缺陷只在自家模块 stub。

**转化基建（新共享装配工具 src/renderer/components/renderer-real-graph.mjs）**：真实模块图的配规则固化一处，后续切片复用：

- 自家代码照常打包，路径别名走 tsconfig；
- npm 包一律 external、由 Node 真实导入（react-markdown / remark / react-syntax-highlighter 与生产同一份代码）；mermaid 与代码高亮语言库在真实实现里本就躲在动态导入之后，本切片无任何测试触发它们；
- 两处装配适配，均不替换任何实现：
  - react-syntax-highlighter 两个样式文件在源码里按打包器习惯写成无扩展名路径，Node 模块规则要求最终导入带扩展名——装配层把路径规范成真实存在的 .js 文件。曾试过在生产源码补 .js（更标准），但 @types 只为无扩展名写法提供声明，typecheck 破坏——故规范化属于测试装配层，不属于生产代码；
  - SessionProfiler 顶层读 import.meta.env.DEV——生产由 Vite 打包时注入，Node 下不存在（这也是全仓库仅有的两处 import.meta.env 用法之一，另一处带可选链守卫）。装配层用 esbuild define 做同一件事（声明"生产形态构建"），与 Vite 行为一致。

**突变验证（5 组，全部先红后恢复，生产代码零残留）：**

- 身份稳定性破坏（返回浅拷贝）→ identity 红（咬住 first !== second）；
- UserMessage 不再解析 /skill 前缀 → 3 红 1 绿（"行中 /skill 不出徽章"本来就断言缺席，正确保持绿）；
- ThinkingBlock aria-expanded 谎报 → process-flow 1 红；
- 用量行改为仅流式时显示 → assistant 2 红 2 绿（被破坏的两条精确变红）；
- 撤掉 MessageView 的 memo 包装 → message-view 1 红 7 绿。
- 过程记录：第 4 组首次突变引用了不在作用域的变量，红在构建期而非断言——不算合格证据，已换成可编译的行为反转突变重做。

**基准真值**：迁移前 4 个账本文件 12/12 + message-view 8/8 全绿；转化后同一批断言 12/12 + 8/8，测试数与断言一一对应。

**诚实声明：**

1. process-flow 与 assistant-message-usage 仍用 react-test-renderer（渲染 React 树而非真实 DOM）。本切片目标是撤自家模块 stub，未同时迁移渲染器；其断言对象是文本与状态（用户可见结果），但按宪法 dom/ 分区标准，真实 DOM 更彻底——留待后续切片决定。
2. 守卫的 stub 命名空间规则只匹配名字含 "stub" 的 namespace；process-flow/assistant-message 里的 i18n stub（命名 process-flow-test / assistant-message-i18n）与 message-view 的 "message-view-test" 均规避了机器检测，是本次人工审读发现的。命名规避是已确认的检测盲区——是否改为"测试文一律禁止本地命名空间替换模块"的更严规则，属政策决定，未单方面扩权。
3. message-view 的 memo 断言（$$typeof === react.memo 符号）保护的是真实性能行为（历史消息不重渲染），但检查的是实现手段（React.memo 本身）——按改名关判据属疑似 change-detector，待后续切片单独判定，本切片保持原样未动断言。
4. 真实模块图下 MarkdownBody 真渲染 markdown（此前渲染 null 的位置现在有真实内容），全部断言保持绿——断言并未依赖"渲染为空"这一 stub 副作用。
5. 本切片生产代码零改动（已 git 确认零残留）；未运行完整 npm run verify（重型 E2E 与打包耗时长，本切片无生产行为变更），验证以定向测试 + 突变 + typecheck（双 tsconfig）+ eslint + prettier + 全套件代替。

**验证证据（2026-10-13 实测）：**

- 定向：5 个转化文件 20/20 全绿（identity 1 + skill-badge 4 + process-flow 3 + assistant 4 + message-view 8）。
- 全套件：受限并发（--test-concurrency=3）下 1,346 个测试，1,345 通过、1 跳过（Windows 专属，第 0 步遗留待 Windows 补验）、0 失败。测试总数与切片四批持平（本切片只改装配，不增删测试）。
- 满并发首次跑套件时 plugin-worker 进程树测试超时——当时系统负载均值 102（正常约为核数；切片四批时 55–95 已判定过载偶发）——与切片四批诚实声明中记录的同一现象，非本切片回归。
- 守卫：阻断 0；存量豁免 17 命中 + 账本余 18 条（含 nav-sidebar 的 readdir 盲区"不再命中"条目，第 1 步已文档化，留人工确认，非本切片产）。
- typecheck（双 tsconfig）、eslint、prettier 对全部改动文件通过；check:architecture 退出码 0。

## 十三、第 2 步执行记录（切片六批：主进程信任边界与组合根域，2026-10-13）

**处置明细（账本 18 → 14）：**

本切片覆盖四个账本文件，跨 preload / main / agent-host 三层的信任边界与关闭路径。

| 文件                                         | 原判定      | 实际处置                                                   | 依据               |
| -------------------------------------------- | ----------- | ---------------------------------------------------------- | ------------------ |
| src/main/main-bootstrap.test.mjs             | 删除        | **判定修正后删除**：先补真实 E2E 覆盖，再删源码顺序断言    | 见下方「判定修正」 |
| src/main/ipc-trust.test.mjs                  | 保留1 流放1 | 保留信任策略行为测试；tripwire 迁入 check:desktop-security | 静态约束归静态检查 |
| src/preload/preload-location-policy.test.mjs | 保留1 流放1 | 同上                                                       | 同上               |
| src/agent-host/handlers-composition.test.mjs | 转化1 流放1 | 整删：注册数由既有 owner 接管；清理顺序转写为后果断言      | 见下               |

**判定修正（诚实记录）**：第 0 步给 main-bootstrap 的删除理由是「启动行为已由 smoke E2E 证明」。本切片执行前核验了 `scripts/smoke-electron.mjs` 与 `src/smoke/main.ts`：smoke 只证明**应用会启动并连通 Host**，完全没有覆盖单实例锁——「第二个实例快速退出、把控制权交还第一实例」这条真实引导规则当时**没有任何覆盖**。若照原判定直接删除，会净损失一条真规则。修正后的处置：

1. `src/smoke/main.ts` 补齐与生产 `main.ts` 同序的真实引导：启动时先取单实例锁、再注册生命周期监听，非首实例在任何监听器注册前以 0 码退出（`app.exit(0)`）；
2. `src/smoke/host-checks.ts` 新增 `verifySecondInstanceHandover`：首实例存活状态下拉起同一 bundle 的第二实例，断言（a）首实例收到 second-instance 交接事件、（b）第二实例 0 码退出且未被信号终止、（c）交接后首实例仍能继续服务（host.ping）；
3. 删除源码顺序断言（读 main.ts 文本断言 `acquireSingleInstanceLock` 在 `app.on` 之前的字节位置——改名关判据下的 change-detector）。
   **后续覆盖核验更正**：上述双实例检查确实使用真实 Electron，但执行的是专用 `src/smoke/main.ts`，只直接证明公共锁辅助函数及冒烟接线，不足以证明生产 `startMainProcess()` 的启动责任已接替。因此撤回“删除镜像不损失覆盖”的完整性判断。

   **后续代码修正（尚未运行）**：新增 `src/smoke/production-startup.ts`，在隔离 userData / sessionData 中直接加载已构建的 `out/main/main.js`；第二实例同样加载该生产入口，不使用测试退出捷径。观察生产页面收到 deep-link、第二实例零码退出、原窗口重新显示、真实 Host RPC 继续服务，以及生产退出流程允许 `will-quit` 后才写完成记录。只排除会修改用户系统默认关联的协议注册能力，不替换锁、退出、窗口、IPC 或应用模块。专用 Host 冒烟删除了复制的双实例启动逻辑。该修正已接入 `npm run smoke`，但旧验证日志不证明新增路径通过。

**handlers-composition 的接管关系**：

- 「每个契约方法恰好注册一次」：`check:contract`（check-contract-coverage.mjs）静态拥有全部 81 个 handler 的存在性/重复/缺失诊断（本次实测报告 `81 Api handlers … OK`）；`handlers.test.mjs` 的行为捕获测试（真实组合根注册出 81 个方法）继续从行为侧锁定聚合完整性——组合根漏调某个 registrar 时捕获数会小于 81。静态与行为双归属，独立测试删除无覆盖损失。
- 「五个清理按序执行」：源 stub 轨迹断言（globalThis 数组 + deepEqual 调用顺序）违反宪法第一、二条，改写为后果断言：`handlers.test.mjs` 新增行为测试——**真实 RPC 边界**（真实 `createRpcServer` + `MessageChannel` 端口对 + 真实 client）走 `system.allowRoot` → `files.watchStart`，确认 connected/change 事件真实送达，执行组合根 `cleanup()` 后再次改写文件，断言 700ms 窗口内**零事件**。观察的是「托管监视死了」这一用户可见后果，不是调用了谁、按什么顺序。
- 模型/进程/频道/会话四类清理 owner 的释放规则由各自服务层行为测试拥有（model-runtime、managed-process service、channel-manager、session teardown）；本切片的组合根真实资源测试覆盖文件监视，测试注释里写明这一归属边界。**后续核验更正**：服务层分别证明会释放资源，不自动证明组合根一定调用了每个 owner；已执行 E2E 也不能保证任意遗漏都被捕获。不要把这层覆盖界限夸大为所有清理接线的完整证明。

**测试环境时序特性（诚实记录）**：首次实现中「写入后监听事件」在打包器刚构建完的进程里偶发不触发（macOS fs.watch 对文件的注册有短暂潜伏期；纯进程 0ms 触发，测试进程内 100% 复现丢失）。纯 sleep 等待太脆：改为**有界重试**——活性证明最多 3 次改写尝试（每次内容不同、1.2s 窗口），静默断言保持单次严格（清理已释放监视，关闭的 watcher 无法再发事件）。重试只作用于清理**前**的活性验证；清理**后**的静默不重试——否则会把「没死」误判成「死了但没察到」，正好反转测试语义。

**验证证据（2026-10-13 实测）：**

- 新增行为测试 1/1 绿（组合根清理后文件监视静默）。
- trust-boundaries 六项静态不变量全部通过（check:desktop-security 总数增加 6 项）。
- 单实例 E2E：`npm run smoke` 全绿（含新增 second-instance 交接阶段，输出「second instance handed over and exited 0」）。
- 全套件与守卫结果见后续切片批次追加。

## 十四、接续清账与统一验证（剩余源码镜像、真实通信、公开行为）

本批在用户已完成的六批修改上继续，不回退其工作。实施前的工作区状态、暂存 / 未暂存补丁、未跟踪文件压缩包保存到 `.artifacts/test-rebuild-20261013-YNX771/`。总览、旧新代码与影响见 [测试重构讲解](test-rebuild-review.md)。

### 剩余登记项的去处

| 原文件                                           | 处置                             | 规则的新属主                                                                |
| ------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------- |
| `model-list-error-contract.test.mjs`             | 整删                             | `use-session-models.test.mjs` 的首次失败、缓存保留、跨会话迟到失败          |
| `settings-toggle-error-contract.test.mjs`        | 整删                             | `general-settings-behavior.test.mjs` + `tests/dom/software-update.test.mjs` |
| `oauth-detail-lifecycle.test.mjs`                | 整删                             | `tests/dom/oauth-login.test.mjs` 的取消、provider 切换和卸载                |
| `app-shell-copy-contract.test.mjs`               | 整删                             | `tests/dom/session-copy.test.mjs` 的失败与重试                              |
| `html-preview-error-contract.test.mjs`           | 整删                             | `tests/dom/html-preview.test.mjs` 的创建、释放和迟到 URL                    |
| `managed-process-ui-contract.test.mjs`           | 整删                             | `tests/dom/managed-processes.test.mjs` 的输出与安全操作                     |
| `browser/browser-renderer-contract.test.mjs`     | 整删                             | `tests/dom/browser-{authorization,settings,dock}.test.mjs`                  |
| `interactive-tools/tool-card-structure.test.mjs` | 整删                             | `tests/dom/tool-card-composition.test.mjs`；大小报告归 `check:architecture` |
| `app-nav/nav-sidebar.test.mjs`                   | 保留行为，删源码段，移除自家替换 | 实际导航行为；展示边界归 `check:architecture`                               |
| `branch-navigator-model.test.mjs`                | 保留行为，删源码段               | 公开模型 + `tests/dom/branch-navigation.test.mjs`                           |
| `directory-refresh.test.mjs`                     | 保留行为，删源码段               | 公开逻辑 + `tests/dom/file-explorer.test.mjs`                               |
| `router-compat.test.mjs`                         | 保留行为，删源码段               | 路由行为；所有权禁令归 `check:architecture`                                 |
| `session-performance.test.mjs`                   | 保留 registry，替换源码段        | 实际 marks / pending 释放 + `use-session-history.test.mjs`                  |
| `managed-process/tools-contract.test.mjs`        | 移除自家 service / SDK 替换      | 真实 SDK、service、公共工具执行与 schema                                    |

行数原本属于经验性指标，依照前三批已确定的政策只报告，严格模式可阻断；导航依赖方向、路由及焦点资源所有权属于阻断级。没有把行数零超标当成运行行为证明。

### 登记表之外的真实依赖迁移

统一真实 renderer 图用于导航、会话条目 / 分组 / 标题、项目工作区 / worktree / pickers / 启动恢复、设置、技能目录与详情 / 配置流程、插件支持层、进程详情、交互卡和 app-shell。`api-host.mjs` 在另一进程的协议边界提供 fixture 回答，不替换真实 `api-client`。

`session-hook-harness.mjs` 与 `chat-window-composition.harness.mjs` 删除自家客户端、翻译、策略替换；每实例拥有独立真实 RPC。ResourcePage 使用真实 PluginsConfig / SkillsConfig；AppShell 使用真实 ChatWindow 与路由。`pi-session-bridge.test.mjs` 使用真实 SDK、session 文件、wrapper / registry、localhost SSE 模型服务，以及另一个 Main 的通信 fixture。`file-access-cache.test.mjs` 使用真实 session 扫描，仅暂停外部 Git 命令，验证扫描中失效不会缓存旧目录。

Windows 设置补齐 Main ready / not-ready 两种界面状态，功能仍默认不勾选，并说明 not a sandbox。这是平台回复的界面测试，**不是 Windows 原生集成验证**。

### 人工复核补获：清掉“测试专用窗口”

此前第十二节仍保留的 `MessageView.$$typeof` 断言和 `getMarkdownComponentIdentityForTest` 已处置：新 `tests/dom/message-reading.test.mjs` 用实际选区证明新增内容不丢失已选中的代码、链接、表格与历史消息文字。删除 identity 文件，删除 memo 标记断言与生产测试专用映射出口。

ThinkingExpansionStore / Registry 去掉 keys / size 测试出口，改从公开快照、切换、订阅、淘汰 / 删除后的结果验证；attachment preview 无调用者的测试专用 cache 清理出口一并删除。ProcessFlow 和 assistant usage 七条测试改为真实 DOM。Worktree 的最后一条内部组件类型断言改为观察切换项目后移除操作不可见，相关 6 条通过后再跑完整验证。这里不再声称 memo 标记或 map 大小能证明性能耗时、用户选择或隐私数据不留存。

反例证据均保存并恢复：

- `message-reading-mutation-red.log`：每次重建 Markdown 组件类型，4 条选择保持测试因选区变空失败，历史消息用例仍通过。
- `message-reading-no-memo-green.log`：移除 memo 但保持用户行为，5 条全部通过。证明测试不强制这一实现手段，不证明耗时不变。
- `thinking-store-mutation-red.log`：禁用淘汰，公开行为的期望 true、实际 false，1 条失败；不是内部 map 形状断言。
- `public-boundaries-final-green.log`：相关公开边界 28/28 通过。

### 入口、守卫与全套首次运行的诊断

1. 默认入口纳入 `src/`、`scripts/`、`tests/`；三个位置的真实子测试写结果文件证明发现范围。默认并发 3，配置拒绝无效值。
2. 守卫用语法树并跟随相对 `.mjs` 支持图，拦截非 stub 命名的自家替换、测试专用 getter 与组件实现标记；代码示例字符串不被当成执行代码。相关新规则先 Red 后 Green。
3. 存量 allowlist 已清空。`hygiene-final.json` 四组均为空，但动态路径 / 插件、复杂转发和一般内部窥探仍是盲区；清账不是普遍合规证明。
4. lint 纳入新 `tests/`；完整运行纳入 scripts 后发现 launcher 测试误用 undefined 默认参数、ChatWindow 失败退出时异步收尾晚于环境恢复。前者显式提供“无继承 CLI 路径”，不改启动器；后者等待真实消费者收尾再还原环境。故障注入 worker 已由失败变为通过。
5. 浏览器真实 Dock 测试复现产品缺陷：先本地化错误导致 `TAB_NOT_FOUND` 编号丢失。恢复判断改用原始错误，显示仍本地化，见 `browser-process-dom{,-green}.log`。这是产品修复，不是只整理测试。

### 本批验证收尾

完整结果与平台边界在最终验证完成后追加。各选择集数量不能相加当作独立全套数量；第一次完整日志 `npm-test-complete.log` 保留其失败，不冒充最终全绿证据。

### 收尾人工核对发现的冒烟假绿（必须纠正的验证边界）

第一次统一验证退出码为 0，文件保留为 `verify-before-smoke-proof.log`，但日志没有出现第二实例交接完成、首实例继续服务及总检查完成。**因此不能拿该退出码宣称单实例 E2E 通过**。第十三节先前的“smoke 全绿”也不能替代本次重新核验。

可靠复现：Host 检查在第二实例阶段前销毁最后一个 BrowserWindow；Electron 无 `window-all-closed` 监听时默认退出，后面的异步检查被截断，而 launcher 将退出码 0 视为成功。

本次处置：

- 在隔离 userData 写入公开完成记录；只有完整检查成功的 `finish(0)` 可写 `{completed: true, pid}`。
- 启动器删除临时目录前验证记录、退出状态及本次子进程 pid。新 `src/smoke/result.ts` 是启动器结果协议，不是产品私有状态观察口。
- 第一实例由显式 finish 持有生命周期；交接验证移到窗口仍存在时，检查首窗口确实显示、第二实例退出及首实例 RPC 仍可用，再释放窗口。
- `scripts/smoke-result.test.mjs` 四条协议行为逐条 Red / Green。添加完成判据后，真实 `npm run smoke` 首先因未完成返回 1；修复窗口生命周期后，交接和总检查完成出现，launcher 确认完成记录后返回 0。
- 证据：`smoke-completion-{missing,invalid,owner}-red.log`、`smoke-completion-green.log`、`smoke-lifecycle-red.log`、`smoke-lifecycle-green.log`。

不得把“程序正常结束”“打印启动日志”或“代码里存在断言”当成现实验证真正执行完成。

### 最终完整验证结果（冒烟完成判据修复后重跑）

- **`npm run verify` 退出码 0**。证据：`.artifacts/test-rebuild-20261013-YNX771/verify-final.log` 与 `verify-final.exit`；最终日志含 `[verify] all checks passed`。
- Node **22.23.2**，本机 macOS。统一入口 **1,464 条，1,463 通过、0 失败、1 跳过**。唯一跳过是 Windows 真实共享锁更新用例；模拟 Windows capability 的界面测试不替代 Windows 原生补验。
- 格式、lint（含 tests）、main/Host 与 renderer 类型、依赖、架构（8 组、183 文件，无警告）、设计（13 组）、契约、Pi 0.84 兼容、工具链、i18n、安全、工作流、测试基础设施、构建、产物隔离全部通过。
- 托管进程开发流程及 **60 秒输出压力**通过。
- 真实 Electron 冒烟留下第二实例退出 / 交接、首窗口显示、首实例继续服务、完整检查及 launcher 完成记录验证。此轮不再仅依据退出码。
- 交互卡真实 Electron：**24 个布局、12 张截图**、动效降级和 SDK 窗口恢复通过。Browser Electron 和真实 Agent → Host → Main → Electron Browser 流程通过。Agent 使用本地受控模型回答，未调用付费线上模型，也不证明外部网站或线上推理能力。
- 失败恢复故障注入 54 个已登记场景通过；矩阵明确另有一类原本缺 fetch 的前提不成立，未计入覆盖。完整矩阵与输出另存 `fixture-restoration/`。
- 豁免名单为空，当前守卫命中为零；仍需人工判断动态生成、复杂转发、内部窥探、独立期望及一般重构稳健性。原位有效测试和公开 React / Hook 输出测试保留，未声称每条都是原生浏览器测试。
- `*.test.mjs` 规模的最终测量见 `test-size-final.json`，不含支持层。对比基准为 Git HEAD，而非接手时已改动的工作区；不以此前 25–30k 行估计或行数下降作为完成标准。

最后只追加说明文档；已完整验证的实现和测试代码不再改动，文档格式随后复核。没有自动提交，也没有回退用户已有修改。

## 十五、2026-10-15 合规追补

本轮不沿用“移出测试文件就自动合规”的结论。设置选项、字号、聊天宽度及卡片位置不再由 `check-design` 的 JSX 拼写、源码次数或 CSS 表格来代理；设置实际保存由 `general-settings-behavior` 覆盖，真实 `ChatWindow` 外观与输入由 `test:chat-layout-electron` 验收。

监听器/观察器/帧/定时器数量及选择第一个回调的相关用例已扩展改写为事件、时间与页面结果；日志保留规则按文本与复制结果验证，不固定 DOM 子层级。故障注入位置随可见结果同步，辅助层先登记清理再挂载。会话目录、聊天可见性和历史加载测试按责任分离支持代码，避免继续扩大单个测试文件。

生产启动的第十三节“尚未运行”是当时的历史状态。本轮已真实跑通生产入口、第二实例交接、首实例继续服务和正常退出；所有原生业务检查共用隔离环境与当前进程的完成证据。完整结果、后续统一入口的重新验证和文件摘要见 `.artifacts/test-compliance-20261015-093451/`；修复细节与边界见 `docs/test-rebuild-review.md` 第 13 节。Windows、打包和线上模型能力不在本轮通过范围内。
