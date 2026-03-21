import { describe, it, expect } from 'vitest';

import { parseWorktreeOutput } from '../../../src/core/worktree.js';

describe('worktree', () => {
  describe('parseWorktreeOutput', () => {
    it('should parse porcelain output correctly', () => {
      const output = [
        'worktree /repo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /repo/../worktree-feat/auth',
        'HEAD def456',
        'branch refs/heads/feat/auth',
        '',
        'worktree /repo/../worktree-fix/bug',
        'HEAD ghi789',
        'branch refs/heads/fix/bug',
        '',
      ].join('\n');

      const result = parseWorktreeOutput(output);

      expect(result).toHaveLength(3);
      expect(result[0].branch).toBe('main');
      expect(result[1].branch).toBe('feat/auth');
      expect(result[2].branch).toBe('fix/bug');
    });

    it('should return single entry for main-only worktree', () => {
      const output = ['worktree /repo', 'HEAD abc123', 'branch refs/heads/main', ''].join('\n');

      const result = parseWorktreeOutput(output);
      expect(result).toHaveLength(1);
      expect(result[0].branch).toBe('main');
    });

    it('should handle missing fields gracefully', () => {
      const output = [
        'worktree /repo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /repo/../wt',
        'HEAD def456',
        '', // missing branch
      ].join('\n');

      const result = parseWorktreeOutput(output);
      expect(result).toHaveLength(1); // only the main entry
    });
  });
});
