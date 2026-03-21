/**
 * Notion E2E 테스트 — NotionAdapter CRUD + 상태 관리 검증
 *
 * 사전 조건:
 *   1. Notion 워크스페이스에 내부 통합(integration)이 생성되어 있어야 함
 *   2. 통합에 최소 1개 페이지가 공유(연결)되어 있어야 함
 *   3. NOTION_API_KEY 환경변수 설정
 *
 * 사용법:
 *   # 기존 DB 사용 (권장)
 *   NOTION_API_KEY="ntn_..." NOTION_DATABASE_ID="..." npx tsx scripts/e2e-notion.ts
 *
 *   # 새 DB 자동 생성
 *   NOTION_API_KEY="ntn_..." npx tsx scripts/e2e-notion.ts
 *
 * 동작:
 *   - NOTION_DATABASE_ID 설정 시: 기존 DB를 그대로 사용 (propertyNames 자동 설정)
 *   - 미설정 시: 공유된 페이지를 검색하여 부모로 사용 → 테스트용 DB 자동 생성
 *   - E2E 테스트 실행
 *   - 정리: 생성된 페이지를 아카이브
 */
import { Client } from '@notionhq/client';

import { NotionAdapter } from '../src/adapters/notion-adapter.js';
import { IssueStatus } from '../src/core/issue-status.js';
import type { IssueAdapter } from '../src/adapters/types.js';
import type { NotionAdapterConfig } from '../src/adapters/types.js';

// ---------------------------------------------------------------------------
// Result tracking (same pattern as e2e-adapters.ts)
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}

const results: TestResult[] = [];

function log(name: string, status: 'PASS' | 'FAIL' | 'SKIP', detail: string) {
  results.push({ name, status, detail });
  const icon =
    status === 'PASS'
      ? '\x1b[32m[PASS]\x1b[0m'
      : status === 'SKIP'
        ? '\x1b[33m[SKIP]\x1b[0m'
        : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${icon} ${name}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Setup: find parent page and create test database
// ---------------------------------------------------------------------------

async function setupTestDatabase(client: Client): Promise<{
  databaseId: string;
  parentPageId: string | null;
  createdPageId: string | null;
}> {
  console.log('\n--- Setup ---');

  let parentPageId: string | undefined;
  let createdPageId: string | null = null;

  // 1) Check for explicit parent page ID from env
  if (process.env.NOTION_PARENT_PAGE_ID) {
    parentPageId = process.env.NOTION_PARENT_PAGE_ID;
    console.log(`  Using NOTION_PARENT_PAGE_ID: ${parentPageId}`);
  } else {
    // 2) Search for any accessible page to use as parent
    const searchResult = await client.search({
      filter: { property: 'object', value: 'page' },
      page_size: 10,
    });

    if (searchResult.results.length > 0) {
      parentPageId = searchResult.results[0].id;
      console.log(`  Found accessible page: ${parentPageId}`);
    } else {
      throw new Error(
        'No accessible pages found.\n' +
          '  To fix either:\n' +
          '    a) Open Notion -> any page -> "..." menu -> "Connections" -> add your integration\n' +
          '    b) Set NOTION_PARENT_PAGE_ID env var to a page ID shared with the integration\n' +
          '  Then re-run this script.',
      );
    }
  }

  // Create a child page to contain our test database
  console.log('  Creating test parent page...');
  const testPage = await client.pages.create({
    parent: { type: 'page_id', page_id: parentPageId },
    properties: {
      title: { title: [{ text: { content: `agent-hive E2E Test ${new Date().toISOString()}` } }] },
    } as Parameters<typeof client.pages.create>[0]['properties'],
  });
  createdPageId = testPage.id;
  console.log(`  Created test page: ${createdPageId}`);

  // Create database with required properties
  console.log('  Creating test database...');
  const db = await client.databases.create({
    parent: { type: 'page_id', page_id: createdPageId },
    title: [{ text: { content: 'E2E Issues' } }],
    properties: {
      Name: { title: {} },
      Description: { rich_text: {} },
      Status: {
        status: {
          options: [
            { name: 'Not started', color: 'default' },
            { name: 'In Progress', color: 'blue' },
            { name: 'In Review', color: 'yellow' },
            { name: 'Waiting Merge', color: 'orange' },
            { name: 'Done', color: 'green' },
          ],
          groups: [
            { name: 'To-do', option_ids: [], color: 'default' },
            { name: 'In progress', option_ids: [], color: 'blue' },
            { name: 'Complete', option_ids: [], color: 'green' },
          ],
        },
      } as Record<string, unknown>,
      Tags: { multi_select: {} },
    },
  });

  console.log(`  Created database: ${db.id}`);
  console.log(`  URL: ${(db as Record<string, unknown>).url}`);

  return {
    databaseId: db.id,
    parentPageId,
    createdPageId,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup(client: Client, pageIds: string[]) {
  for (const pageId of pageIds) {
    try {
      await client.pages.update({
        page_id: pageId,
        archived: true,
      });
    } catch (e) {
      console.log(`  [cleanup] Failed to archive ${pageId}: ${e}`);
    }
  }
}

// ---------------------------------------------------------------------------
// E2E test runner
// ---------------------------------------------------------------------------

async function runNotionE2E(
  adapter: IssueAdapter,
  cleanupFn: () => Promise<void>,
  options: { hasStatus: boolean; hasLabels: boolean; hasBody: boolean },
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Notion E2E');
  console.log(`${'='.repeat(60)}`);
  console.log(`  DB capabilities: status=${options.hasStatus}, labels=${options.hasLabels}, body=${options.hasBody}`);

  try {
    // ── create ──
    console.log('\n--- CRUD ---');
    let issue;
    try {
      issue = await adapter.create({
        title: '[E2E] 테스트 이슈 — Notion',
        body: options.hasBody ? `자동 생성됨 (${new Date().toISOString()})` : '',
      });
      log('create', 'PASS', `id=${issue.id}, number=${issue.number}`);
    } catch (e) {
      log('create', 'FAIL', String(e));
      return;
    }

    const ref = issue.id;

    // ── get ──
    try {
      const fetched = await adapter.get(ref);
      const ok = fetched.title.includes('[E2E]') && fetched.state === 'open';
      log('get', ok ? 'PASS' : 'FAIL', `title="${fetched.title}", state=${fetched.state}`);
    } catch (e) {
      log('get', 'FAIL', String(e));
    }

    // ── list ──
    try {
      const all = await adapter.list({ state: 'open' });
      const found = all.some((i) => i.id === ref);
      log('list(open)', found ? 'PASS' : 'FAIL', `${all.length}개 중 ${found ? '찾음' : '못찾음'}`);
    } catch (e) {
      log('list', 'FAIL', String(e));
    }

    // ── update ──
    try {
      const updated = await adapter.update(ref, { title: '[E2E] 수정됨 — Notion' });
      const ok = updated.title.includes('수정됨');
      log('update', ok ? 'PASS' : 'FAIL', `title="${updated.title}"`);
    } catch (e) {
      log('update', 'FAIL', String(e));
    }

    // ── addLabel ──
    if (options.hasLabels) {
      try {
        await adapter.addLabel(ref, 'e2e-test');
        const fetched = await adapter.get(ref);
        const ok = fetched.labels.includes('e2e-test');
        log('addLabel', ok ? 'PASS' : 'FAIL', `labels=${JSON.stringify(fetched.labels)}`);
      } catch (e) {
        log('addLabel', 'FAIL', String(e));
      }

      // ── removeLabel ──
      try {
        await adapter.removeLabel(ref, 'e2e-test');
        const fetched = await adapter.get(ref);
        const ok = !fetched.labels.includes('e2e-test');
        log('removeLabel', ok ? 'PASS' : 'FAIL', `labels=${JSON.stringify(fetched.labels)}`);
      } catch (e) {
        log('removeLabel', 'FAIL', String(e));
      }
    } else {
      log('addLabel', 'SKIP', 'DB has no multi_select labels property');
      log('removeLabel', 'SKIP', 'DB has no multi_select labels property');
    }

    // ── Status semantics ──
    console.log('\n--- Status ---');

    try {
      const fetched = await adapter.get(ref);
      const status = adapter.deriveStatus(fetched);
      const ok = status === IssueStatus.Pending;
      log('deriveStatus(open)', ok ? 'PASS' : 'FAIL', `status=${status}`);
    } catch (e) {
      log('deriveStatus(open)', 'FAIL', String(e));
    }

    if (options.hasStatus) {
      try {
        await adapter.setStatus(ref, IssueStatus.InProgress);
        const fetched = await adapter.get(ref);
        const status = adapter.deriveStatus(fetched);
        const ok = status === IssueStatus.InProgress;
        log('setStatus(in-progress)', ok ? 'PASS' : 'FAIL', `derived=${status}`);
      } catch (e) {
        log('setStatus(in-progress)', 'FAIL', String(e));
      }

      try {
        await adapter.setStatus(ref, IssueStatus.InReview);
        const fetched = await adapter.get(ref);
        const status = adapter.deriveStatus(fetched);
        const ok = status === IssueStatus.InReview;
        log('setStatus(reviewing)', ok ? 'PASS' : 'FAIL', `derived=${status}`);
      } catch (e) {
        log('setStatus(reviewing)', 'FAIL', String(e));
      }

      try {
        const infos = await adapter.listByStatus([IssueStatus.InReview]);
        const found = infos.some((i) => i.number === issue.number);
        log('listByStatus', found ? 'PASS' : 'FAIL', `${infos.length}개 중 ${found ? '찾음' : '못찾음'}`);
      } catch (e) {
        log('listByStatus', 'FAIL', String(e));
      }
    } else {
      log('setStatus(in-progress)', 'SKIP', 'DB has no Status property');
      log('setStatus(reviewing)', 'SKIP', 'DB has no Status property');
      log('listByStatus', 'SKIP', 'DB has no Status property');
    }

    try {
      await adapter.setStatus(ref, IssueStatus.Pending);
      log('setStatus(todo) guard', 'FAIL', '에러 안남');
    } catch {
      log('setStatus(todo) guard', 'PASS', '거부됨');
    }

    // ── close ──
    console.log('\n--- Close ---');
    try {
      await adapter.close(ref);
      const fetched = await adapter.get(ref);
      const ok = fetched.state === 'closed';
      log('close', ok ? 'PASS' : 'FAIL', `state=${fetched.state}`);
    } catch (e) {
      log('close', 'FAIL', String(e));
    }

    try {
      const fetched = await adapter.get(ref);
      const status = adapter.deriveStatus(fetched);
      const ok = status === IssueStatus.Completed;
      log('deriveStatus(closed)', ok ? 'PASS' : 'FAIL', `status=${status}`);
    } catch (e) {
      log('deriveStatus(closed)', 'FAIL', String(e));
    }

    // ── error handling ──
    console.log('\n--- Error ---');
    try {
      await adapter.get('NONEXISTENT-99999');
      log('get(not found)', 'FAIL', '에러 안남');
    } catch {
      log('get(not found)', 'PASS', '에러 발생 (정상)');
    }
  } finally {
    try {
      await cleanupFn();
      console.log('\n  [cleanup] 정리 완료');
    } catch (e) {
      console.log(`\n  [cleanup] 정리 실패: ${e}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error('NOTION_API_KEY 환경변수가 필요합니다.');
    process.exit(1);
  }

  const client = new Client({ auth: apiKey });

  let databaseId: string;
  let createdPageId: string | null = null;
  let adapterConfig: NotionAdapterConfig;
  let dbCapabilities = { hasStatus: true, hasLabels: true, hasBody: true };

  // If NOTION_DATABASE_ID is set, use existing DB directly (skip creation)
  if (process.env.NOTION_DATABASE_ID) {
    databaseId = process.env.NOTION_DATABASE_ID;
    console.log(`\n--- Setup ---`);
    console.log(`  Using existing database: ${databaseId}`);

    // Discover DB properties via data source
    try {
      const db = await client.databases.retrieve({ database_id: databaseId });
      const dataSources = (db as Record<string, unknown>).data_sources as
        | Array<{ id: string; name?: string }>
        | undefined;
      console.log(`  Data sources: ${JSON.stringify(dataSources)}`);

      // Query first page to discover property names
      if (dataSources?.length) {
        const dsId = dataSources[0].id;
        const sample = await (client as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)
          .dataSources.query({ data_source_id: dsId, page_size: 1 });
        const sampleResults = (sample as { results: Array<Record<string, unknown>> }).results;
        if (sampleResults.length > 0) {
          const props = sampleResults[0].properties as Record<string, Record<string, unknown>>;
          console.log(`  Available properties: ${Object.keys(props).join(', ')}`);
          for (const [name, val] of Object.entries(props)) {
            console.log(`    - ${name}: type=${val.type}`);
          }
        } else {
          console.log('  No sample pages found, using defaults');
        }
      }
    } catch (e) {
      console.log(`  [WARN] Could not inspect database: ${e}`);
    }

    // Configure for the existing "업무 목록" DB:
    // Properties: 회사명(title), ID(unique_id), 난이도(select), 작성자(people), 담당자(people), 우선도(select), GitHub 풀 리퀘스트(relation)
    // Missing: Description (body), Status, Tags (labels)
    adapterConfig = {
      databaseId,
      propertyNames: {
        title: '회사명',
        // These properties don't exist in this DB, but the adapter should handle gracefully
        body: 'Description',
        status: 'Status',
        labels: 'Tags',
      },
    };
    dbCapabilities = { hasStatus: false, hasLabels: false, hasBody: false };
    console.log(`  Configured propertyNames: title='회사명'`);
    console.log(`  Note: DB lacks Description, Status, Tags properties. Related tests will be skipped.`);
  } else {
    // Otherwise, create a test database under a parent page
    try {
      const setup = await setupTestDatabase(client);
      databaseId = setup.databaseId;
      createdPageId = setup.createdPageId;
    } catch (e) {
      console.error(`\n  [ERROR] 설정 실패: ${e}`);
      console.error('  Tip: Set NOTION_DATABASE_ID to use an existing database directly.');
      process.exit(1);
    }
    adapterConfig = { databaseId };
  }

  // Create adapter
  const adapter = new NotionAdapter(adapterConfig, undefined, client);

  // Track created issue IDs for cleanup
  const createdIssueIds: string[] = [];
  const originalCreate = adapter.create.bind(adapter);
  adapter.create = async (...args: Parameters<typeof adapter.create>) => {
    const result = await originalCreate(...args);
    createdIssueIds.push(result.id);
    return result;
  };

  // Run E2E tests
  await runNotionE2E(
    adapter,
    async () => {
      // Archive test issues created during E2E
      if (createdIssueIds.length > 0) {
        await cleanup(client, createdIssueIds);
      }
      // Archive test page (if we created one)
      if (createdPageId) {
        await cleanup(client, [createdPageId]);
      }
    },
    dbCapabilities,
  );

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Notion E2E 결과 요약');
  console.log(`${'='.repeat(60)}\n`);

  const pass = results.filter((t) => t.status === 'PASS').length;
  const fail = results.filter((t) => t.status === 'FAIL').length;
  const skip = results.filter((t) => t.status === 'SKIP').length;
  const icon = fail === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${icon} Notion: ${pass}/${results.length} passed, ${skip} skipped`);

  if (fail > 0) {
    for (const t of results.filter((t) => t.status === 'FAIL')) {
      console.log(`    \x1b[31m- ${t.name}: ${t.detail}\x1b[0m`);
    }
  }

  console.log(`\n  Total: ${pass} passed, ${fail} failed, ${skip} skipped (${results.length} total)\n`);

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('E2E 실행 실패:', e);
  process.exit(1);
});
