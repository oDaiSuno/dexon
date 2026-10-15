/**
 * 测试卫生豁免名单（存量结构类测试的迁移账本）。
 *
 * 来源：docs/test-spec-inventory.md（第 0 步挖矿）判定为「结构类」的测试文件。
 * 已清账（第 2 步切片一批，2026-10-13）：session-sidebar-timer-contract、
 * skills-unsaved-changes-contract、skills-config-request-contract。
 * 已清账（切片二批 chat input，2026-10-13）：chat-window-visibility-contract、
 * queued-command-error-contract、image-file-processing（整删）；
 * latest-abortable-request、draft-persistence（正则测试移除，行为测试留存）。
 * 已清账（切片三批样式与设计牌域，2026-10-13）：App.theme、semantic-colors、
 * theme-tokens、font-stack、nav-motion、settings-chat-appearance、css-structure（整删，
 * 约束流放至 check-design / check-architecture）；theme-init（混居，正则测试移除，
 * colorScheme 同步转写为行为断言）。行为规则补齐：use-theme（新）、
 * general-settings-behavior（保存中禁用）。
 * 已清账（切片四批 i18n 与离线资产域，2026-10-13）：i18n-dictionaries-structure、
 * i18n-critical-ui（词典组合结构 → check:i18n，行数预算并入 check-architecture 卫生组）；
 * offline-assets（离线资产 → check:desktop-security 新模块 offline-assets）；
 * desktop-workflow（CI 工作流不变量 → 新脚本 check:desktop-workflow，接入 verify）；
 * smoke-electron-isolation（冒烟隔离守卫 → 新脚本 check:test-infra，接入 verify）。
 * 已清账（切片五批消息渲染域，2026-10-13）：markdown-body-component-identity、
 * user-message-skill-badge、process-flow、messages/assistant-message-usage、
 * message-view（盲区补获：stub 命名空间不含 "stub" 字样，规避了机器检测）。
 * 五个文件全部撤掉自家模块 stub，改用真实模块图：新共享装配工具
 * renderer-real-graph.mjs，五组突变验证，见 docs/test-spec-inventory.md 第十二节。
 * 已清账（切片六批主进程信任与组合根域，2026-10-13）：main-bootstrap（原判定
 * 「删除：已由 smoke 证明」不完整——smoke 当时只证明会启动，未覆盖单实例锁。
 * 本切片先在 smoke/main.ts 补齐真实引导同序（先取锁再注册监听），host-checks
 * 新增第二实例交接检查（第二实例 0 码退出 + 首实例收到交接 + 首实例仍在服务），
 * 再删除源码顺序断言测试——先补真实覆盖，再删镜像）；ipc-trust 与
 * preload-location-policy 各保留 1 条真行为测试，静态 tripwire 迁入
 * check:desktop-security 新模块 trust-boundaries；handlers-composition 整删
 * 81 注册数由 check:contract 静态拥有 + handlers.test 行为捕获，清理顺序改为
 * 后果断言（handlers.test 经真实 RPC 边界驱动真实文件监视，清理后事件静默）。
 * 守卫（scripts/test-hygiene.mjs）禁止测试文件把自家源码当文本读取后做断言、
 * 以及 stub 自家模块；名单内的文件是历史存量，豁免至其垂直切片迁移完成。
 *
 * 迁移协议：一个文件的正则断言全部处置完（删/转/流放），就把它从这里移除。
 * 名单清空只证明已登记项目清账；仍须扫描辅助文件、检查入口并跑完整验证。守卫会把「检测不再命中」的条目单独报告——
 * 那可能是真清账，也可能是检测盲区，必须人工确认后才可移除。
 */

// 剩余条目均已逐项转写或移入静态检查；清账依据见清单第十四节。
export const allowlist = [];
