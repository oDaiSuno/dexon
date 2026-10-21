import type { SessionEntry } from "../shared/types";

export interface MessageVersions {
  entryIds: string[];
  index: number;
}

interface Indexed {
  byId: Map<string, SessionEntry>;
  position: Map<string, number>;
  children: Map<string, SessionEntry[]>;
}

function indexEntries(entries: SessionEntry[]): Indexed {
  const byId = new Map<string, SessionEntry>();
  const position = new Map<string, number>();
  const children = new Map<string, SessionEntry[]>();
  entries.forEach((entry, position_) => {
    byId.set(entry.id, entry);
    position.set(entry.id, position_);
  });
  for (const entry of entries) {
    const parentId = entry.parentId;
    if (!parentId) continue;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(entry);
    else children.set(parentId, [entry]);
  }
  return { byId, position, children };
}

function isConversationRecord(entry: SessionEntry): boolean {
  if (entry.type === "message") return true;
  if (entry.type === "custom_message") return entry.display !== false;
  return entry.type === "compaction" || entry.type === "branch_summary";
}

export function isUserMessageEntry(entry: SessionEntry | undefined): boolean {
  return entry?.type === "message" && entry.message.role === "user";
}

function timestampOf(entry: SessionEntry): number {
  const parsed = Date.parse(entry.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function newerThan(left: SessionEntry, right: SessionEntry, position: Map<string, number>): boolean {
  const leftTime = timestampOf(left);
  const rightTime = timestampOf(right);
  if (leftTime !== rightTime) return leftTime > rightTime;
  return (position.get(left.id) ?? 0) > (position.get(right.id) ?? 0);
}

export function versionAnchorOf(entry: SessionEntry, byId: Map<string, SessionEntry>): string | null {
  let current = entry.parentId ? byId.get(entry.parentId) : undefined;
  while (current && !isConversationRecord(current)) {
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return current ? current.id : null;
}

function orderedOldestFirst(group: SessionEntry[], position: Map<string, number>): SessionEntry[] {
  return [...group].sort((left, right) => {
    const leftTime = timestampOf(left);
    const rightTime = timestampOf(right);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0);
  });
}

export function versionsByEntryId(entries: SessionEntry[]): Map<string, MessageVersions> {
  const { byId, position } = indexEntries(entries);
  const groups = new Map<string, SessionEntry[]>();
  for (const entry of entries) {
    if (!isUserMessageEntry(entry)) continue;
    const anchor = versionAnchorOf(entry, byId);
    const key = anchor ?? "\u0000first";
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const versions = new Map<string, MessageVersions>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = orderedOldestFirst(group, position);
    const entryIds = ordered.map((entry) => entry.id);
    ordered.forEach((entry, index) => {
      versions.set(entry.id, { entryIds: [...entryIds], index });
    });
  }
  return versions;
}

export function versionEntryIdsOf(entries: SessionEntry[], entryId: string): string[] {
  return versionsByEntryId(entries).get(entryId)?.entryIds ?? [entryId];
}

export function newestTipUnder(entries: SessionEntry[], entryId: string): string {
  const { byId, children, position } = indexEntries(entries);
  const start = byId.get(entryId);
  if (!start) return entryId;
  const roots = children.get(start.id) ?? [];
  if (roots.length === 0) return start.id;
  let newest = roots[0];
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const candidates = children.get(current.id) ?? [];
    if (candidates.length > 0) {
      stack.push(...candidates);
      continue;
    }
    if (newerThan(current, newest, position)) newest = current;
  }
  return newest.id;
}

function changesFiles(entry: SessionEntry): boolean {
  if (entry.type !== "message" || entry.message.role !== "assistant") return false;
  const content = entry.message.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (block?.type !== "toolCall") return false;
    const call = block as unknown as { name?: unknown; toolName?: unknown };
    return call.name === "edit" || call.name === "write" || call.toolName === "edit" || call.toolName === "write";
  });
}

export function subtreeChangesFiles(entries: SessionEntry[], entryId: string): boolean {
  const { byId, children } = indexEntries(entries);
  const start = byId.get(entryId);
  if (!start) return false;
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (changesFiles(current)) return true;
    stack.push(...(children.get(current.id) ?? []));
  }
  return false;
}

export function versionOnPath(
  entries: SessionEntry[],
  leafId: string | null,
  versionEntryIds: string[],
): string | undefined {
  if (!leafId) return undefined;
  const { byId } = indexEntries(entries);
  const wanted = new Set(versionEntryIds);
  let current = byId.get(leafId);
  while (current) {
    if (wanted.has(current.id)) return current.id;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}
