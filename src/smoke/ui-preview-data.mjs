/**
 * Phase 4 preview sample data. Pure in-memory fixtures for the dev-only
 * preview assembly: nothing here touches real sessions, directories or
 * configuration, and the module performs no IO.
 *
 * The preview harness renders the real navigation, the real resource page
 * (driven by the api mock) and a real chat canvas with these fixtures.
 */

function iso(now, offsetHours) {
  return new Date(now.getTime() - offsetHours * 3_600_000).toISOString();
}

// "Today" sample sessions must stay inside the local calendar day even when
// the reference time is shortly after midnight (review R5), so their modified
// timestamps clamp to the day start instead of crossing into yesterday.
function todayModified(now, offsetHours) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const candidate = new Date(now.getTime() - offsetHours * 3_600_000);
  return (candidate < dayStart ? dayStart : candidate).toISOString();
}

const SAMPLE_CWD = "/Users/demo/.dexon";

function session(id, { now, offsetHours, name, firstMessage, parentId, cwd, branch }) {
  return {
    path: `/sessions/${id}.json`,
    id,
    name: name ?? "",
    firstMessage,
    cwd: cwd ?? SAMPLE_CWD,
    created: iso(now, offsetHours + 4),
    modified: offsetHours <= 6 ? todayModified(now, offsetHours) : iso(now, offsetHours),
    messageCount: 6 + (id.length % 7),
    parentSessionId: parentId,
    projectRoot: cwd ?? SAMPLE_CWD,
    worktreeBranch: branch,
  };
}

/**
 * Builds the complete sample scene for one capture run.
 * @param {{ now: Date }} options fixed reference time so groups are deterministic
 */
export function buildPreviewData({ now }) {
  const space = { name: "个人空间", path: "~/.dexon" };
  const cwd = SAMPLE_CWD;

  const sessions = [
    session("pv-today-refactor", {
      now,
      offsetHours: 1,
      name: "重构侧栏状态管理，抽离运行订阅",
      firstMessage: "把侧栏的状态管理拆开，运行流优先于迟到的列表刷新…",
    }),
    session("pv-today-bugs", {
      now,
      offsetHours: 2,
      name: "Fix sidebar unread flicker on stream reconnect",
      firstMessage: "Unread marks flicker when the stream reconnects mid-refresh.",
    }),
    session("pv-today-fork", {
      now,
      offsetHours: 3,
      name: "子任务：抽离 GlideHighlight 复用",
      firstMessage: "从父任务派生：把滑行高亮抽成共享组件。",
      parentId: "pv-today-refactor",
    }),
    session("pv-today-grandchild", {
      now,
      offsetHours: 4,
      name: "孙任务：补滑行高亮回归测试",
      firstMessage: "为抽出的 GlideHighlight 补回归测试。",
      parentId: "pv-today-fork",
    }),
    session("pv-today-fork-2", {
      now,
      offsetHours: 5,
      name: "派生：导航行悬停反馈统一",
      firstMessage: "统一导航行的悬停反馈，先抽组件再改样式。",
      parentId: "pv-today-refactor",
    }),
    session("pv-today-docs", {
      now,
      offsetHours: 6,
      name: "Update the preview harness docs",
      firstMessage: "Document the capture flow and evidence locations.",
    }),
    session("pv-recent-i18n", {
      now,
      offsetHours: 30,
      name: "字典按职责拆分，保持键与回退语义",
      firstMessage: "把双语字典按领域拆成小文件，保持键与回退语义不变。",
    }),
    session("pv-recent-styles", {
      now,
      offsetHours: 40,
      name: "Split globals.css into responsibility shards",
      firstMessage: "Split the app stylesheet by responsibility without changing values.",
    }),
    session("pv-recent-worktree", {
      now,
      offsetHours: 50,
      name: "工作副本切换后旧会话归属校验",
      firstMessage: "Check that switching worktrees keeps old sessions in their project.",
    }),
    session("pv-recent-plugins", {
      now,
      offsetHours: 60,
      name: "Plugin library grouping polish",
      firstMessage: "Group plugins by scope with stable row order.",
    }),
    session("pv-older-migration", {
      now,
      offsetHours: 24 * 12,
      name: "早期迁移：会话目录数据管家拆分",
      firstMessage: "Move the session directory data owner out of the monolith.",
    }),
    session("pv-older-search", {
      now,
      offsetHours: 24 * 15,
      name: "Search across five session fields",
      firstMessage: "Search sessions by name, first message, id, cwd and branch.",
    }),
    session("pv-older-motion", {
      now,
      offsetHours: 24 * 21,
      name: "动效令牌对齐：时长与缓动统一",
      firstMessage: "Align motion tokens: one duration scale and one easing curve.",
    }),
    session("pv-older-long", {
      now,
      offsetHours: 24 * 30,
      name: "这是一个非常非常长的中文会话标题用来验证省略号在窄侧栏里的表现是否稳定可靠不换行",
      firstMessage: "Long Chinese title fixture for the ellipsis check.",
    }),
    session("pv-older-long-en", {
      now,
      offsetHours: 24 * 34,
      name: "An extremely long English session title that also has to ellipsize gracefully inside the narrow 224 pixel navigation column",
      firstMessage: "Long English title fixture for the ellipsis check.",
    }),
  ];
  const runningSessionIds = ["pv-today-refactor", "pv-recent-plugins"];
  const unreadSessionIds = ["pv-today-bugs", "pv-recent-worktree"];

  const skills = [
    {
      name: "release-notes",
      description: "汇总一次发布范围内的提交并生成双语发布说明。",
      filePath: `${cwd}/.pi/agent/skills/release-notes/SKILL.md`,
      baseDir: `${cwd}/.pi/agent/skills/release-notes`,
      disableModelInvocation: false,
      sourceInfo: { source: "project", scope: "project" },
    },
    {
      name: "commit-cn",
      description: "Draft concise Chinese commit messages following the house style.",
      filePath: `${cwd}/.pi/agent/skills/commit-cn/SKILL.md`,
      baseDir: `${cwd}/.pi/agent/skills/commit-cn`,
      disableModelInvocation: false,
      sourceInfo: { source: "project", scope: "project" },
    },
    {
      name: "readme-polish",
      description: "Rewrite README files so the first screen answers the three key questions.",
      filePath: "/Users/demo/.pi/agent/skills/readme-polish/SKILL.md",
      baseDir: "/Users/demo/.pi/agent/skills/readme-polish",
      disableModelInvocation: false,
      sourceInfo: { source: "user", scope: "user" },
    },
    {
      name: "triage",
      description: "将问题清单按影响面与修复成本分桶并给出建议顺序。",
      filePath: "/Users/demo/.pi/agent/skills/triage/SKILL.md",
      baseDir: "/Users/demo/.pi/agent/skills/triage",
      disableModelInvocation: true,
      sourceInfo: { source: "user", scope: "user" },
    },
    {
      name: "legacy-notes",
      description: "Kept for reference only — hidden from the model prompt.",
      filePath: "/opt/shared-skills/legacy-notes/SKILL.md",
      baseDir: "/opt/shared-skills/legacy-notes",
      disableModelInvocation: true,
      sourceInfo: { source: "path", scope: "path" },
    },
  ];
  const skillContents = new Map([
    [
      skills[0].filePath,
      [
        "# release-notes",
        "",
        "把一次发布范围内的提交按主题分组，生成中英双语发布说明。",
        "先读提交列表，再按「功能 / 修复 / 维护」归类，最后统一语气。",
      ].join("\n"),
    ],
    [
      skills[1].filePath,
      [
        "# commit-cn",
        "",
        "Use one concise Chinese sentence, no more than 150 characters,",
        "and never imply the work was done by AI.",
      ].join("\n"),
    ],
    [
      skills[2].filePath,
      ["# readme-polish", "", "Lead with the problem the project solves, then the quickstart."].join("\n"),
    ],
    [skills[3].filePath, ["# triage", "", "先按影响面分级，再按修复成本排序，输出建议顺序。"].join("\n")],
    [skills[4].filePath, ["# legacy-notes", "", "Historical context only."].join("\n")],
  ]);

  const plugins = [
    {
      source: "dexon-focus-mode",
      packageName: "dexon-focus-mode",
      scope: "project",
      filtered: false,
      disabled: false,
      installedPath: `${cwd}/.pi/agent/plugins/dexon-focus-mode`,
      version: "0.3.1",
      configuredVersion: "^0.3.1",
      counts: { extensions: 1, skills: 2, prompts: 0, themes: 0 },
      resources: [
        {
          kind: "extension",
          name: "focus-mode",
          path: `${cwd}/.pi/agent/plugins/dexon-focus-mode/ext.ts`,
          relativePath: "ext.ts",
        },
        {
          kind: "skill",
          name: "focus-brief",
          path: `${cwd}/.pi/agent/plugins/dexon-focus-mode/skills/brief/SKILL.md`,
          relativePath: "skills/brief/SKILL.md",
        },
      ],
      status: "loaded",
    },
    {
      source: "dexon-git-suite",
      packageName: "dexon-git-suite",
      scope: "project",
      filtered: false,
      disabled: false,
      installedPath: `${cwd}/.pi/agent/plugins/dexon-git-suite`,
      version: "1.2.0",
      counts: { extensions: 2, skills: 0, prompts: 1, themes: 0 },
      resources: [
        {
          kind: "extension",
          name: "git-status",
          path: `${cwd}/.pi/agent/plugins/dexon-git-suite/status.ts`,
          relativePath: "status.ts",
        },
        {
          kind: "extension",
          name: "git-blame",
          path: `${cwd}/.pi/agent/plugins/dexon-git-suite/blame.ts`,
          relativePath: "blame.ts",
        },
        {
          kind: "prompt",
          name: "review",
          path: `${cwd}/.pi/agent/plugins/dexon-git-suite/review.md`,
          relativePath: "review.md",
        },
      ],
      status: "loaded",
    },
    {
      source: "pi-mermaid-render",
      packageName: "pi-mermaid-render",
      scope: "global",
      filtered: false,
      disabled: false,
      installedPath: "/Users/demo/.pi/agent/plugins/pi-mermaid-render",
      version: "0.9.4",
      configuredVersion: "^0.9.4",
      counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
      resources: [
        {
          kind: "extension",
          name: "mermaid",
          path: "/Users/demo/.pi/agent/plugins/pi-mermaid-render/ext.ts",
          relativePath: "ext.ts",
        },
      ],
      status: "loaded",
    },
    {
      source: "pi-word-export",
      packageName: "pi-word-export",
      scope: "global",
      filtered: false,
      disabled: true,
      installedPath: "/Users/demo/.pi/agent/plugins/pi-word-export",
      version: "0.2.7",
      counts: { extensions: 0, skills: 1, prompts: 0, themes: 0 },
      resources: [
        {
          kind: "skill",
          name: "docx-export",
          path: "/Users/demo/.pi/agent/plugins/pi-word-export/skills/docx/SKILL.md",
          relativePath: "skills/docx/SKILL.md",
        },
      ],
      status: "disabled",
    },
  ];

  const chatMessages = [
    {
      role: "user",
      content:
        "帮我把侧栏的运行状态提示和未读提示分开：现在运行中的会话会盖掉未读标记，两个状态同时存在时只显示其中一个。" +
        "请先读一下 session-item.tsx 里状态槽位的实现，再给出改动方案，注意不要破坏未读的持久化逻辑。",
      timestamp: now.getTime() - 3_600_000,
    },
    {
      role: "assistant",
      model: "gpt-6-astra",
      provider: "guda-responses",
      content: [
        {
          type: "text",
          text:
            "看完了。状态槽是一个固定 18px 的槽位，运行指示器和未读圆点目前共用一个三元判断，所以同时存在时只渲染运行状态。" +
            "建议拆成两层：运行指示器保持原位，未读改成独立的小圆点叠在行末（复用 UnreadSessionIndicator 的颜色令牌）。\n\n" +
            "```tsx\nconst showRunning = isRunning;\nconst showUnread = isUnread && !isRunning;\n```\n\n" +
            "这样未读的持久化语义不变：后台结束仍未读，重新显示对应会话后才清除。改动只涉及状态槽与一个样式判断，不影响流优先逻辑。",
        },
      ],
      timestamp: now.getTime() - 3_000_000,
    },
    {
      role: "user",
      content:
        "Sounds good. One more constraint: the unread dot should also survive a sidebar collapse — when I collapse to the icon rail and the task finishes in the background, expanding the sidebar later must still show it as unread until I actually open that session.",
      timestamp: now.getTime() - 2_400_000,
    },
    {
      role: "assistant",
      model: "gpt-6-astra",
      provider: "guda-responses",
      content: [
        {
          type: "text",
          text: "That already holds with the split above: the unread set lives in the session directory owner (not the row), so collapsing the sidebar — which only unmounts the history presentation — never touches it. The row re-reads `unreadSessionIds` on remount and clears it only through the visible-session path, which lands in Phase 9.",
        },
      ],
      timestamp: now.getTime() - 2_100_000,
    },
  ];

  return {
    space,
    cwd,
    sessions,
    runningSessionIds,
    unreadSessionIds,
    skills,
    skillContents,
    plugins,
    chatMessages,
  };
}
