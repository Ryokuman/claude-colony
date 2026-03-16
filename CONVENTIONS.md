# agent-hive 코드 컨벤션

## 1. 언어 및 런타임

- **TypeScript strict mode** 사용 (`"strict": true`)
- Node.js ES Modules (`"type": "module"` in package.json)
- 타겟: ES2022

## 2. 포맷팅

Prettier로 자동 포맷팅. 수동 조정 금지.

| 규칙 | 값 |
|------|-----|
| 세미콜론 | 사용 (`semi: true`) |
| 따옴표 | 싱글쿼트 (`singleQuote: true`) |
| trailing comma | 모두 (`trailingComma: "all"`) |
| 줄 길이 | 100자 |
| 들여쓰기 | 스페이스 2칸 |
| 줄 끝 | LF |
| 화살표 함수 괄호 | 항상 (`arrowParens: "always"`) |

## 3. 네이밍

| 대상 | 규칙 | 예시 |
|------|------|------|
| 파일/디렉토리 | kebab-case | `session-spawner.ts`, `file-watcher.ts` |
| 변수/함수 | camelCase | `spawnWorker()`, `prNumber` |
| 클래스/인터페이스/타입 | PascalCase | `HiveConfig`, `SessionType` |
| 상수 | UPPER_SNAKE_CASE | `DEFAULT_WEBHOOK_PORT` |
| enum 멤버 | PascalCase | `SessionType.Worker` |
| private 멤버 | camelCase (접두사 `_` 금지) | `this.config` |

## 4. 타입

- `any` 사용 금지. 불가피한 경우 `unknown` + 타입 가드 사용
- 함수 반환 타입 명시적 선언
- 인터페이스 vs 타입:
  - 객체 형태 정의 → `interface`
  - 유니온/유틸리티 타입 → `type`
- `enum` 대신 `as const` 객체 사용 권장

```typescript
// Good
const SessionType = {
  Worker: 'worker',
  Reviewer: 'reviewer',
} as const;
type SessionType = (typeof SessionType)[keyof typeof SessionType];

// Avoid
enum SessionType {
  Worker = 'worker',
  Reviewer = 'reviewer',
}
```

## 5. 함수

- 한 함수는 하나의 책임만 갖는다
- 함수 길이: 40줄 이하 권장, 초과 시 분리 검토
- 순수 함수 우선. 부수 효과는 명확히 분리
- early return 패턴 사용

```typescript
// Good
function getSession(id: string): Session | null {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expired) return null;
  return session;
}

// Avoid
function getSession(id: string): Session | null {
  const session = sessions.get(id);
  if (session) {
    if (!session.expired) {
      return session;
    } else {
      return null;
    }
  } else {
    return null;
  }
}
```

## 6. 에러 처리

- 에러는 호출자가 처리할 수 있도록 throw
- 시스템 바운더리(외부 API, 파일 I/O, 프로세스 실행)에서만 try-catch
- 커스텀 에러 클래스는 `HiveError`를 기반으로 확장
- 에러 메시지는 무엇이 실패했는지 + 왜 실패했는지 포함

```typescript
class HiveError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'HiveError';
  }
}
```

## 7. 임포트 순서

1. Node.js 내장 모듈 (`node:fs`, `node:path`)
2. 외부 패키지 (`express`, `chokidar`)
3. 내부 모듈 (`./config`, `../core/session-spawner`)

그룹 간 빈 줄로 구분.

```typescript
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import express from 'express';
import chokidar from 'chokidar';

import { loadConfig } from './config.js';
import { spawnWorker } from '../core/session-spawner.js';
```

## 8. 모듈 구조

- 각 모듈은 단일 책임
- 모듈 진입점에서 public API만 export
- 내부 헬퍼는 export하지 않음
- 순환 의존 금지

## 9. 비동기 처리

- callback 금지, `async/await` 사용
- 병렬 실행 가능한 작업은 `Promise.all()` 사용
- fire-and-forget은 `.catch()` 필수

```typescript
// Good
const [config, vault] = await Promise.all([loadConfig(), initVault()]);

// fire-and-forget
logEvent(event).catch((err) => console.error('Failed to log event:', err));
```

## 10. 로깅

- `console.log` 대신 구조화된 로거 사용 (추후 도입)
- 로그 레벨: `debug`, `info`, `warn`, `error`
- 민감 정보(토큰, 시크릿) 로그 출력 금지

## 11. 테스트

- 테스트 프레임워크: vitest
- 테스트 파일: `src/**/*.test.ts` (소스 파일과 동일 디렉토리)
- 네이밍: `describe('모듈명')` → `it('동작 설명')`
- 외부 의존성(GitHub API, 파일시스템)은 mock/stub
- 커버리지 목표: 핵심 로직 80% 이상

## 12. Git 컨벤션

### 브랜치 네이밍
```
feat/{feature-name}
fix/{bug-description}
refactor/{scope}
docs/{topic}
```

### 커밋 메시지
[Conventional Commits](https://www.conventionalcommits.org/) 따름.

```
feat: 워커 세션 스폰 기능 추가
fix: webhook 시크릿 검증 누락 수정
refactor(config): 설정 로드 로직 분리
docs: CONVENTIONS.md 작성
```

### PR
- 제목: 커밋 메시지와 동일한 형식
- 본문: 변경 사항 요약 + 관련 Issue 번호 (`closes #N`)
