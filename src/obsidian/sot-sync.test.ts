import { describe, it, expect } from 'vitest';

import { extractSotCandidates } from './sot-sync.js';

describe('sot-sync', () => {
  describe('extractSotCandidates', () => {
    it('should extract [SSoT] tagged lines', () => {
      const content = [
        '- `10:30:00` **[note]** 일반 메모',
        '- `10:31:00` **[SSoT]** 중요한 아키텍처 결정',
        '- `10:32:00` **[note]** 또 다른 메모',
      ].join('\n');

      const candidates = extractSotCandidates(content);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toContain('중요한 아키텍처 결정');
    });

    it('should extract [DECISION] tagged lines', () => {
      const content = [
        '- `10:30:00` **[DECISION]** ESM 모듈 시스템 사용 결정',
        '- `10:31:00` **[note]** 일반 메모',
      ].join('\n');

      const candidates = extractSotCandidates(content);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toContain('ESM 모듈 시스템 사용 결정');
    });

    it('should extract both SSoT and DECISION tags', () => {
      const content = [
        '- `10:30:00` **[SSoT]** 첫 번째 항목',
        '- `10:31:00` **[DECISION]** 두 번째 항목',
        '- `10:32:00` **[note]** 무시할 항목',
      ].join('\n');

      const candidates = extractSotCandidates(content);

      expect(candidates).toHaveLength(2);
    });

    it('should return empty array when no candidates', () => {
      const content = '- `10:30:00` **[note]** 일반 메모\n';

      const candidates = extractSotCandidates(content);

      expect(candidates).toHaveLength(0);
    });
  });
});
