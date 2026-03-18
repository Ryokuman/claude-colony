import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { AdapterError } from '../core/errors.js';
import {
  type IssueStatus,
  type IssueStatusInfo,
  IssueStatus as Status,
  TRANSITION_STATUSES,
  findStatusKey,
  DEFAULT_STATUS_MAPPINGS,
} from '../core/issue-status.js';
import { logger } from '../core/logger.js';
import type {
  CreateIssueInput,
  Issue,
  IssueAdapter,
  ListIssuesOptions,
  LocalAdapterConfig,
  StatusMapping,
  UpdateIssueInput,
} from './types.js';

interface IssueStore {
  nextId: number;
  issues: Issue[];
}

export class LocalAdapter implements IssueAdapter {
  readonly type = 'local';
  private readonly filePath: string;
  private readonly mapping: StatusMapping;

  constructor(
    config: LocalAdapterConfig | undefined,
    targetRepo: string,
    statusMapping?: Partial<StatusMapping>,
  ) {
    this.filePath = config?.filePath ?? path.join(targetRepo, '.colony', 'issues.json');
    this.mapping = {
      ...DEFAULT_STATUS_MAPPINGS.local,
      ...statusMapping,
    };
  }

  private async load(): Promise<IssueStore> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      return JSON.parse(content) as IssueStore;
    } catch {
      return { nextId: 1, issues: [] };
    }
  }

  private async save(store: IssueStore): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  private findIssue(store: IssueStore, issueRef: string): Issue {
    const num = Number(issueRef);
    const issue = store.issues.find((i) => i.number === num);
    if (!issue) throw new AdapterError(`Issue #${issueRef} not found`);
    return issue;
  }

  async get(issueRef: string): Promise<Issue> {
    const store = await this.load();
    return this.findIssue(store, issueRef);
  }

  async list(options?: ListIssuesOptions): Promise<Issue[]> {
    const store = await this.load();
    let issues = store.issues;

    if (options?.state && options.state !== 'all') {
      issues = issues.filter((i) => i.state === options.state);
    }
    if (options?.labels?.length) {
      issues = issues.filter((i) => options.labels!.some((l) => i.labels.includes(l)));
    }
    if (options?.limit) {
      issues = issues.slice(0, options.limit);
    }

    return issues;
  }

  async create(input: CreateIssueInput): Promise<Issue> {
    const store = await this.load();
    const issue: Issue = {
      id: String(store.nextId),
      number: store.nextId,
      title: input.title,
      body: input.body,
      state: 'open',
      labels: input.labels ?? [],
      url: '',
    };
    store.issues.push(issue);
    store.nextId++;
    await this.save(store);
    return issue;
  }

  async update(issueRef: string, input: UpdateIssueInput): Promise<Issue> {
    const store = await this.load();
    const issue = this.findIssue(store, issueRef);

    if (input.title !== undefined) issue.title = input.title;
    if (input.body !== undefined) issue.body = input.body;
    if (input.state !== undefined) issue.state = input.state;

    await this.save(store);
    return issue;
  }

  async addLabel(issueRef: string, label: string): Promise<void> {
    const store = await this.load();
    const issue = this.findIssue(store, issueRef);
    if (!issue.labels.includes(label)) {
      issue.labels.push(label);
      await this.save(store);
    }
  }

  async removeLabel(issueRef: string, label: string): Promise<void> {
    const store = await this.load();
    const issue = this.findIssue(store, issueRef);
    issue.labels = issue.labels.filter((l) => l !== label);
    await this.save(store);
  }

  async close(issueRef: string): Promise<void> {
    await this.update(issueRef, { state: 'closed' });
  }

  // ── Status semantics ──

  deriveStatus(issue: Issue): IssueStatus {
    if (issue.state === 'closed') return Status.Completed;

    // Only match TRANSITION_STATUSES (fixes defense gap from original code)
    for (const label of issue.labels) {
      const status = findStatusKey(this.mapping, label);
      if (status && TRANSITION_STATUSES.includes(status)) return status;
    }
    return Status.Pending;
  }

  async setStatus(issueRef: string, status: IssueStatus): Promise<void> {
    if (status === Status.Pending || status === Status.Completed) {
      throw new Error(`Cannot set status to ${status} directly`);
    }

    const platformStatus = this.mapping[status as keyof StatusMapping];
    const managedLabels = TRANSITION_STATUSES.map((s) => this.mapping[s as keyof StatusMapping]);
    const labelsToRemove = managedLabels.filter((l) => l !== platformStatus);

    for (const label of labelsToRemove) {
      await this.removeLabel(issueRef, label).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        // TODO: 에러를 에이전트에 전달하는 것을 보장해야 함 (accumulator 패턴 등)
        logger.warn(`removeLabel failed: ${label} on issue #${issueRef}`, { error: message });
      });
    }
    await this.addLabel(issueRef, platformStatus);
  }

  async listByStatus(statuses: IssueStatus[]): Promise<IssueStatusInfo[]> {
    // Local: OR 시맨틱으로 managed labels 필터
    const managedLabels = statuses
      .filter((s): s is keyof StatusMapping => s in this.mapping)
      .map((s) => this.mapping[s]);
    const issues = await this.list({ state: 'open', labels: managedLabels });

    return issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      status: this.deriveStatus(issue),
      url: issue.url,
    }));
  }
}
