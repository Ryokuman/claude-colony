import { AdapterError } from '../core/errors.js';
import type {
  CreateIssueInput,
  Issue,
  IssueAdapter,
  JiraAdapterConfig,
  ListIssuesOptions,
  UpdateIssueInput,
} from './types.js';

interface JiraIssue {
  key: string;
  id: string;
  fields: {
    summary: string;
    description: string | null;
    status: { name: string };
    labels: string[];
  };
  self: string;
}

function mapIssue(raw: JiraIssue, host: string): Issue {
  const keyNum = Number(raw.key.split('-').pop()) || 0;
  return {
    id: raw.key,
    number: keyNum,
    title: raw.fields.summary,
    body: raw.fields.description ?? '',
    state: raw.fields.status.name.toLowerCase() === 'done' ? 'closed' : 'open',
    labels: raw.fields.labels,
    url: `${host}/browse/${raw.key}`,
  };
}

export class JiraAdapter implements IssueAdapter {
  readonly type = 'jira';
  private readonly host: string;
  private readonly project: string;
  private readonly auth: string;

  constructor(config: JiraAdapterConfig) {
    this.host = config.host.replace(/\/$/, '');
    this.project = config.project;

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
    const clauses: string[] = [`project = ${this.project}`];

    if (options?.state === 'open') {
      clauses.push('statusCategory != Done');
    } else if (options?.state === 'closed') {
      clauses.push('statusCategory = Done');
    }

    if (options?.labels?.length) {
      const labelClauses = options.labels.map((l) => `labels = "${l}"`).join(' AND ');
      clauses.push(labelClauses);
    }

    const jql = `${clauses.join(' AND ')} ORDER BY created DESC`;
    const maxResults = options?.limit ?? 50;
    const data = (await this.request(
      `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`,
    )) as { issues: JiraIssue[] };
    return data.issues.map((i) => mapIssue(i, this.host));
  }

  async create(input: CreateIssueInput): Promise<Issue> {
    const body: Record<string, unknown> = {
      fields: {
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
        issuetype: { name: 'Task' },
        ...(input.labels?.length ? { labels: input.labels } : {}),
      },
    };

    const data = (await this.request('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify(body),
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
      await this.transitionTo(issueRef, 'Done');
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
    await this.transitionTo(issueRef, 'Done');
  }

  private async transitionTo(issueRef: string, targetName: string): Promise<void> {
    const data = (await this.request(`/rest/api/3/issue/${issueRef}/transitions`)) as {
      transitions: Array<{ id: string; name: string }>;
    };

    const target = data.transitions.find((t) => t.name.toLowerCase() === targetName.toLowerCase());

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
