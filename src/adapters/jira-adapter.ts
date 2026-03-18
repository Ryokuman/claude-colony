import { AdapterError } from '../core/errors.js';
import {
  type IssueStatus,
  type IssueStatusInfo,
  IssueStatus as Status,
  TRANSITION_STATUSES,
  findStatusKey,
  DEFAULT_STATUS_MAPPINGS,
} from '../core/issue-status.js';
import type {
  CreateIssueInput,
  Issue,
  IssueAdapter,
  JiraAdapterConfig,
  ListIssuesOptions,
  StatusMapping,
  UpdateIssueInput,
} from './types.js';

interface JiraIssue {
  key: string;
  id: string;
  fields: {
    summary: string;
    description: unknown;
    status: { name: string; statusCategory?: { key: string } };
    labels: string[];
  };
  self: string;
}

/** Extract plain text from Jira's ADF (Atlassian Document Format) or string description. */
function extractDescription(desc: unknown): string {
  if (desc === null || desc === undefined) return '';
  if (typeof desc === 'string') return desc;
  if (typeof desc === 'object' && 'content' in (desc as Record<string, unknown>)) {
    const doc = desc as { content?: Array<{ content?: Array<{ text?: string }> }> };
    return (
      doc.content
        ?.flatMap((block) => block.content?.map((inline) => inline.text ?? '') ?? [])
        .join('\n') ?? ''
    );
  }
  return '';
}

function mapIssue(raw: JiraIssue, host: string): Issue {
  const keyNum = Number(raw.key.split('-').pop()) || 0;
  const categoryKey = raw.fields.status.statusCategory?.key?.toLowerCase();
  const isDone =
    categoryKey === 'done' || raw.fields.status.name.toLowerCase() === 'done';
  return {
    id: raw.key,
    number: keyNum,
    title: raw.fields.summary,
    body: extractDescription(raw.fields.description),
    state: isDone ? 'closed' : 'open',
    labels: raw.fields.labels,
    url: `${host}/browse/${raw.key}`,
    platformStatus: raw.fields.status.name,
  };
}

export class JiraAdapter implements IssueAdapter {
  readonly type = 'jira';
  private readonly host: string;
  private readonly project: string;
  private readonly auth: string;
  private readonly mapping: StatusMapping;

  constructor(config: JiraAdapterConfig, statusMapping?: Partial<StatusMapping>) {
    this.host = config.host.replace(/\/$/, '');
    this.project = config.projectKey;
    this.mapping = {
      ...DEFAULT_STATUS_MAPPINGS.jira,
      ...statusMapping,
    };

    const token = process.env.JIRA_API_TOKEN;
    if (!token) throw new AdapterError('JIRA_API_TOKEN environment variable is required');
    this.auth = Buffer.from(`${config.email}:${token}`).toString('base64');
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.host}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AdapterError(`Jira API ${path}: ${res.status} ${res.statusText} ${body}`.trim());
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return {};
    }
    return res.json();
  }

  async get(issueRef: string): Promise<Issue> {
    const raw = (await this.request(`/rest/api/3/issue/${issueRef}`)) as JiraIssue;
    return mapIssue(raw, this.host);
  }

  async list(options?: ListIssuesOptions): Promise<Issue[]> {
    const clauses: string[] = [`project = "${this.project}"`];

    if (options?.state === 'open') {
      clauses.push('statusCategory != Done');
    } else if (options?.state === 'closed') {
      clauses.push('statusCategory = Done');
    }

    if (options?.labels?.length) {
      const labelClauses = options.labels.map((l) => `labels = "${l}"`).join(' AND ');
      clauses.push(labelClauses);
    }

    if (options?.statuses?.length) {
      const statusClause = options.statuses.map((s) => `"${s}"`).join(', ');
      clauses.push(`status IN (${statusClause})`);
    }

    const jql = `${clauses.join(' AND ')} ORDER BY created DESC`;
    const limit = options?.limit ?? 1000;
    const pageSize = Math.min(50, limit);
    const allIssues: Issue[] = [];
    let startAt = 0;

    while (allIssues.length < limit) {
      const data = (await this.request('/rest/api/3/search', {
        method: 'POST',
        body: JSON.stringify({
          jql,
          startAt,
          maxResults: Math.min(pageSize, limit - allIssues.length),
          fields: ['summary', 'description', 'status', 'labels'],
        }),
      })) as { issues: JiraIssue[]; startAt: number; total: number };

      allIssues.push(...data.issues.map((i) => mapIssue(i, this.host)));

      if (data.issues.length === 0 || startAt + data.issues.length >= data.total) break;
      startAt += data.issues.length;
    }

    return allIssues;
  }

  async create(input: CreateIssueInput): Promise<Issue> {
    // issue = Story, task = Task, parentRef → Sub-task
    const jiraType = input.parentRef ? 'Sub-task' : input.issueType === 'story' ? 'Story' : 'Task';

    const fields: Record<string, unknown> = {
      project: { key: this.project },
      summary: input.title,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: input.body }],
          },
        ],
      },
      issuetype: { name: jiraType },
      ...(input.labels?.length ? { labels: input.labels } : {}),
    };

    if (input.parentRef) {
      fields.parent = { key: input.parentRef };
    }

    const data = (await this.request('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    })) as { key: string };

    return this.get(data.key);
  }

  async update(issueRef: string, input: UpdateIssueInput): Promise<Issue> {
    const fields: Record<string, unknown> = {};

    if (input.title !== undefined) {
      fields.summary = input.title;
    }
    if (input.body !== undefined) {
      fields.description = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: input.body }],
          },
        ],
      };
    }

    if (Object.keys(fields).length > 0) {
      await this.request(`/rest/api/3/issue/${issueRef}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      });
    }

    if (input.state === 'closed') {
      await this.transitionTo(issueRef, 'done');
    }

    return this.get(issueRef);
  }

  async addLabel(issueRef: string, label: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${issueRef}`, {
      method: 'PUT',
      body: JSON.stringify({
        update: { labels: [{ add: label }] },
      }),
    });
  }

  async removeLabel(issueRef: string, label: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${issueRef}`, {
      method: 'PUT',
      body: JSON.stringify({
        update: { labels: [{ remove: label }] },
      }),
    });
  }

  async close(issueRef: string): Promise<void> {
    await this.transitionTo(issueRef, 'done');
  }

  // ── Status semantics ──

  deriveStatus(issue: Issue): IssueStatus {
    if (issue.state === 'closed') return Status.Completed;

    if (issue.platformStatus) {
      const status = findStatusKey(this.mapping, issue.platformStatus);
      if (status) return status;
    }
    return Status.Pending;
  }

  async setStatus(issueRef: string, status: IssueStatus): Promise<void> {
    if (status === Status.Pending || status === Status.Completed) {
      throw new Error(`Cannot set status to ${status} directly`);
    }

    const platformStatus = this.mapping[status as keyof StatusMapping];
    await this.transitionTo(issueRef, platformStatus);
  }

  async listByStatus(statuses: IssueStatus[]): Promise<IssueStatusInfo[]> {
    // Jira: native status field 기반 검색
    const managedStatuses = statuses
      .filter((s): s is keyof StatusMapping => s in this.mapping)
      .map((s) => this.mapping[s]);
    const issues = await this.list({ state: 'open', statuses: managedStatuses });

    return issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      status: this.deriveStatus(issue),
      url: issue.url,
    }));
  }

  // ── Jira-specific ──

  async transitionTo(issueRef: string, targetName: string): Promise<void> {
    const data = (await this.request(`/rest/api/3/issue/${issueRef}/transitions`)) as {
      transitions: Array<{
        id: string;
        name: string;
        to?: { statusCategory?: { key: string } };
      }>;
    };

    // Match by exact name first, then by statusCategory key (handles localized Jira)
    const nameLower = targetName.toLowerCase();
    const target =
      data.transitions.find((t) => t.name.toLowerCase() === nameLower) ??
      data.transitions.find((t) => t.to?.statusCategory?.key?.toLowerCase() === nameLower);

    if (!target) {
      const available = data.transitions.map((t) => t.name).join(', ');
      throw new AdapterError(
        `No transition to "${targetName}" found for ${issueRef}. Available: ${available}`,
      );
    }

    await this.request(`/rest/api/3/issue/${issueRef}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: target.id } }),
    });
  }
}
