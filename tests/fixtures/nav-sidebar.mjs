// Authored example data, shared by DOM interaction and native layout scenes.
export const navigationSessions = [
  { id: "sess-alpha", name: "alpha render bug", modified: "2026-09-06T10:00:00.000Z" },
  { id: "sess-child", name: "fork follow-up", parentSessionId: "sess-alpha", modified: "2026-09-06T10:30:00.000Z" },
  { id: "sess-beta", name: "beta unrelated", modified: "2026-08-20T10:00:00.000Z" },
].map((item) => ({
  path: `/sessions/${item.id}.json`,
  firstMessage: `First message of ${item.id}`,
  cwd: "/Users/tester/.dexon",
  created: "2026-08-01T08:00:00.000Z",
  messageCount: 3,
  ...item,
}));

export const longSpaceName = "一个非常非常长的空间名称会在这里显示省略号而不是撑破布局";
