import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { AdapterError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type {
  CreateIssueInput,
  GithubAdapterConfig,
  Issue,
  IssueAdapter,
  ListIssuesOptions,
  UpdateIssueInput,
} from './types.js';

const execFileAsync = promisify(execFile);

export interface PrInfo {
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  branch: string;
  url: string;
}

export interface PrComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
}

interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string }>;
  url: string;
}

function mapIssue(raw: GhIssue): Issue {
  return {
    id: String(raw.number),
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    state: raw.state.toLowerCase() === 'closed' ? 'closed' : 'open',
    labels: raw.labels.map((l) => l.name),
    url: raw.url,
  };
}

const JSON_FIELDS = 'number,title,body,state,labels,url';

export class GithubAdapter implements IssueAdapter {
  readonly type = 'github';
  private readonly repo: string;
  private readonly baseBranch: string;
  private readonly cwd?: string;

  constructor(config: GithubAdapterConfig, cwd?: string) {
    this.repo = config.repo;
    this.baseBranch = config.baseBranch ?? 'main';
    this.cwd = cwd;
  }

  private async gh(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('gh', args, {
        cwd: this.cwd,
        env: { ...process.env },
      });
      return stdout.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AdapterError(`gh ${args.join(' ')} failed: ${message}`);
    }
  }

  // ── Issue CRUD ──

  async get(issueRef: string): Promise<Issue> {
    const output = await this.gh([
      'issue',
      'view',
      issueRef,
      '--repo',
      this.repo,
      '--json',
      JSON_FIELDS,
    ]);
    return mapIssue(JSON.parse(output) as GhIssue);
  }

  async list(options?: ListIssuesOptions): Promise<Issue[]> {
    const args = ['issue', 'list', '--repo', this.repo, '--json', JSON_FIELDS];

    args.push('--state', options?.state ?? 'all');
    if (options?.labels?.length) {
      args.push('--label', options.labels.join(','));
    }
    args.push('--limit', String(options?.limit ?? 100));

    const output = await this.gh(args);
    const issues = JSON.parse(output) as GhIssue[];
    return issues.map(mapIssue);
  }

  async create(input: CreateIssueInput): Promise<Issue> {
    const args = [
      'issue',
      'create',
      '--repo',
      this.repo,
      '--title',
      input.title,
      '--body',
      input.body,
    ];
    if (input.labels?.length) {
      args.push('--label', input.labels.join(','));
    }

    const url = await this.gh(args);
    const match = url.match(/\/issues\/(\d+)$/);
    if (!match) {
      throw new AdapterError(`Unexpected gh issue create output: ${url}`);
    }
    return this.get(match[1]);
  }

  async update(issueRef: string, input: UpdateIssueInput): Promise<Issue> {
    const args = ['issue', 'edit', issueRef, '--repo', this.repo];
    if (input.title) args.push('--title', input.title);
    if (input.body) args.push('--body', input.body);

    await this.gh(args);

    if (input.state === 'closed') {
      await this.close(issueRef);
    }

    return this.get(issueRef);
  }

  async addLabel(issueRef: string, label: string): Promise<void> {
    await this.gh(['issue', 'edit', issueRef, '--repo', this.repo, '--add-label', label]);
  }

  async removeLabel(issueRef: string, label: string): Promise<void> {
    try {
      await this.gh(['issue', 'edit', issueRef, '--repo', this.repo, '--remove-label', label]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // TODO: 에러를 에이전트에 전달하는 것을 보장해야 함 (accumulator 패턴 등)
      logger.warn(`removeLabel failed: ${label} on ${issueRef}`, { error: message });
    }
  }

  async close(issueRef: string): Promise<void> {
    await this.gh(['issue', 'close', issueRef, '--repo', this.repo, '--reason', 'completed']);
  }

  // ── PR ──

  async createPr(options: {
    title: string;
    body: string;
    base?: string;
    head: string;
  }): Promise<PrInfo> {
    const args = [
      'pr',
      'create',
      '--repo',
      this.repo,
      '--title',
      options.title,
      '--body',
      options.body,
      '--head',
      options.head,
      '--base',
      options.base ?? this.baseBranch,
    ];

    const url = await this.gh(args);
    const match = url.match(/\/pull\/(\d+)$/);
    if (!match) {
      throw new AdapterError(`Unexpected gh pr create output: ${url}`);
    }
    return this.getPrStatus(Number(match[1]));
  }

  async getPrStatus(prNumber: number): Promise<PrInfo> {
    const output = await this.gh([
      'pr',
      'view',
      String(prNumber),
      '--repo',
      this.repo,
      '--json',
      'number,title,state,headRefName,url',
    ]);

    const data = JSON.parse(output) as {
      number: number;
      title: string;
      state: string;
      headRefName: string;
      url: string;
    };

    return {
      number: data.number,
      title: data.title,
      state: data.state.toLowerCase() as PrInfo['state'],
      branch: data.headRefName,
      url: data.url,
    };
  }

  async addPrComment(prNumber: number, body: string): Promise<void> {
    await this.gh(['pr', 'comment', String(prNumber), '--repo', this.repo, '--body', body]);
  }

  async getPrComments(prNumber: number): Promise<PrComment[]> {
    const output = await this.gh(['api', `repos/${this.repo}/issues/${prNumber}/comments`]);

    if (!output || output === '[]') return [];

    const data = JSON.parse(output) as Array<{
      id: number;
      body: string;
      user: { login: string };
      created_at: string;
    }>;

    return data.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.user.login,
      createdAt: c.created_at,
    }));
  }
}
