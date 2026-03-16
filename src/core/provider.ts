import { spawn, type ChildProcess } from 'node:child_process';

import { ConfigError } from './errors.js';
import { logger } from './logger.js';

export const ProviderType = {
  Claude: 'claude',
  Codex: 'codex',
} as const;
export type ProviderType = (typeof ProviderType)[keyof typeof ProviderType];

export interface Provider {
  name: ProviderType;
  supportsAgentTeams: boolean;
  spawnSession(prompt: string, cwd: string): ChildProcess;
}

function createClaudeProvider(): Provider {
  return {
    name: ProviderType.Claude,
    supportsAgentTeams: true,
    spawnSession(prompt: string, cwd: string): ChildProcess {
      logger.info('[Claude] Spawning lead session with Agent Teams...');
      return spawn('claude', ['-p', prompt], {
        cwd,
        stdio: 'inherit',
        env: {
          ...process.env,
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        },
      });
    },
  };
}

function createCodexProvider(): Provider {
  return {
    name: ProviderType.Codex,
    supportsAgentTeams: false,
    spawnSession(prompt: string, cwd: string): ChildProcess {
      logger.info('[Codex] Spawning session...');
      return spawn('codex', ['exec', '--full-auto', prompt], {
        cwd,
        stdio: 'inherit',
        env: { ...process.env },
      });
    },
  };
}

export function createProvider(type: ProviderType): Provider {
  if (type === ProviderType.Claude) return createClaudeProvider();
  if (type === ProviderType.Codex) return createCodexProvider();
  throw new ConfigError(`Unknown provider: ${type}`);
}
