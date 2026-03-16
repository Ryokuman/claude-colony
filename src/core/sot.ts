import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ColonyConfig } from '../config.js';
import { ColonyError } from './errors.js';
import * as sessionLog from '../obsidian/session-log.js';

export interface SotProvider {
  name: string;
  writeSessionLog(sessionId: string, content: string): Promise<void>;
  readConventions(): Promise<string | null>;
}

function createObsidianSotProvider(config: ColonyConfig): SotProvider {
  const vaultPath = config.sot?.vaultPath ?? config.obsidian?.vaultPath;

  if (!vaultPath) {
    throw new ColonyError(
      'Obsidian SSoT requires a vaultPath in sot or obsidian config',
      'CONFIG_ERROR',
    );
  }

  return {
    name: 'obsidian',

    async writeSessionLog(sessionId: string, content: string): Promise<void> {
      const logPath = await sessionLog.createLog(config, {
        role: 'worker',
        branch: sessionId,
      });
      await sessionLog.append(logPath, content);
    },

    async readConventions(): Promise<string | null> {
      const claudeMdPath = path.join(vaultPath, 'context', 'CLAUDE.md');
      try {
        return await readFile(claudeMdPath, 'utf-8');
      } catch {
        return null;
      }
    },
  };
}

function createNotionSotProvider(_config: ColonyConfig): SotProvider {
  return {
    name: 'notion',

    async writeSessionLog(_sessionId: string, _content: string): Promise<void> {
      throw new ColonyError(
        'Notion SSoT provider not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },

    async readConventions(): Promise<string | null> {
      throw new ColonyError(
        'Notion SSoT provider not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },
  };
}

function createJiraSotProvider(_config: ColonyConfig): SotProvider {
  return {
    name: 'jira',

    async writeSessionLog(_sessionId: string, _content: string): Promise<void> {
      throw new ColonyError(
        'Jira SSoT provider not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },

    async readConventions(): Promise<string | null> {
      throw new ColonyError(
        'Jira SSoT provider not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },
  };
}

export function createSotProvider(config: ColonyConfig): SotProvider | null {
  const type = config.sot?.type ?? (config.obsidian ? 'obsidian' : undefined);

  if (!type) return null;

  if (type === 'obsidian') return createObsidianSotProvider(config);
  if (type === 'notion') return createNotionSotProvider(config);
  if (type === 'jira') return createJiraSotProvider(config);

  throw new ColonyError(`Unknown SSoT provider type: ${type}`, 'CONFIG_ERROR');
}
