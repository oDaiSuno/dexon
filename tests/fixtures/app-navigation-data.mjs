import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";

// Hand-authored examples, not values derived from navigation/resource policies.
export const navigationPaths = {
  home: "/Users/navigation-fixture",
  personal: "/Users/navigation-fixture/.dexon",
  project: "/work/navigation-project",
  worktree: "/work/navigation-project-review",
  bisect: "/work/navigation-project-bisect",
  staleCheckout: "/work/navigation-project-worktrees/gamma",
  alphaWorktree: "/work/navigation-project-worktrees/feat-alpha",
  createdWorktree: "/work/navigation-project-worktrees/release",
  subfolder: "/work/navigation-project/packages/app",
  other: "/work/paper-notes",
  otherWorktree: "/work/paper-notes-worktrees/exp-retrieval",
  removed: "/work/removed-project",
  terminalOnly: "/work/terminal-only-project",
  empty: "/work/empty-project",
};

const branch = (name, committedAt, extra = {}) => ({ name, committedAt, ...extra });

// Branch tables the fixture Host answers with. Declaration order, alphabetical
// order and commit order are deliberately all different, so a test that only
// passes for one of them cannot pass by accident.
export const navigationRepositories = [
  {
    root: navigationPaths.project,
    mainFolder: navigationPaths.project,
    branches: [
      branch("feat/beta", "2026-09-02T09:00:00.000Z"),
      branch("chore/gamma", "2026-09-05T12:00:00.000Z", { stalePath: navigationPaths.staleCheckout }),
      branch("wip/idea", "2026-09-01T09:00:00.000Z"),
      branch("main", "2026-09-06T09:00:00.000Z", { worktreePath: navigationPaths.project }),
      branch("review", "2026-09-05T09:00:00.000Z", { worktreePath: navigationPaths.worktree }),
      branch("audit/cleanup", "2026-09-03T09:00:00.000Z"),
      branch("feat/alpha", "2026-09-04T09:00:00.000Z"),
    ],
    detached: [{ path: navigationPaths.bisect, commit: "a3f9c21" }],
    files: {
      main: ["main-plan.md", "shared-notes.md"],
      "feat/alpha": ["alpha-report.md", "shared-notes.md"],
    },
  },
  {
    root: navigationPaths.other,
    mainFolder: navigationPaths.other,
    branches: [
      branch("data/2026-q3", "2026-08-31T09:00:00.000Z"),
      branch("main", "2026-09-06T09:00:00.000Z", { worktreePath: navigationPaths.other }),
      branch("exp/retrieval", "2026-09-04T09:00:00.000Z"),
    ],
    detached: [],
    files: {},
  },
];
export const removedSpaceReason = "Fixture folder was removed from this computer";
export const personalPrepareReason = "Fixture could not create the personal folder";
export const createdWorktreeBranch = "release";

export const navigationLabels = {
  "en-US": {
    navigation: "Main navigation",
    resources: "Plugins & Skills",
    manageSources: "Manage sources",
    skills: "Skills",
    settings: "Settings",
    filePanel: "Show file panel",
    personal: "Default space",
    history: "Project spaces",
    moveUp: "Move up",
    moveDown: "Move down",
    closeProject: "Close project",
    missingFolder: "Folder not found",
    missingFolderNote: "This folder was moved or deleted. Its sessions are kept.",
    spaceActions: "Actions for {name}",
    switcher: "Switch or add project",
    newSession: "New session",
    attach: "Add images or local file references",
    skillAction: /^Use a skill/,
    skillPicker: "Use a skill",
    skillContent: "Skill markdown content",
    chat: "Chat",
    triggerPrefix: "Workspace:",
    triggerLabel: "Workspace: {project}",
    triggerLabelWithBranch: "Workspace: {project}, branch {branch}",
    workspace: "Workspace",
    projects: "Projects",
    defaultSpaceNote: "Not in any repository",
    notGitRepo: "Not a git repository",
    showBranches: "Show branches of {project}",
    showBranchesPrefix: "Show branches of ",
    branchesOf: "{project} branches",
    branchFilter: "Filter branches…",
    sectionCurrent: "Current",
    sectionInFolders: "In their own folders",
    sectionOtherLocal: "Other local branches",
    sortByRecentCommit: "By recent commit",
    mainFolder: "Main folder",
    detachedNote: "Not on any branch",
    staleNote: "Still registered to missing folder",
    newWorktree: "New worktree…",
    removeWorktreePrefix: "Remove worktree",
    blockedDirty: "This folder has uncommitted changes",
    blockedDirtyOther: "{project}'s main folder has uncommitted changes",
    blockedDirtyDetail: "Switching now would carry these changes to the other branch.",
    blockedBusy: "A session or process is running in this folder",
    blockedBusyOther: "A session or process is running in {project}'s main folder",
    blockedBusyDetail: "Switching now would change the files it is reading.",
    openInNewWorktree: "Open in new worktree",
    cancel: "Cancel",
    notGitTitle: "{project} is not a git repository",
    notGitBody: "There are no branches here. Press Enter or click the row on the left to switch to this folder.",
    switchTo: "Switch to {project}",
    copyPath: "Copy path",
    openInFinder: "Open in Finder",
    readOnlyNote: "This session was created here. To work elsewhere, start a new session.",
  },
  "zh-CN": {
    navigation: "主导航",
    resources: "插件与技能",
    manageSources: "管理来源",
    skills: "技能",
    settings: "设置",
    filePanel: "显示文件面板",
    personal: "默认空间",
    history: "项目空间",
    moveUp: "上移",
    moveDown: "下移",
    closeProject: "关闭项目",
    missingFolder: "找不到文件夹",
    missingFolderNote: "文件夹已被移动或删除，会话记录仍然保留。",
    spaceActions: "{name} 的项目操作",
    switcher: "切换或新增项目",
    newSession: "新建会话",
    attach: "添加图片或本地文件引用",
    skillAction: /^使用技能/,
    skillPicker: "使用技能",
    skillContent: "技能 Markdown 内容",
    chat: "聊天",
    triggerPrefix: "工作区：",
    triggerLabel: "工作区：{project}",
    triggerLabelWithBranch: "工作区：{project}，分支 {branch}",
    workspace: "工作区",
    projects: "项目",
    defaultSpaceNote: "不属于任何仓库",
    notGitRepo: "不是 git 仓库",
    showBranches: "查看 {project} 的分支",
    showBranchesPrefix: "查看 ",
    branchesOf: "{project} 的分支",
    branchFilter: "筛选分支…",
    sectionCurrent: "当前",
    sectionInFolders: "在各自文件夹中",
    sectionOtherLocal: "其他本地分支",
    sortByRecentCommit: "按最近提交",
    mainFolder: "主文件夹",
    detachedNote: "未在任何分支上",
    staleNote: "仍登记在已不存在的文件夹",
    newWorktree: "新建 worktree…",
    removeWorktreePrefix: "移除 worktree",
    blockedDirty: "当前文件夹有未提交的改动",
    blockedDirtyOther: "{project} 的主文件夹有未提交的改动",
    blockedDirtyDetail: "现在切分支，这些改动会被带到另一个分支。",
    blockedBusy: "有会话或进程正在这个文件夹里运行",
    blockedBusyOther: "{project} 的主文件夹里有会话或进程正在运行",
    blockedBusyDetail: "现在切分支，它读到的文件会突然变掉。",
    openInNewWorktree: "在新 worktree 中打开",
    cancel: "取消",
    notGitTitle: "{project} 不是 git 仓库",
    notGitBody: "这里没有分支可选。按回车或点左侧这一行，直接切换到这个文件夹。",
    switchTo: "切换到 {project}",
    copyPath: "复制路径",
    openInFinder: "在访达中打开",
    readOnlyNote: "会话创建时就定在这里。想换位置，请新建会话。",
  },
};
export const reloadedPluginStatus = "Navigation plugin ready after explicit reload";
export const remainingSettings = ["General", "Browser", "Models", "Developer Tools", "About"];
export const remainingSettingsZhCN = ["通用", "浏览器", "模型", "开发工具", "关于"];
export const railEntries = ["Show sidebar", "New session", "Plugins & Skills", "Settings"];
export const initialSkillContent = "# Personal checklist\n\nKeep the review scoped to the current space.\n";
export const savedSkillContent = "# Personal checklist\n\nVerify the navigation before shipping.\n";

function conversation(id, name, cwd, message, projectRoot = cwd, parentSessionId) {
  const detail = createSessionDetail(id, { name, cwd, messages: [{ role: "user", content: message, timestamp: 1 }] });
  Object.assign(detail.info, {
    projectRoot,
    ...(parentSessionId ? { parentSessionId } : {}),
    created: "2026-08-01T08:00:00.000Z",
    modified: "2026-09-06T10:00:00.000Z",
    firstMessage: message,
    messageCount: 1,
  });
  detail.context.entryIds = [`${id}-user`];
  detail.context.totalMessages = 1;
  detail.context.loadedMessages = 1;
  return detail;
}

export function navigationConversations() {
  return [
    conversation(
      "personal-history",
      "Personal release notes",
      navigationPaths.personal,
      "Personal conversation marker",
    ),
    conversation(
      "personal-other",
      "Another personal conversation",
      navigationPaths.personal,
      "Other conversation marker",
    ),
    conversation("project-history", "Project release notes", navigationPaths.project, "Project conversation marker"),
    conversation(
      "review-history",
      "Review branch notes",
      navigationPaths.worktree,
      "Review conversation marker",
      navigationPaths.project,
    ),
    conversation(
      "terminal-only-history",
      "Terminal only notes",
      navigationPaths.terminalOnly,
      "Terminal only conversation marker",
    ),
    conversation(
      "removed-history",
      "Removed project notes",
      navigationPaths.removed,
      "Removed project conversation marker",
    ),
  ];
}

export function notesConversation() {
  return conversation("notes-history", "Notes release plan", navigationPaths.other, "Notes conversation marker");
}

export function forkedConversation() {
  return conversation(
    "personal-fork",
    "Forked personal conversation",
    navigationPaths.personal,
    "Forked conversation marker",
    navigationPaths.personal,
    "personal-other",
  );
}

// One finished turn with a tool call, so the transcript shows a collapsible
// "Process details" group in front of the final answer.
export function toolConversation() {
  const detail = conversation(
    "personal-tools",
    "Personal tool conversation",
    navigationPaths.personal,
    "Tool conversation marker",
  );
  detail.context.messages.push(
    {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "tool-read-1", toolName: "read", input: { path: "notes.md" } }],
      provider: "navigation-fixture",
      model: "navigation-model",
      stopReason: "toolUse",
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "tool-read-1",
      toolName: "read",
      content: [{ type: "text", text: "Tool result marker" }],
      isError: false,
      timestamp: 3,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Tool answer marker" }],
      provider: "navigation-fixture",
      model: "navigation-model",
      stopReason: "stop",
      timestamp: 4,
    },
  );
  detail.context.entryIds.push("personal-tools-call", "personal-tools-result", "personal-tools-answer");
  detail.context.totalMessages = 4;
  detail.context.loadedMessages = 4;
  detail.info.messageCount = 4;
  return detail;
}

export function startedConversation(id, cwd, message) {
  const detail = conversation(id, undefined, cwd, message);
  detail.leafId = `${id}-user`;
  detail.info.path = "";
  return detail;
}

export function laterConversation() {
  return conversation(
    "personal-later",
    "Later personal conversation",
    navigationPaths.personal,
    "Later conversation marker",
  );
}

function plugin(source, scope = "project") {
  return {
    source,
    scope,
    status: "loaded",
    disabled: false,
    filtered: false,
    counts: { extensions: 0, skills: 1, prompts: 0, themes: 0 },
    resources: [],
  };
}

function skill(name, baseDir, scope = "project") {
  return {
    name,
    description: `${name} fixture description`,
    baseDir,
    filePath: `${baseDir}/SKILL.md`,
    disableModelInvocation: false,
    sourceInfo: { source: scope, scope },
  };
}

export function navigationResources() {
  const sharedPlugin = plugin("npm:shared-navigation-plugin", "global");
  const sharedSkill = skill(
    "shared-checklist",
    "/Users/navigation-fixture/.pi/agent/skills/shared-checklist",
    "global",
  );
  return new Map([
    [
      navigationPaths.personal,
      {
        packages: [plugin("npm:personal-navigation-plugin"), sharedPlugin],
        skills: [
          skill("personal-checklist", "/Users/navigation-fixture/.dexon/.pi/skills/personal-checklist"),
          sharedSkill,
        ],
      },
    ],
    [
      navigationPaths.project,
      {
        packages: [plugin("npm:project-navigation-plugin"), sharedPlugin],
        skills: [skill("project-checklist", "/work/navigation-project/.pi/skills/project-checklist"), sharedSkill],
      },
    ],
    [
      navigationPaths.worktree,
      {
        packages: [plugin("npm:review-navigation-plugin"), sharedPlugin],
        skills: [skill("review-checklist", "/work/navigation-project-review/.pi/skills/review-checklist"), sharedSkill],
      },
    ],
    [
      navigationPaths.bisect,
      {
        packages: [plugin("npm:bisect-navigation-plugin"), sharedPlugin],
        skills: [sharedSkill],
      },
    ],
    [
      navigationPaths.other,
      {
        packages: [plugin("npm:notes-navigation-plugin"), sharedPlugin],
        skills: [skill("notes-checklist", "/work/paper-notes/.pi/skills/notes-checklist"), sharedSkill],
      },
    ],
    [navigationPaths.otherWorktree, { packages: [sharedPlugin], skills: [sharedSkill] }],
    [navigationPaths.alphaWorktree, { packages: [sharedPlugin], skills: [sharedSkill] }],
    [navigationPaths.createdWorktree, { packages: [sharedPlugin], skills: [sharedSkill] }],
    [navigationPaths.subfolder, { packages: [sharedPlugin], skills: [sharedSkill] }],
    [navigationPaths.terminalOnly, { packages: [sharedPlugin], skills: [sharedSkill] }],
    [navigationPaths.empty, { packages: [sharedPlugin], skills: [sharedSkill] }],
  ]);
}
