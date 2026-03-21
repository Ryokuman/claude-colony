/**
 * Shared contract test suite for IssueAdapter implementations.
 *
 * Usage:
 *   import { runAdapterContractTests } from './adapter-contract.js';
 *   runAdapterContractTests('LocalAdapter', async () => ({
 *     adapter: new LocalAdapter(...),
 *     teardown: async () => { ... },
 *   }));
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { IssueStatus, TRANSITION_STATUSES } from '../../../src/core/issue-status.js';
import type { IssueAdapter } from '../../../src/adapters/types.js';

export interface AdapterTestContext {
  adapter: IssueAdapter;
  teardown: () => Promise<void>;
}

export function runAdapterContractTests(
  name: string,
  factory: () => Promise<AdapterTestContext>,
) {
  describe(`${name} — IssueAdapter contract`, () => {
    let adapter: IssueAdapter;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      ({ adapter, teardown } = await factory());
    });

    afterEach(async () => {
      await teardown();
    });

    // ── CRUD ──────────────────────────────────────────────────────────────

    // 이슈 생성 후 동일 ID로 조회하여 필드가 일치하는지 검증
    it('create → get round-trip', async () => {
      const created = await adapter.create({ title: 'Test issue', body: 'Test body' });

      expect(created.title).toBe('Test issue');
      expect(created.body).toBe('Test body');
      expect(created.state).toBe('open');
      expect(created.number).toBeGreaterThan(0);

      const fetched = await adapter.get(String(created.number));
      expect(fetched.title).toBe('Test issue');
      expect(fetched.number).toBe(created.number);
    });

    // 생성한 이슈들이 목록 조회 결과에 모두 포함되는지 검증
    it('list returns created issues', async () => {
      await adapter.create({ title: 'First', body: '' });
      await adapter.create({ title: 'Second', body: '' });

      const all = await adapter.list();
      expect(all.length).toBeGreaterThanOrEqual(2);

      const titles = all.map((i) => i.title);
      expect(titles).toContain('First');
      expect(titles).toContain('Second');
    });

    // open/closed 상태 필터링이 올바르게 동작하는지 검증
    it('list filters by state', async () => {
      const issue = await adapter.create({ title: 'To filter', body: '' });
      await adapter.close(String(issue.number));

      const open = await adapter.list({ state: 'open' });
      expect(open.find((i) => i.number === issue.number)).toBeUndefined();

      const closed = await adapter.list({ state: 'closed' });
      expect(closed.find((i) => i.number === issue.number)).toBeDefined();
    });

    // 이슈 제목 수정 후 변경사항이 반영되었는지 검증
    it('update modifies fields', async () => {
      const created = await adapter.create({ title: 'Original', body: 'original body' });
      const ref = String(created.number);

      const updated = await adapter.update(ref, { title: 'Updated' });
      expect(updated.title).toBe('Updated');

      const fetched = await adapter.get(ref);
      expect(fetched.title).toBe('Updated');
    });

    // 이슈 닫기 후 state가 closed로 변경되는지 검증
    it('close sets state to closed', async () => {
      const created = await adapter.create({ title: 'To close', body: '' });
      const ref = String(created.number);

      await adapter.close(ref);
      const fetched = await adapter.get(ref);
      expect(fetched.state).toBe('closed');
    });

    // 라벨 추가/제거가 정상적으로 동작하는지 검증
    it('addLabel and removeLabel', async () => {
      const created = await adapter.create({ title: 'Labeled', body: '' });
      const ref = String(created.number);

      await adapter.addLabel(ref, 'bug');
      await adapter.addLabel(ref, 'urgent');
      let fetched = await adapter.get(ref);
      expect(fetched.labels).toContain('bug');
      expect(fetched.labels).toContain('urgent');

      await adapter.removeLabel(ref, 'bug');
      fetched = await adapter.get(ref);
      expect(fetched.labels).not.toContain('bug');
      expect(fetched.labels).toContain('urgent');
    });

    // 존재하지 않는 이슈 조회 시 에러가 발생하는지 검증
    it('get throws for non-existent issue', async () => {
      await expect(adapter.get('99999')).rejects.toThrow();
    });

    // ── Status Semantics ──────────────────────────────────────────────────

    // open 상태 + 라벨 없음 → Pending(todo)으로 파생되는지 검증
    it('deriveStatus: open + no label → todo', async () => {
      const created = await adapter.create({ title: 'Fresh', body: '' });
      const status = adapter.deriveStatus(created);
      expect(status).toBe(IssueStatus.Pending);
    });

    // closed 상태의 이슈가 Completed(done)로 파생되는지 검증
    it('deriveStatus: closed → done', async () => {
      const created = await adapter.create({ title: 'Done', body: '' });
      const ref = String(created.number);
      await adapter.close(ref);

      const closed = await adapter.get(ref);
      const status = adapter.deriveStatus(closed);
      expect(status).toBe(IssueStatus.Completed);
    });

    // setStatus로 in-progress 설정 시 관리 라벨이 추가되는지 검증
    it('setStatus: in-progress adds managed label', async () => {
      const created = await adapter.create({ title: 'Working', body: '' });
      const ref = String(created.number);

      await adapter.setStatus(ref, IssueStatus.InProgress);

      const fetched = await adapter.get(ref);
      const status = adapter.deriveStatus(fetched);
      expect(status).toBe(IssueStatus.InProgress);
    });

    // todo/done 상태로의 직접 전환이 거부(에러)되는지 검증
    it('setStatus: todo/done → throws', async () => {
      const created = await adapter.create({ title: 'Guard', body: '' });
      const ref = String(created.number);

      await expect(adapter.setStatus(ref, IssueStatus.Pending)).rejects.toThrow();
      await expect(adapter.setStatus(ref, IssueStatus.Completed)).rejects.toThrow();
    });

    // 상태 전환 시 이전 관리 라벨이 제거되고 새 라벨만 남는지 검증
    it('setStatus: switching removes old managed label', async () => {
      const created = await adapter.create({ title: 'Switch', body: '' });
      const ref = String(created.number);

      await adapter.setStatus(ref, IssueStatus.InProgress);
      await adapter.setStatus(ref, IssueStatus.InReview);

      const fetched = await adapter.get(ref);
      const status = adapter.deriveStatus(fetched);
      expect(status).toBe(IssueStatus.InReview);
    });

    // 특정 상태의 이슈만 필터링하여 조회되는지 검증
    it('listByStatus filters correctly', async () => {
      const a = await adapter.create({ title: 'In Progress', body: '' });
      const b = await adapter.create({ title: 'Idle', body: '' });

      await adapter.setStatus(String(a.number), IssueStatus.InProgress);

      const results = await adapter.listByStatus(TRANSITION_STATUSES);
      const numbers = results.map((r) => r.number);

      expect(numbers).toContain(a.number);
      expect(numbers).not.toContain(b.number);
    });
  });
}
