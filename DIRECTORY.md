# Directory Structure

```
agent-hive/
├── .editorconfig                 # 에디터 설정
├── .env                          # 환경변수 (gitignore)
├── .env.example                  # 환경변수 예시
├── .gitignore
├── .prettierrc                   # Prettier 설정
├── .prettierignore
├── ah.config.json                # agent-hive 프로젝트 설정
├── package.json                  # 패키지 정의
├── tsconfig.json                 # TypeScript 설정
├── vitest.config.ts              # Vitest 테스트 설정
│
├── tests/                        # 전체 테스트
│   ├── unit/                     # 단위 테스트 (vitest, mock 기반)
│   │   ├── config.test.ts                    # config 로드/검증 (8)
│   │   ├── adapters/
│   │   │   ├── adapter-contract.ts           # 공유 contract test suite
│   │   │   ├── notion-adapter.test.ts        # Notion mock 테스트 (20)
│   │   │   ├── local-adapter.test.ts         # Local 테스트 (15)
│   │   │   └── obsidian-adapter.test.ts      # Obsidian 테스트 (35)
│   │   └── core/
│   │       ├── issue-status.test.ts          # 이슈 상태 관리 (24)
│   │       └── worktree.test.ts              # worktree 파싱 (3)
│   └── e2e/                      # E2E 테스트 (실제 API, 수동 실행)
│       ├── e2e-adapters.ts                   # 어댑터 통합 테스트
│       └── e2e-notion.ts                     # Notion API 통합 테스트
│
└── src/                          # 소스 코드
    ├── cli.ts                    # CLI 진입점 (커맨드 라우팅)
    ├── config.ts                 # ah.config.json 로드/검증
    │
    ├── adapters/                 # 이슈 소스 어댑터 (플러그인 패턴)
    │   ├── types.ts              # Issue, IssueAdapter 인터페이스, AdapterConfig
    │   ├── adapter-factory.ts    # createAdapter() 팩토리
    │   ├── github-adapter.ts     # GitHub Issues + PR (gh CLI 래퍼)
    │   ├── jira-adapter.ts       # Jira REST API
    │   ├── notion-adapter.ts     # Notion API (2025-09-03)
    │   ├── local-adapter.ts      # 로컬 JSON 파일 이슈 관리
    │   └── obsidian-adapter.ts   # Obsidian 마크다운 이슈
    │
    ├── commands/                 # CLI 커맨드 핸들러
    │   ├── init.ts               # agent-hive init (프로젝트 초기화)
    │   ├── meet.ts               # agent-hive meet (PM 미팅 세션)
    │   ├── worktree.ts           # agent-hive worktree (create/list/clean)
    │   ├── status.ts             # agent-hive status (이슈 상태 표시)
    │   ├── issue.ts              # agent-hive issue (CRUD via 어댑터)
    │   └── pr.ts                 # agent-hive pr (GitHub PR 관리)
    │
    ├── core/                     # 핵심 로직
    │   ├── errors.ts             # 커스텀 에러 타입 (ColonyError, ConfigError, ...)
    │   ├── logger.ts             # 구조화 로깅
    │   ├── provider.ts           # AI 프로바이더 추상화 (claude/codex)
    │   ├── session-spawner.ts    # Claude/Codex 세션 스폰 + 프롬프트 유틸
    │   ├── worktree.ts           # git worktree API 래퍼
    │   ├── issue-source.ts       # 어댑터 → 이슈 소스 래퍼
    │   └── issue-status.ts       # 이슈 상태 관리 (StatusMapping, derive/set)
    │
    └── prompts/                  # AI 세션 프롬프트 템플릿
        ├── lead.md               # 리드 세션 (worktree create 시)
        ├── meet.md               # PM 미팅 세션 (meet 시)
        ├── worker.md             # 워커 규칙
        └── reviewer.md           # 리뷰어 규칙
```

## 파일 수 요약

| 카테고리 | 파일 수 |
|----------|---------|
| 소스 코드 (src/) | 20 |
| 단위 테스트 (tests/unit/) | 7 |
| E2E 테스트 (tests/e2e/) | 2 |
| 프롬프트 (prompts/) | 4 |
| 설정 | 7 |
| **합계** | **40** |
