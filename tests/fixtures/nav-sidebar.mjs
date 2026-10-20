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

export const sessionTreeRoots = {
  folded: "sess-release-train",
  expanded: "sess-release-notes",
  chain: "sess-refactor-login",
};

export const sessionTreeFoldedIds = [sessionTreeRoots.folded];

export const sessionTreeStatuses = {
  "sess-asking-scope": "awaiting_input",
  "sess-porting-adapters": "running",
  "sess-checking-fixtures": "running",
};

export const sessionTreeRunningIds = ["sess-porting-adapters", "sess-checking-fixtures"];

export function sessionTreeSessions(now = Date.now()) {
  const minutes = (value) => new Date(now - value * 60_000).toISOString();
  const rows = [
    { id: sessionTreeRoots.folded, name: "Release train", modified: minutes(6) },
    {
      id: "sess-asking-scope",
      name: "Asking about scope",
      parentSessionId: sessionTreeRoots.folded,
      modified: minutes(5),
    },
    {
      id: "sess-porting-adapters",
      name: "Porting adapters",
      parentSessionId: sessionTreeRoots.folded,
      modified: minutes(4),
    },
    {
      id: "sess-checking-fixtures",
      name: "Checking fixtures",
      parentSessionId: sessionTreeRoots.folded,
      modified: minutes(3),
    },
    { id: sessionTreeRoots.expanded, name: "Release notes", modified: minutes(9) },
    {
      id: "sess-forked-notes",
      name: "Forked release notes",
      parentSessionId: sessionTreeRoots.expanded,
      relation: "fork",
      modified: minutes(8),
    },
    {
      id: "sess-delegated-notes",
      name: "Delegated release notes",
      parentSessionId: sessionTreeRoots.expanded,
      relation: "delegate",
      createdBySessionId: sessionTreeRoots.expanded,
      modified: minutes(0),
    },
    { id: sessionTreeRoots.chain, name: "Refactor login", modified: minutes(0) },
    { id: "sess-migrate-api", name: "Migrate old API", parentSessionId: sessionTreeRoots.chain, modified: minutes(0) },
    { id: "sess-api-tests", name: "Add API tests", parentSessionId: "sess-migrate-api", modified: minutes(0) },
    { id: "sess-flaky-test", name: "Fix flaky test", parentSessionId: "sess-api-tests", modified: minutes(0) },
    { id: "sess-fixtures", name: "Rewrite fixtures", parentSessionId: "sess-flaky-test", modified: minutes(0) },
    { id: "sess-document", name: "Document migration", parentSessionId: "sess-fixtures", modified: minutes(0) },
  ];
  return rows.map((item) => ({
    path: `/sessions/${item.id}.json`,
    firstMessage: `First message of ${item.id}`,
    cwd: "/Users/tester/.dexon",
    created: minutes(10),
    messageCount: 3,
    ...item,
  }));
}
