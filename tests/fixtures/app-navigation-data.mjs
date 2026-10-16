import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";

// Hand-authored examples, not values derived from navigation/resource policies.
export const navigationPaths = {
  home: "/Users/navigation-fixture",
  personal: "/Users/navigation-fixture/.dexon",
  project: "/work/navigation-project",
  worktree: "/work/navigation-project-review",
  createdWorktree: "/work/navigation-project-release",
  removed: "/work/removed-project",
};
export const removedSpaceReason = "Fixture folder was removed from this computer";
export const personalPrepareReason = "Fixture could not create the personal folder";
export const createdWorktreeBranch = "release";

export const navigationLabels = {
  "en-US": {
    navigation: "Main navigation",
    resources: "Plugins & Skills",
    skills: "Skills",
    settings: "Settings",
    filePanel: "Show file panel",
    personal: "Personal space",
    openFolder: "Open current folder",
    history: "History",
    attach: "Add images or local file references",
    skillAction: /^Use a skill/,
    skillPicker: "Use a skill",
    skillContent: "Skill markdown content",
  },
  "zh-CN": {
    navigation: "主导航",
    resources: "插件与技能",
    skills: "技能",
    settings: "设置",
    filePanel: "显示文件面板",
    personal: "个人空间",
    openFolder: "打开当前文件夹",
    history: "历史",
    attach: "添加图片或本地文件引用",
    skillAction: /^使用 Skill/,
    skillPicker: "使用技能",
    skillContent: "技能 Markdown 内容",
  },
};
export const reloadedPluginStatus = "Navigation plugin ready after explicit reload";
export const remainingSettings = ["General", "Browser", "Channels", "Models", "Developer Tools", "About"];
export const railEntries = ["Show sidebar", "new session", "Plugins & Skills", "Settings"];
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
  ];
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
    [navigationPaths.createdWorktree, { packages: [sharedPlugin], skills: [sharedSkill] }],
  ]);
}
