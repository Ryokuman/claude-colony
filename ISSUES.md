# 미해결 이슈 목록

> `task-workflow-audit.md`와 `platform-abstraction-audit.md` 감사에서 추출한 미해결 이슈 통합.

---

## 심각도: 중간

| # | 제목 | 문제 유형 | 출처 |
|---|------|-----------|------|
| 1 | DEFAULT_STATUS_MAPPINGS가 issue-status.ts에 하드코딩 | 추상화 부족 | platform-abstraction-audit |
| 2 | ObsidianAdapter SRP 위반 (이슈 CRUD + 세션 로깅 혼재) | 책임 혼재 | platform-abstraction-audit |
| 3 | worktree.ts가 ObsidianAdapter 직접 참조 (팩토리 우회) | 시맨틱 누출 | platform-abstraction-audit |

### #1: DEFAULT_STATUS_MAPPINGS 위치

`types.ts`에서 `issue-status.ts`로 이동했지만, 이상적으로는 각 어댑터가 자기 기본 매핑을 내부에 갖는 게 맞음. 현재는 어댑터 생성자가 `issue-status.ts`의 `DEFAULT_STATUS_MAPPINGS`를 import해서 사용.

### #2, #3: ObsidianAdapter SRP + worktree 팩토리 우회

`ObsidianAdapter`가 `IssueAdapter` + 볼트/세션 로깅을 모두 담당. `worktree.ts`가 `new ObsidianAdapter()`를 직접 생성하여 팩토리 우회. 이슈 CRUD와 세션 로깅을 분리해야 함.

---

## 심각도: 낮음

| # | 제목 | 문제 유형 | 출처 |
|---|------|-----------|------|
| 4 | resolveStatusMapping()이 아직 코어에 존재 | 책임 역전 (부분) | platform-abstraction-audit |
| 5 | Issue.platformStatus 옵셔널 필드가 공통 인터페이스에 잔존 | 추상화 부족 (부분) | platform-abstraction-audit |
| 6 | IssueStatus 상수의 네이밍 혼란 (이슈 상태 vs 태스크 워크플로우) | 네이밍 혼란 | task-workflow-audit |
| 7 | STATUS_ICONS에 todo/done 아이콘 존재 | 네이밍 혼란 / 죽은 코드 | task-workflow-audit |
| 8 | worker.md/reviewer.md 라벨 이름 하드코딩 | 네이밍 혼란 | task-workflow-audit |

### #4: resolveStatusMapping() 코어 잔존

함수 시그니처에서 `adapterConfig` 전체 대신 `adapter`만 받도록 개선됨. 하지만 매핑 해석 로직 자체는 아직 코어에 존재.

### #5: Issue.platformStatus 잔존

`deriveStatus()`가 어댑터로 이동했으므로 코어는 이 필드를 직접 참조하지 않음. 하지만 `Issue` 인터페이스에 Jira 전용 필드가 남아있는 상태.

### #6: IssueStatus 네이밍 혼란

`IssueStatus`라는 이름이 "이슈 상태"를 의미하지만, 실제로는 "태스크 워크플로우 단계 + state 파생값" 혼합. 파일명(`issue-status.ts`), 함수명(`setIssueStatus`) 전부 동일한 혼란.

### #7: STATUS_ICONS todo/done

`src/commands/status.ts`의 `STATUS_ICONS`에 `todo: '○'`, `done: '✓'`가 있지만, `listByStatus()`는 transition 상태만 반환하므로 `todo` 아이콘은 사실상 미사용. `done`은 개별 이슈 조회 시만 사용.

### #8: 프롬프트 라벨 하드코딩

`worker.md`/`reviewer.md`에 `in-progress`, `in-review`, `awaiting-merge` 라벨이 하드코딩. 유저가 `statusMapping`을 커스터마이즈하면 프롬프트와 실제 매핑이 불일치.
