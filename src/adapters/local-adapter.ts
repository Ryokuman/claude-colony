import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { AdapterError } from '../core/errors.js';
import type {
  CreateIssueInput,
  Issue,
  IssueAdapter,
  ListIssuesOptions,
  LocalAdapterConfig,
  UpdateIssueInput,
} from './types.js';

interface IssueStore {
  nextId: number;
  issues: Issue[];
}

export class LocalAdapter implements IssueAdapter {
  readonly type = 'local';
  private readonly filePath: string;

  constructor(config: LocalAdapterConfig | undefined, targetRepo: string) {
    this.filePath = config?.filePath ?? path.join(targetRepo, '.colony', 'issues.json');
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
}
