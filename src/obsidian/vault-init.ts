import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

import type { ColonyConfig } from '../config.js';

const VAULT_DIRS = ['spec', 'context', 'sessions'] as const;

const DEFAULT_CLAUDE_MD = `# 프로젝트 컨벤션 및 패턴

> 이 문서는 SSoT (Single Source of Truth)입니다.
> 세션이 발견한 중요 결정사항이 여기에 승격됩니다.

---

## 코드 컨벤션

(프로젝트 초기화 후 자동으로 채워집니다)

## 아키텍처 결정사항

(세션 작업 중 중요 결정사항이 승격되면 여기에 추가됩니다)

## 반복 패턴

(세션이 발견한 반복 패턴이 여기에 기록됩니다)
`;

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function initVault(config: ColonyConfig): Promise<void> {
  if (!config.obsidian) return;

  const vaultPath = config.obsidian.vaultPath;

  for (const dir of VAULT_DIRS) {
    await mkdir(path.join(vaultPath, dir), { recursive: true });
  }

  const claudeMdPath = path.join(vaultPath, 'context', 'CLAUDE.md');
  if (!(await exists(claudeMdPath))) {
    await writeFile(claudeMdPath, DEFAULT_CLAUDE_MD, 'utf-8');
  }
}
