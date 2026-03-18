/**
 * E2E 테스트 — 모든 어댑터의 실제 CRUD + 상태 관리 검증
 *
 * 사용법:
 *   npx tsx scripts/e2e-adapters.ts [adapter...]
 *
 * 예시:
 *   npx tsx scripts/e2e-adapters.ts              # 전부
 *   npx tsx scripts/e2e-adapters.ts local github  # 특정 어댑터만
 *
 * 환경변수 (.env):
 *   GITHUB_TOKEN      — GitHub E2E (gh auth가 되어있으면 불필요)
 *   JIRA_API_TOKEN    — Jira E2E
 */
import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

import { GithubAdapter } from '../src/adapters/github-adapter.js';
import { JiraAdapter } from '../src/adapters/jira-adapter.js';
import { LocalAdapter } from '../src/adapters/local-adapter.js';
import { ObsidianAdapter } from '../src/adapters/obsidian-adapter.js';
import { IssueStatus } from '../src/core/issue-status.js';
import type { IssueAdapter } from '../src/adapters/types.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

interface TestResult {
  adapter: string;
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

const results: TestResult[] = [];

function log(adapter: string, name: string, status: 'PASS' | 'FAIL', detail: string) {
  results.push({ adapter, name, status, detail });
  const icon = status === 'PASS' ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${icon} ${name}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Shared E2E test runner
// ---------------------------------------------------------------------------

async function runAdapterE2E(
  adapterName: string,
  adapter: IssueAdapter,
  cleanup?: () => Promise<void>,
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${adapterName} E2E`);
  console.log(`${'='.repeat(60)}`);

  const createdIds: string[] = [];

  try {
    // ── create ──
    console.log('\n--- CRUD ---');
    // 이슈 생성 후 반환값의 id, number 필드 검증
    let issue;
    try {
      issue = await adapter.create({
        title: `[E2E] 테스트 이슈 — ${adapterName}`,
        body: `자동 생성됨 (${new Date().toISOString()})`,
      });
      createdIds.push(issue.id);
      log(adapterName, 'create', 'PASS', `id=${issue.id}, number=${issue.number}`);
    } catch (e) {
      log(adapterName, 'create', 'FAIL', String(e));
      return;
    }

    const ref = issue.id;

    // 생성한 이슈를 ID로 조회하여 제목과 상태가 올바른지 검증
    // ── get ──
    try {
      const fetched = await adapter.get(ref);
      const ok = fetched.title.includes('[E2E]') && fetched.state === 'open';
      log(adapterName, 'get', ok ? 'PASS' : 'FAIL', `title="${fetched.title}", state=${fetched.state}`);
    } catch (e) {
      log(adapterName, 'get', 'FAIL', String(e));
    }

    // open 상태 이슈 목록에서 생성한 이슈가 포함되는지 검증
    // ── list ──
    try {
      const all = await adapter.list({ state: 'open' });
      const found = all.some((i) => i.id === ref);
      log(adapterName, 'list(open)', found ? 'PASS' : 'FAIL', `${all.length}개 중 ${found ? '찾음' : '못찾음'}`);
    } catch (e) {
      log(adapterName, 'list', 'FAIL', String(e));
    }

    // 이슈 제목 수정 후 변경사항이 반영되었는지 검증
    // ── update ──
    try {
      const updated = await adapter.update(ref, { title: `[E2E] 수정됨 — ${adapterName}` });
      const ok = updated.title.includes('수정됨');
      log(adapterName, 'update', ok ? 'PASS' : 'FAIL', `title="${updated.title}"`);
    } catch (e) {
      log(adapterName, 'update', 'FAIL', String(e));
    }

    // 라벨 추가 후 이슈의 labels 배열에 포함되는지 검증
    // ── addLabel ──
    try {
      await adapter.addLabel(ref, 'e2e-test');
      const fetched = await adapter.get(ref);
      const ok = fetched.labels.includes('e2e-test');
      log(adapterName, 'addLabel', ok ? 'PASS' : 'FAIL', `labels=${JSON.stringify(fetched.labels)}`);
    } catch (e) {
      log(adapterName, 'addLabel', 'FAIL', String(e));
    }

    // 라벨 제거 후 이슈의 labels 배열에서 사라졌는지 검증
    // ── removeLabel ──
    try {
      await adapter.removeLabel(ref, 'e2e-test');
      const fetched = await adapter.get(ref);
      const ok = !fetched.labels.includes('e2e-test');
      log(adapterName, 'removeLabel', ok ? 'PASS' : 'FAIL', `labels=${JSON.stringify(fetched.labels)}`);
    } catch (e) {
      log(adapterName, 'removeLabel', 'FAIL', String(e));
    }

    // ── Status semantics ──
    console.log('\n--- Status ---');

    // open 상태 + 라벨 없음 → Pending(todo)으로 파생되는지 검증
    try {
      const fetched = await adapter.get(ref);
      const status = adapter.deriveStatus(fetched);
      const ok = status === IssueStatus.Pending;
      log(adapterName, 'deriveStatus(open)', ok ? 'PASS' : 'FAIL', `status=${status}`);
    } catch (e) {
      log(adapterName, 'deriveStatus(open)', 'FAIL', String(e));
    }

    // setStatus로 in-progress 설정 후 deriveStatus가 동일하게 반환하는지 검증
    try {
      await adapter.setStatus(ref, IssueStatus.InProgress);
      const fetched = await adapter.get(ref);
      const status = adapter.deriveStatus(fetched);
      const ok = status === IssueStatus.InProgress;
      log(adapterName, 'setStatus(in-progress)', ok ? 'PASS' : 'FAIL', `derived=${status}`);
    } catch (e) {
      log(adapterName, 'setStatus(in-progress)', 'FAIL', String(e));
    }

    // 상태를 reviewing으로 전환 시 이전 라벨이 제거되고 새 상태가 반영되는지 검증
    try {
      await adapter.setStatus(ref, IssueStatus.InReview);
      const fetched = await adapter.get(ref);
      const status = adapter.deriveStatus(fetched);
      const ok = status === IssueStatus.InReview;
      log(adapterName, 'setStatus(reviewing)', ok ? 'PASS' : 'FAIL', `derived=${status}`);
    } catch (e) {
      log(adapterName, 'setStatus(reviewing)', 'FAIL', String(e));
    }

    // 특정 상태의 이슈만 필터링하여 목록 조회가 되는지 검증
    try {
      const infos = await adapter.listByStatus([IssueStatus.InReview]);
      const found = infos.some((i) => i.number === issue.number);
      log(adapterName, 'listByStatus', found ? 'PASS' : 'FAIL', `${infos.length}개 중 ${found ? '찾음' : '못찾음'}`);
    } catch (e) {
      log(adapterName, 'listByStatus', 'FAIL', String(e));
    }

    // todo/done 상태로의 직접 전환이 거부(에러)되는지 검증
    try {
      await adapter.setStatus(ref, IssueStatus.Pending);
      log(adapterName, 'setStatus(todo) guard', 'FAIL', '에러 안남');
    } catch {
      log(adapterName, 'setStatus(todo) guard', 'PASS', '거부됨');
    }

    // 이슈 닫기 후 state가 closed로 변경되는지 검증
    // ── close ──
    console.log('\n--- Close ---');
    try {
      await adapter.close(ref);
      const fetched = await adapter.get(ref);
      const ok = fetched.state === 'closed';
      log(adapterName, 'close', ok ? 'PASS' : 'FAIL', `state=${fetched.state}`);
    } catch (e) {
      log(adapterName, 'close', 'FAIL', String(e));
    }

    // closed 상태의 이슈가 Completed(done)로 파생되는지 검증
    try {
      const fetched = await adapter.get(ref);
      const status = adapter.deriveStatus(fetched);
      const ok = status === IssueStatus.Completed;
      log(adapterName, 'deriveStatus(closed)', ok ? 'PASS' : 'FAIL', `status=${status}`);
    } catch (e) {
      log(adapterName, 'deriveStatus(closed)', 'FAIL', String(e));
    }

    // 존재하지 않는 이슈 조회 시 에러가 발생하는지 검증
    // ── error handling ──
    console.log('\n--- Error ---');
    try {
      await adapter.get('NONEXISTENT-99999');
      log(adapterName, 'get(not found)', 'FAIL', '에러 안남');
    } catch {
      log(adapterName, 'get(not found)', 'PASS', '에러 발생 (정상)');
    }
  } finally {
    if (cleanup) {
      try {
        await cleanup();
        console.log(`\n  [cleanup] 정리 완료`);
      } catch (e) {
        console.log(`\n  [cleanup] 정리 실패: ${e}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Adapter factories
// ---------------------------------------------------------------------------

async function runLocal() {
  const tmpDir = path.join(os.tmpdir(), `agent-hive-e2e-local-${Date.now()}`);
  const adapter = new LocalAdapter(undefined, tmpDir);
  await runAdapterE2E('Local', adapter, async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });
}

async function runObsidian() {
  const tmpDir = path.join(os.tmpdir(), `agent-hive-e2e-obsidian-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const adapter = new ObsidianAdapter({ vaultPath: tmpDir });
  await runAdapterE2E('Obsidian', adapter, async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });
}

async function runGithub() {
  // 현재 레포 사용 — 테스트 이슈 생성 후 close로 정리
  const { execFileSync } = await import('node:child_process');
  let repo: string;
  try {
    repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
  } catch {
    repo = process.env.GITHUB_REPO ?? 'Ryokuman/agent-hive';
  }

  console.log(`\n  [setup] GitHub 레포 사용: ${repo} (이슈 생성 후 close로 정리)`);

  // E2E에 필요한 라벨들을 미리 생성 (이미 있으면 무시)
  const requiredLabels = ['e2e-test', 'in-progress', 'in-review', 'awaiting-merge'];
  for (const label of requiredLabels) {
    try {
      execFileSync('gh', ['label', 'create', label, '--repo', repo, '--force'], {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    } catch {
      // 이미 존재하면 무시
    }
  }

  const adapter = new GithubAdapter({ repo });

  await runAdapterE2E('GitHub', adapter);
  // 이슈는 close()로 닫히므로 별도 정리 불필요
}

async function runJira() {
  // 한국어 Jira 인스턴스 — 상태 이름이 한국어이므로 매핑 오버라이드
  const adapter = new JiraAdapter(
    {
      host: 'https://ryokuman21.atlassian.net',
      projectKey: 'WK',
      email: 'ryokuman21@gmail.com',
    },
    {
      'in-progress': '진행 중',
      reviewing: '검토 중',
      'waiting-merge': '완료',
    },
  );
  await runAdapterE2E('Jira', adapter);
  // Jira는 이슈를 close()로 닫으므로 별도 정리 불필요
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ADAPTERS: Record<string, () => Promise<void>> = {
  local: runLocal,
  obsidian: runObsidian,
  github: runGithub,
  jira: runJira,
};

async function main() {
  const args = process.argv.slice(2);
  const selected = args.length > 0 ? args : Object.keys(ADAPTERS);

  for (const name of selected) {
    const runner = ADAPTERS[name];
    if (!runner) {
      console.log(`알 수 없는 어댑터: ${name} (가능: ${Object.keys(ADAPTERS).join(', ')})`);
      continue;
    }
    try {
      await runner();
    } catch (e) {
      console.log(`\n  [ERROR] ${name} E2E 실패: ${e}`);
    }
  }

  // ── Summary ──
  console.log(`\n${'='.repeat(60)}`);
  console.log('  E2E 결과 요약');
  console.log(`${'='.repeat(60)}\n`);

  const byAdapter = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!byAdapter.has(r.adapter)) byAdapter.set(r.adapter, []);
    byAdapter.get(r.adapter)!.push(r);
  }

  let totalPass = 0;
  let totalFail = 0;

  for (const [adapter, tests] of byAdapter) {
    const pass = tests.filter((t) => t.status === 'PASS').length;
    const fail = tests.filter((t) => t.status === 'FAIL').length;
    totalPass += pass;
    totalFail += fail;
    const icon = fail === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${icon} ${adapter}: ${pass}/${tests.length} passed`);

    if (fail > 0) {
      for (const t of tests.filter((t) => t.status === 'FAIL')) {
        console.log(`    \x1b[31m- ${t.name}: ${t.detail}\x1b[0m`);
      }
    }
  }

  console.log(`\n  Total: ${totalPass}/${totalPass + totalFail} passed\n`);

  if (totalFail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('E2E 실행 실패:', e);
  process.exit(1);
});
