# Test List — 105 tests

## Config (8) → `src/config.ts`

- config 파일 정상 로드 + 기본값 적용됨
- 필수 필드 없으면 에러남
- 어댑터별 설정 강제 적용됨

## 이슈 상태 (24) → `src/core/issue-status.ts`

- 어댑터별 기본 매핑 돌아옴
- 유저 오버라이드 병합됨, 중복이면 에러남
- Jira: platformStatus로 상태 파생됨 (case-insensitive)
- GitHub/Local/Obsidian: 라벨로 상태 파생됨
- closed → done, 라벨 없음 → todo
- todo/done 직접 설정 거부됨

## Worktree 파싱 (3) → `src/core/worktree.ts`

- porcelain 출력 파싱해서 path/branch/head 나옴
- branch 없는 엔트리는 무시됨

## Notion (20) → `src/adapters/notion-adapter.ts`

- CRUD 다 됨 (생성/조회/수정/닫기/라벨)
- 상태 파생/설정 됨, todo/done 직접설정 거부
- DB에서 dataSourceId 자동 탐색됨
- setup 시 빠진 프로퍼티 자동 추가됨 (idempotent)

## Local (15) → `src/adapters/local-adapter.ts`

- CRUD + 상태 + 라벨 다 됨 (contract suite 공유)
- JSON 파일 영속됨, 이슈 번호 자동 증가

## Obsidian (35) → `src/adapters/obsidian-adapter.ts`

- CRUD 다 됨 (마크다운 파일 기반)
- vault 초기화됨 (디렉토리 + CLAUDE.md, 기존건 안 덮어씀)
- 세션 로깅됨 (Decision/SSoT/Blocker 엔트리)
- 스펙 동기화됨
- 상태 전환 시 이전 라벨 제거됨, 커스텀 매핑 가능

## 미테스트

- github/jira 어댑터 — 외부 의존
- worktree 생성/제거 — 실제 git 필요
- CLI 커맨드들 — 통합 테스트 대상
- session-spawner — 프로세스 스폰
