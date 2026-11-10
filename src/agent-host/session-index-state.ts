import path from "node:path";
import type { SessionInfo } from "../shared/types";
import type { PersistedIndexRecord } from "./session-index-cache";
import { withSessionOrigin } from "./session-origin-store";
import type { LocatedProject } from "./session-project";

export interface IndexRecord extends PersistedIndexRecord {
  located?: LocatedProject | null;
}

export class SessionIndexState {
  private readonly byPath = new Map<string, IndexRecord>();
  private readonly pathById = new Map<string, string>();
  private readonly idByPath = new Map<string, string>();
  private invalid = 0;
  revision = 0;

  get size(): number {
    return this.byPath.size;
  }

  get invalidCount(): number {
    return this.invalid;
  }

  entry(filePath: string): IndexRecord | undefined {
    return this.byPath.get(filePath);
  }

  pathOf(sessionId: string): string | undefined {
    return this.pathById.get(sessionId);
  }

  paths(): IterableIterator<string> {
    return this.byPath.keys();
  }

  entries(): IterableIterator<IndexRecord> {
    return this.byPath.values();
  }

  upsert(record: PersistedIndexRecord): void {
    const previous = this.byPath.get(record.filePath);
    this.detach(record.filePath);
    const located =
      previous?.info?.id === record.info?.id && previous?.info?.cwd === record.info?.cwd
        ? previous?.located
        : undefined;
    this.byPath.set(record.filePath, { ...record, located });
    if (!record.valid) this.invalid += 1;
    if (record.info) {
      this.pathById.set(record.info.id, record.filePath);
      this.idByPath.set(record.filePath, record.info.id);
    }
    this.revision += 1;
  }

  remove(filePath: string): void {
    if (!this.byPath.has(filePath)) return;
    this.detach(filePath);
    this.byPath.delete(filePath);
    this.revision += 1;
  }

  locate(filePath: string, located: LocatedProject | null): void {
    const record = this.byPath.get(filePath);
    if (record) record.located = located;
  }

  info(filePath: string): SessionInfo | null {
    const record = this.byPath.get(filePath);
    if (!record?.info) return null;
    const info = this.baseInfo(record.info, record.parentPath);
    const located = record.located ?? this.inherited(info) ?? { projectRoot: info.cwd };
    const { worktreeBranch: _branch, ...base } = info;
    return { ...base, ...located };
  }

  list(): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const filePath of this.byPath.keys()) {
      const info = this.info(filePath);
      if (info) result.push(info);
    }
    return result.sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
  }

  private detach(filePath: string): void {
    const previous = this.byPath.get(filePath);
    if (previous && !previous.valid) this.invalid -= 1;
    const id = this.idByPath.get(filePath);
    if (id && this.pathById.get(id) === filePath) this.pathById.delete(id);
    this.idByPath.delete(filePath);
  }

  private baseInfo(info: SessionInfo, parentPath?: string): SessionInfo {
    const parentSessionId = parentPath ? this.idByPath.get(path.resolve(parentPath)) : undefined;
    return withSessionOrigin({ ...info, parentSessionId });
  }

  private inherited(info: SessionInfo): LocatedProject | null {
    const visited = new Set<string>([info.id]);
    let parent = info.parentSessionId;
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const ancestor = this.byPath.get(this.pathById.get(parent) ?? "");
      if (!ancestor?.info) return null;
      if (ancestor.located) return { projectRoot: ancestor.located.projectRoot };
      parent = this.baseInfo(ancestor.info, ancestor.parentPath).parentSessionId;
    }
    return null;
  }
}
