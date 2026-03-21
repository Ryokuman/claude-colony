import { describe, it, expect, vi, beforeEach } from 'vitest';

import { IssueStatus, TRANSITION_STATUSES } from '../../../src/core/issue-status.js';
import { NotionAdapter } from '../../../src/adapters/notion-adapter.js';
import type { NotionAdapterConfig } from '../../../src/adapters/types.js';

// ---------------------------------------------------------------------------
// Mock Notion client — in-memory page store
// ---------------------------------------------------------------------------

interface MockPage {
  id: string;
  properties: Record<string, unknown>;
  url: string;
  archived: boolean;
  in_trash: boolean;
}

/**
 * Convert Notion write-format properties to read-format (add plain_text fields).
 * The adapter writes `{ title: [{ text: { content: 'X' } }] }` but reads `{ title: [{ plain_text: 'X' }] }`.
 */
function normalizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const v = value as Record<string, unknown>;
    if (v.title && Array.isArray(v.title)) {
      result[key] = {
        title: (v.title as Array<{ text?: { content: string }; plain_text?: string }>).map((t) => ({
          ...t,
          plain_text: t.plain_text ?? t.text?.content ?? '',
        })),
      };
    } else if (v.rich_text && Array.isArray(v.rich_text)) {
      result[key] = {
        rich_text: (v.rich_text as Array<{ text?: { content: string }; plain_text?: string }>).map((t) => ({
          ...t,
          plain_text: t.plain_text ?? t.text?.content ?? '',
        })),
      };
    } else if (v.status) {
      // Status property: add group based on name for deriveStatus
      const statusObj = v.status as { name: string };
      const group = statusObj.name === 'Done' ? 'complete' : 'in_progress';
      result[key] = { status: { ...statusObj, group } };
    } else {
      result[key] = value;
    }
  }
  return result;
}

function createMockNotionClient() {
  const pages = new Map<string, MockPage>();
  let nextId = 1;

  function makePage(id: string, props: Record<string, unknown>): MockPage {
    return { id, properties: props, url: `https://notion.so/${id}`, archived: false, in_trash: false };
  }

  const client = {
    databases: {
      retrieve: vi.fn(async ({ database_id }: { database_id: string }) => ({
        id: database_id,
        data_sources: [{ id: `ds-${database_id}` }],
      })),
    },
    dataSources: {
      retrieve: vi.fn(async (_args: { data_source_id: string }) => ({
        properties: {
          Name: { type: 'title' },
        },
      })),
      update: vi.fn(async (_args: { data_source_id: string; properties: Record<string, unknown> }) => ({})),
      query: vi.fn(async (args: { data_source_id: string; filter?: unknown; page_size?: number; start_cursor?: string }) => {
        // Filter out archived pages (Notion API doesn't return archived pages in queries)
        let results = [...pages.values()]
          .filter((p) => !p.archived)
          .map((p) => ({ ...p, object: 'page' as const }));

        // Basic filter support for tests
        if (args.filter && typeof args.filter === 'object') {
          const f = args.filter as Record<string, unknown>;

          if (f.and) {
            const conditions = f.and as Array<Record<string, unknown>>;
            for (const cond of conditions) {
              results = applyFilter(results, cond);
            }
          } else if (f.or) {
            const conditions = f.or as Array<Record<string, unknown>>;
            const merged = new Set<string>();
            for (const cond of conditions) {
              for (const r of applyFilter(results, cond)) {
                merged.add(r.id);
              }
            }
            results = results.filter((r) => merged.has(r.id));
          } else {
            results = applyFilter(results, f);
          }
        }

        const size = args.page_size ?? 100;
        return {
          results: results.slice(0, size),
          has_more: results.length > size,
          next_cursor: results.length > size ? 'cursor' : null,
        };
      }),
    },
    pages: {
      retrieve: vi.fn(async ({ page_id }: { page_id: string }) => {
        const page = pages.get(page_id);
        if (!page) throw new Error(`Page not found: ${page_id}`);
        return { ...page, object: 'page' as const, archived: page.archived, in_trash: page.in_trash };
      }),
      create: vi.fn(async (args: { parent: unknown; properties: Record<string, unknown> }) => {
        const id = `page-${nextId++}`;
        // Convert input format to API response format (add plain_text)
        const normalized = normalizeProperties(args.properties);
        const page = makePage(id, normalized);
        pages.set(id, page);
        return { ...page, object: 'page' as const, archived: false, in_trash: false };
      }),
      update: vi.fn(async (args: { page_id: string; properties?: Record<string, unknown>; archived?: boolean }) => {
        const page = pages.get(args.page_id);
        if (!page) throw new Error(`Page not found: ${args.page_id}`);
        if (args.properties) {
          const normalized = normalizeProperties(args.properties);
          for (const [key, value] of Object.entries(normalized)) {
            page.properties[key] = value;
          }
        }
        // Handle archiving (close = archive in Notion API 2025-09-03)
        if (args.archived !== undefined) {
          page.archived = args.archived;
          page.in_trash = args.archived;
        }
        return { ...page, object: 'page' as const };
      }),
    },
  };

  function applyFilter(
    results: Array<MockPage & { object: 'page' }>,
    filter: Record<string, unknown>,
  ): Array<MockPage & { object: 'page' }> {
    const prop = filter.property as string | undefined;
    if (!prop) return results;

    if (filter.status) {
      const statusFilter = filter.status as Record<string, string>;
      return results.filter((r) => {
        const status = r.properties[prop] as { status?: { name: string } } | undefined;
        const name = status?.status?.name;
        if (statusFilter.equals) return name === statusFilter.equals;
        if (statusFilter.does_not_equal) return name !== statusFilter.does_not_equal;
        return true;
      });
    }

    if (filter.multi_select) {
      const msFilter = filter.multi_select as Record<string, string>;
      return results.filter((r) => {
        const ms = r.properties[prop] as { multi_select?: Array<{ name: string }> } | undefined;
        const names = ms?.multi_select?.map((s) => s.name) ?? [];
        if (msFilter.contains) return names.includes(msFilter.contains);
        return true;
      });
    }

    return results;
  }

  return { client, pages, makePage };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig(): NotionAdapterConfig {
  return { databaseId: 'db-123' };
}

function createAdapter(mock: ReturnType<typeof createMockNotionClient>, config?: NotionAdapterConfig) {
  return new NotionAdapter(config ?? defaultConfig(), undefined, mock.client as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotionAdapter', () => {
  let mock: ReturnType<typeof createMockNotionClient>;
  let adapter: NotionAdapter;

  beforeEach(() => {
    mock = createMockNotionClient();
    adapter = createAdapter(mock);
  });

  // ── CRUD ──────────────────────────────────────────────────────────────

  describe('CRUD', () => {
    // 이슈 생성 후 동일 ID로 조회하여 필드가 일치하는지 검증
    it('create → get round-trip', async () => {
      const created = await adapter.create({ title: 'Test', body: 'Body' });

      expect(created.title).toBe('Test');
      expect(created.body).toBe('Body');
      expect(created.state).toBe('open');

      const fetched = await adapter.get(created.id);
      expect(fetched.title).toBe('Test');
    });

    // 생성한 이슈들이 목록 조회 결과에 모두 포함되는지 검증
    it('list returns created issues', async () => {
      await adapter.create({ title: 'First', body: '' });
      await adapter.create({ title: 'Second', body: '' });

      const all = await adapter.list();
      expect(all).toHaveLength(2);
    });

    // 이슈 제목 수정 후 변경사항이 반영되었는지 검증
    it('update modifies fields', async () => {
      const created = await adapter.create({ title: 'Original', body: 'body' });
      const updated = await adapter.update(created.id, { title: 'Updated' });
      expect(updated.title).toBe('Updated');
    });

    // 이슈 닫기(아카이브) 후 상태가 closed로 변경되는지 검증
    it('close archives the page (state=closed)', async () => {
      const created = await adapter.create({ title: 'To close', body: '' });
      await adapter.close(created.id);

      // pages.update should have been called with archived: true
      expect(mock.client.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: created.id,
          archived: true,
        }),
      );

      const fetched = await adapter.get(created.id);
      expect(fetched.state).toBe('closed');
    });

    // 라벨 추가/제거가 정상적으로 동작하는지 검증
    it('addLabel and removeLabel', async () => {
      const created = await adapter.create({ title: 'Labeled', body: '' });

      await adapter.addLabel(created.id, 'bug');
      await adapter.addLabel(created.id, 'urgent');
      let fetched = await adapter.get(created.id);
      expect(fetched.labels).toContain('bug');
      expect(fetched.labels).toContain('urgent');

      await adapter.removeLabel(created.id, 'bug');
      fetched = await adapter.get(created.id);
      expect(fetched.labels).not.toContain('bug');
      expect(fetched.labels).toContain('urgent');
    });

    // 존재하지 않는 페이지 조회 시 에러가 발생하는지 검증
    it('get throws for non-existent page', async () => {
      await expect(adapter.get('nonexistent')).rejects.toThrow();
    });

    // 이슈 생성 시 라벨을 함께 지정할 수 있는지 검증
    it('create with labels', async () => {
      const created = await adapter.create({
        title: 'With labels',
        body: '',
        labels: ['feat', 'priority'],
      });
      expect(created.labels).toContain('feat');
      expect(created.labels).toContain('priority');
    });
  });

  // ── Status Semantics ──────────────────────────────────────────────────

  describe('Status semantics', () => {
    // open 상태 + 상태 속성 없음 → Pending(todo)으로 파생되는지 검증
    it('deriveStatus: open + no status → todo', async () => {
      const created = await adapter.create({ title: 'Fresh', body: '' });
      expect(adapter.deriveStatus(created)).toBe(IssueStatus.Pending);
    });

    // closed 상태의 이슈가 Completed(done)로 파생되는지 검증
    it('deriveStatus: closed → done', async () => {
      const created = await adapter.create({ title: 'Done', body: '' });
      await adapter.close(created.id);
      const closed = await adapter.get(created.id);
      expect(adapter.deriveStatus(closed)).toBe(IssueStatus.Completed);
    });

    // platformStatus가 'In Progress'일 때 InProgress로 매핑되는지 검증
    it('deriveStatus: platformStatus maps to in-progress', () => {
      const issue = {
        id: 'x',
        number: 1,
        title: 'T',
        body: '',
        state: 'open' as const,
        labels: [],
        url: '',
        platformStatus: 'In Progress',
      };
      expect(adapter.deriveStatus(issue)).toBe(IssueStatus.InProgress);
    });

    // todo/done 상태로의 직접 전환이 거부(에러)되는지 검증
    it('setStatus: todo/done → throws', async () => {
      const created = await adapter.create({ title: 'Guard', body: '' });
      await expect(adapter.setStatus(created.id, IssueStatus.Pending)).rejects.toThrow();
      await expect(adapter.setStatus(created.id, IssueStatus.Completed)).rejects.toThrow();
    });

    // setStatus로 in-progress 설정 시 Notion Status 속성이 업데이트되는지 검증
    it('setStatus: in-progress updates status property', async () => {
      const created = await adapter.create({ title: 'Working', body: '' });
      await adapter.setStatus(created.id, IssueStatus.InProgress);

      expect(mock.client.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: created.id,
          properties: expect.objectContaining({
            Status: { status: { name: 'In Progress' } },
          }),
        }),
      );
    });

    // 특정 상태로 필터링된 목록 조회가 올바른 쿼리를 실행하는지 검증
    it('listByStatus queries with status filter', async () => {
      // Create pages with statuses set
      const a = await adapter.create({ title: 'Active', body: '' });
      await adapter.setStatus(a.id, IssueStatus.InProgress);

      await adapter.create({ title: 'Idle', body: '' });

      const results = await adapter.listByStatus(TRANSITION_STATUSES);
      // The mock client's filter should handle status filtering
      expect(mock.client.dataSources.query).toHaveBeenCalled();
    });
  });

  // ── Data source resolution ────────────────────────────────────────────

  describe('Data source resolution', () => {
    // 데이터베이스에서 데이터 소스 ID를 자동 탐색하는지 검증
    it('discovers data source ID from database', async () => {
      await adapter.list();
      expect(mock.client.databases.retrieve).toHaveBeenCalledWith({
        database_id: 'db-123',
      });
    });

    // dataSourceId가 직접 제공되면 자동 탐색을 건너뛰는지 검증
    it('uses provided dataSourceId without discovery', async () => {
      const directAdapter = createAdapter(mock, {
        databaseId: 'db-123',
        dataSourceId: 'ds-direct',
      });
      await directAdapter.list();
      expect(mock.client.databases.retrieve).not.toHaveBeenCalled();
    });
  });

  // ── Custom property names ─────────────────────────────────────────────

  describe('Custom property names', () => {
    // 사용자 정의 속성 이름으로 Notion API를 호출하는지 검증
    it('uses custom property names', async () => {
      const customAdapter = createAdapter(mock, {
        databaseId: 'db-123',
        propertyNames: {
          title: 'Issue Title',
          body: 'Details',
          status: 'Workflow',
          labels: 'Categories',
        },
      });

      await customAdapter.create({ title: 'Custom', body: 'Body' });

      expect(mock.client.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            'Issue Title': expect.any(Object),
            Details: expect.any(Object),
          }),
        }),
      );
    });
  });

  // ── setup (ensureProperties) ──────────────────────────────────────────

  describe('setup', () => {
    // 프로퍼티가 없을 때 update를 호출하여 추가하는지 검증
    it('adds missing properties via dataSources.update', async () => {
      // Default mock returns only Name (title) — missing Description, Status, Tags
      await adapter.setup();

      expect(mock.client.dataSources.retrieve).toHaveBeenCalledWith({
        data_source_id: 'ds-db-123',
      });
      expect(mock.client.dataSources.update).toHaveBeenCalledWith({
        data_source_id: 'ds-db-123',
        properties: {
          Description: { rich_text: {} },
          Status: { status: {} },
          Tags: { multi_select: {} },
        },
      });
    });

    // 모든 프로퍼티가 이미 있으면 update를 호출하지 않는지 검증 (idempotent)
    it('skips update when all properties already exist', async () => {
      mock.client.dataSources.retrieve.mockResolvedValueOnce({
        properties: {
          Name: { type: 'title' },
          Description: { type: 'rich_text' },
          Status: { type: 'status' },
          Tags: { type: 'multi_select' },
        },
      });

      await adapter.setup();

      expect(mock.client.dataSources.update).not.toHaveBeenCalled();
    });

    // 일부 프로퍼티만 없을 때 해당 프로퍼티만 추가하는지 검증
    it('adds only missing properties', async () => {
      mock.client.dataSources.retrieve.mockResolvedValueOnce({
        properties: {
          Name: { type: 'title' },
          Description: { type: 'rich_text' },
          // Status and Tags are missing
        },
      });

      await adapter.setup();

      expect(mock.client.dataSources.update).toHaveBeenCalledWith({
        data_source_id: 'ds-db-123',
        properties: {
          Status: { status: {} },
          Tags: { multi_select: {} },
        },
      });
    });

    // retrieve 실패 시 graceful하게 경고만 출력하는지 검증
    it('handles retrieve failure gracefully', async () => {
      mock.client.dataSources.retrieve.mockRejectedValueOnce(new Error('API error'));

      // Should not throw
      await adapter.setup();

      expect(mock.client.dataSources.update).not.toHaveBeenCalled();
    });
  });
});
