import { describe, it, expect } from 'vitest';

// Test the porcelain output parsing logic extracted for testability
function parseWorktreeOutput(output: string): Array<{ path: string; branch: string; head: string }> {
  const entries: Array<{ path: string; branch: string; head: string }> = [];
  let current: { path?: string; branch?: string; head?: string } = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === '') {
      if (current.path && current.branch && current.head) {
        entries.push(current as { path: string; branch: string; head: string });
      }
      current = {};
    }
  }

  if (current.path && current.branch && current.head) {
    entries.push(current as { path: string; branch: string; head: string });
  }

  return entries.slice(1); // skip main worktree
}

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

      expect(result).toHaveLength(2);
      expect(result[0].branch).toBe('feat/auth');
      expect(result[1].branch).toBe('fix/bug');
    });

    it('should return empty for main-only worktree', () => {
      const output = [
        'worktree /repo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
      ].join('\n');

      const result = parseWorktreeOutput(output);
      expect(result).toHaveLength(0);
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
      expect(result).toHaveLength(0);
    });
  });
});
