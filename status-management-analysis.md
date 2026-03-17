# 이슈 상태 관리 분석서

> agent-hive가 플랫폼별로 이슈 상태를 어떻게 표현/관리하는지 종합 분석한다.
> 내부 상태 키 5개와 `TRANSITION_STATUSES` 3개의 불일치, 플랫폼별 차이점, 문제점을 다룬다.

---

## 1. 5가지 내부 상태 키

`src/core/issue-status.ts`에 `as const` 객체로 정의된 5개 상태:

| 내부 키 | 상수명 | 의미 |
|---------|--------|------|
| `todo` | `IssueStatus.Pending` | 작업 대기 — 아직 아무도 착수하지 않은 이슈 |
| `in-progress` | `IssueStatus.InProgress` | 작업 중 — Worker가 코딩 진행 중 |
| `reviewing` | `IssueStatus.InReview` | 리뷰 중 — PR이 생성되어 Reviewer가 검토 중 |
| `waiting-merge` | `IssueStatus.AwaitingMerge` | 머지 대기 — 리뷰 승인 완료, 유저의 최종 머지 대기 |
| `done` | `IssueStatus.Completed` | 완료 — 이슈가 닫힘 |

### 라이프사이클 흐름

```
todo → in-progress → reviewing → waiting-merge → done
```

---

## 2. 플랫폼별 상태 표현 방식

### 2.1 DEFAULT_STATUS_MAPPINGS 전체 비교

`src/adapters/types.ts`의 `DEFAULT_STATUS_MAPPINGS`:

| 내부 키 | GitHub | Jira | Obsidian | Local |
|---------|--------|------|----------|-------|
| `todo` | `pending` | `TODO` | `todo` | `todo` |
| `in-progress` | `in-progress` | `In Progress` | `in-progress` | `in-progress` |
| `reviewing` | `in-review` | `REVIEWING` | `reviewing` | `reviewing` |
| `waiting-merge` | `awaiting-merge` | `WAITING MERGE` | `waiting-merge` | `waiting-merge` |
| `done` | `completed` | `DONE` | `done` | `done` |

### 2.2 플랫폼별 상태 메커니즘

#### GitHub

| 항목 | 설명 |
|------|------|
| **상태 저장 메커니즘** | GitHub Issue의 **라벨(label)** |
| **todo 표현** | 라벨 없음 + issue가 `open` 상태 → `todo`로 추론 |
| **done 표현** | issue가 `closed` 상태 → `done`으로 추론 (라벨 불필요) |
| **중간 상태 표현** | `in-progress`, `in-review`, `awaiting-merge` 라벨을 issue에 부착 |
| **상태 전환 방식** | 기존 관리 라벨 제거 → 새 라벨 추가 (`gh issue edit --add-label/--remove-label`) |
| **open/closed 구분** | GitHub API의 네이티브 `state` 필드 사용 |

#### Jira

| 항목 | 설명 |
|------|------|
| **상태 저장 메커니즘** | Jira 네이티브 **워크플로우 전환(transition)** |
| **todo 표현** | Jira statusCategory가 `done`이 아니고 + 매핑된 상태 라벨이 없으면 → `todo` |
| **done 표현** | `statusCategory === 'done'` 또는 `status.name === 'done'` → `closed`로 매핑 → `done` |
| **중간 상태 표현** | `transitionTo()` 메서드로 Jira 워크플로우 상태 직접 전환 |
| **상태 전환 방식** | `/rest/api/3/issue/{key}/transitions` API로 transition ID 조회 후 POST |
| **open/closed 구분** | `statusCategory` 필드로 `done` 여부 판단 → `mapIssue()`에서 `open`/`closed`로 변환 |

#### Obsidian

| 항목 | 설명 |
|------|------|
| **상태 저장 메커니즘** | 마크다운 파일의 **YAML frontmatter** (`labels` 필드) |
| **todo 표현** | frontmatter에 매핑된 라벨이 없으면 → `todo` |
| **done 표현** | frontmatter의 `state: closed` → `done` |
| **중간 상태 표현** | `labels` 필드에 `in-progress`, `reviewing`, `waiting-merge` 값 저장 |
| **상태 전환 방식** | 기존 관리 라벨 제거 → 새 라벨 추가 (파일 다시 쓰기) |
| **open/closed 구분** | frontmatter `state` 필드 (`open`/`closed`) |

#### Local (JSON)

| 항목 | 설명 |
|------|------|
| **상태 저장 메커니즘** | JSON 파일의 `labels` 배열 |
| **todo 표현** | `labels`에 매핑된 상태 라벨이 없으면 → `todo` |
| **done 표현** | JSON의 `state: "closed"` → `done` |
| **중간 상태 표현** | `labels` 배열에 `in-progress`, `reviewing`, `waiting-merge` 값 저장 |
| **상태 전환 방식** | 기존 관리 라벨 제거 → 새 라벨 추가 (JSON 파일 다시 쓰기) |
| **open/closed 구분** | `state` 필드 (`open`/`closed`) |

### 2.3 상태별 처리 요약

| 내부 상태 | GitHub | Jira | Obsidian | Local |
|-----------|--------|------|----------|-------|
| `todo` | open + 라벨 없음 | statusCategory != done + 라벨 없음 | state=open + 라벨 없음 | state=open + 라벨 없음 |
| `in-progress` | `in-progress` 라벨 | `In Progress` transition | `in-progress` 라벨 | `in-progress` 라벨 |
| `reviewing` | `in-review` 라벨 | `REVIEWING` transition | `reviewing` 라벨 | `reviewing` 라벨 |
| `waiting-merge` | `awaiting-merge` 라벨 | `WAITING MERGE` transition | `waiting-merge` 라벨 | `waiting-merge` 라벨 |
| `done` | closed 상태 | statusCategory=done | state=closed | state=closed |

---

## 3. issue-status.ts 분기 로직

### 3.1 `TRANSITION_STATUSES` 정의

```typescript
const TRANSITION_STATUSES: IssueStatus[] = [
  IssueStatus.InProgress,   // 'in-progress'
  IssueStatus.InReview,      // 'reviewing'
  IssueStatus.AwaitingMerge, // 'waiting-merge'
];
```

`todo`와 `done`이 **의도적으로 제외**되어 있다. 이유:

1. `todo` — 라벨이 없는 상태가 곧 `todo`이므로, 관리할 라벨이 없음
2. `done` — `closed` 상태로 표현되므로, 라벨이 아닌 issue 자체의 상태로 판단

### 3.2 `deriveStatus()` — 상태 추론 로직

```
1. state === 'closed' → 즉시 done 반환 (모든 플랫폼 공통)
2. GitHub인 경우:
   - labels를 순회하며 reverseMap에서 매핑 찾기
   - TRANSITION_STATUSES에 포함된 상태만 반환
   - 매핑 없으면 → todo
3. Jira/Obsidian/Local인 경우:
   - labels를 순회하며 reverseMap에서 매핑 찾기
   - 모든 상태(5개) 매핑 가능 (TRANSITION_STATUSES 제한 없음)
   - 매핑 없으면 → todo
```

**핵심 차이**: GitHub 분기는 `TRANSITION_STATUSES.includes(status)` 체크가 있어 `todo`/`done` 라벨이 있어도 무시하지만, 비-GitHub 분기는 이 체크가 없어 `todo`/`done` 라벨도 매핑된다.

### 3.3 `setIssueStatus()` — 상태 설정 분기

| 단계 | 동작 |
|------|------|
| 1. 가드 | `todo` 또는 `done`으로 직접 설정 시도 시 → **에러 throw** |
| 2. 매핑 | `resolveStatusMapping()`으로 플랫폼별 매핑 해석 |
| 3-A. GitHub | 관리 라벨 3개 중 대상이 아닌 것 제거 → 대상 라벨 추가 |
| 3-B. Jira | `transitionTo()` 메서드로 Jira 워크플로우 전환 |
| 3-C. Obsidian/Local | GitHub와 동일한 라벨 기반 로직 (관리 라벨 제거 → 추가) |

### 3.4 `getIssueStatus()` — 단일 이슈 상태 조회

1. `adapter.get(issueRef)`로 이슈 정보 조회
2. `deriveStatus()`로 상태 추론
3. `IssueStatusInfo` 객체 반환

### 3.5 `getAllIssueStatuses()` — 전체 이슈 상태 조회

1. `TRANSITION_STATUSES` 3개에 해당하는 관리 라벨 목록 생성
2. `adapter.list({ state: 'open', labels: managedLabels })`로 **관리 라벨이 있는 open 이슈만** 조회
3. 각 이슈에 `deriveStatus()` 적용

**문제점**: `todo` 상태 이슈는 관리 라벨이 없으므로 `getAllIssueStatuses()`에서 **절대 조회되지 않는다**.

---

## 4. 플랫폼별 불일치/문제점

### 4.1 문제점 요약 테이블

| ID | 심각도 | 영향 플랫폼 | 설명 |
|----|--------|-------------|------|
| ST-01 | Medium | 전체 | `setIssueStatus()`에서 `todo`/`done` 설정 불가 — `close()`는 별도 호출 필요 |
| ST-02 | Medium | 전체 | `getAllIssueStatuses()`가 `todo` 이슈를 조회하지 않음 |
| ST-03 | Low | Obsidian/Local | `deriveStatus()`에서 `todo`/`done` 라벨이 reverseMap에 걸림 — GitHub과 동작 불일치 |
| ST-04 | Medium | Jira | `setIssueStatus()`에서 Jira는 `transitionTo()`를 쓰지만, `deriveStatus()`는 `labels`를 검사 |
| ST-05 | Low | 전체 | `StatusMapping`이 5개 키를 정의하지만 실제 사용되는 건 3개뿐 |
| ST-06 | Medium | Jira | Jira `list()`에서 `labels` 필터를 사용하지만, Jira 상태는 라벨이 아닌 워크플로우로 관리 |

### 4.2 상세 분석

#### ST-01: `todo`/`done` 직접 설정 불가

`setIssueStatus()`는 `todo`와 `done`을 명시적으로 거부한다:

```typescript
if (status === IssueStatus.Pending || status === IssueStatus.Completed) {
  throw new Error(`Cannot set status to ${status} directly`);
}
```

- `done`으로 전환하려면 `adapter.close()` 호출 필요
- `todo`로 되돌리려면 관리 라벨을 수동 제거해야 함 — **전용 API 없음**

#### ST-02: `todo` 이슈 조회 누락

`getAllIssueStatuses()`가 `adapter.list()`를 호출할 때 관리 라벨(`in-progress`, `reviewing`, `waiting-merge`)을 필터 조건으로 넘긴다. 라벨이 없는 `todo` 이슈는 이 필터에 걸리지 않아 결과에서 빠진다.

CLI에서 `agent-hive status`를 실행하면 "No tracked issues" 메시지가 뜨는데, 이는 `todo` 이슈가 존재해도 표시되지 않는다는 의미다. `status.ts`의 메시지도 이를 반영한다:

```
'No tracked issues (in-progress, reviewing, or waiting-merge).'
```

#### ST-03: GitHub vs 비-GitHub의 `deriveStatus()` 동작 차이

| 조건 | GitHub | Obsidian/Local |
|------|--------|----------------|
| `closed` 상태 | `done` 반환 | `done` 반환 |
| `todo` 라벨 존재 | **무시** (TRANSITION_STATUSES 체크) | `todo` 반환 (reverseMap 매핑) |
| `done` 라벨 존재 | **무시** | `done` 반환 |
| 매핑된 라벨 없음 | `todo` 반환 | `todo` 반환 |

비-GitHub에서 `todo` 라벨이 명시적으로 붙어 있으면 `todo`가 반환되지만, GitHub에서는 `TRANSITION_STATUSES` 필터로 인해 무시된다. 동작은 동일하게 `todo` 폴백이지만, **코드 경로가 다르다**.

문제가 드러나는 시나리오: 비-GitHub에서 `done` 라벨이 붙어 있지만 `state`가 `open`인 경우 → `deriveStatus()`가 `done`을 반환하지만, issue는 실제로 열려 있음.

#### ST-04: Jira 상태 관리의 이중성

| 동작 | 사용하는 메커니즘 |
|------|-------------------|
| 상태 **설정** (`setIssueStatus()`) | `transitionTo()` — Jira 네이티브 워크플로우 전환 |
| 상태 **조회** (`deriveStatus()`) | `issue.labels` 배열 검사 |
| 이슈 **목록** (`getAllIssueStatuses()`) | `labels` 필터로 `list()` 호출 |

Jira에서 상태는 `transitionTo()`로 워크플로우를 통해 전환되지만, 상태 조회는 `labels` 필드를 본다. Jira의 `labels`와 `status`는 **별개 필드**이므로:

1. `transitionTo()`로 `In Progress`로 전환해도 `labels`에는 반영되지 않음
2. `deriveStatus()`에서 `labels`를 검사하면 전환된 상태를 감지하지 못함
3. 결국 항상 `todo`로 추론될 가능성이 높음

`mapIssue()`에서 `issue.fields.labels`를 `Issue.labels`로 매핑하고 있으나, 이건 Jira의 라벨 필드이지 상태 필드가 아니다. `issue.fields.status.name`은 `Issue` 인터페이스에 매핑되지 않는다.

#### ST-05: StatusMapping 5키 vs TRANSITION_STATUSES 3개

`StatusMapping` 인터페이스는 5개 키를 정의한다:

```typescript
interface StatusMapping {
  todo: string;
  'in-progress': string;
  reviewing: string;
  'waiting-merge': string;
  done: string;
}
```

그러나 실제로 `setIssueStatus()`에서 관리하는 라벨은 `TRANSITION_STATUSES`의 3개뿐이다. `todo`와 `done` 매핑값은:

| 사용처 | `todo` 매핑 사용 여부 | `done` 매핑 사용 여부 |
|--------|----------------------|----------------------|
| `setIssueStatus()` | 사용 안 함 (에러 throw) | 사용 안 함 (에러 throw) |
| `deriveStatus()` (GitHub) | reverseMap에 들어가지만 TRANSITION_STATUSES 필터에 걸림 | reverseMap에 들어가지만 `closed` 체크가 먼저 실행 |
| `deriveStatus()` (비-GitHub) | reverseMap에서 매핑 가능 | reverseMap에서 매핑 가능 |
| `getAllIssueStatuses()` | 라벨 목록에 미포함 | 라벨 목록에 미포함 |

즉, `todo`와 `done`의 매핑값은 비-GitHub `deriveStatus()`에서만 의미가 있고, 나머지에서는 사실상 **데드 설정**이다.

#### ST-06: Jira `getAllIssueStatuses()`의 라벨 필터 문제

`getAllIssueStatuses()`는 관리 라벨(`In Progress`, `REVIEWING`, `WAITING MERGE`)로 `list()`를 호출한다. Jira `list()`는 이를 JQL `labels = "In Progress"` 조건으로 변환한다.

그러나 Jira에서 상태 전환은 `transitionTo()`로 하므로, `labels` 필드에 이 값이 존재하지 않는다. 결과적으로 **Jira에서 `getAllIssueStatuses()`는 항상 빈 배열을 반환**할 가능성이 높다.

---

## 5. 현재 statusMapping과의 관계

### 5.1 매핑 흐름

```
AdapterConfig.statusMapping (유저 오버라이드, Partial<StatusMapping>)
        ↓
resolveStatusMapping() — DEFAULT_STATUS_MAPPINGS + 유저 오버라이드 병합
        ↓
StatusMapping (완전한 5키 객체)
        ↓
buildReverseMap() — { 플랫폼 상태명 → 내부 키 } Map 생성
        ↓
deriveStatus() / setIssueStatus() 에서 사용
```

### 5.2 5키 정의 vs 3키 사용 불일치

| 측면 | 정의 | 실제 사용 |
|------|------|-----------|
| `StatusMapping` 인터페이스 | 5개 키 (`todo`, `in-progress`, `reviewing`, `waiting-merge`, `done`) | — |
| `DEFAULT_STATUS_MAPPINGS` | 5개 키 모두 매핑 | — |
| `resolveStatusMapping()` | 5개 키 병합 | — |
| `TRANSITION_STATUSES` | — | 3개만 (`in-progress`, `reviewing`, `waiting-merge`) |
| `setIssueStatus()` 라벨 관리 | — | 3개 라벨만 추가/제거 |
| `getAllIssueStatuses()` 필터 | — | 3개 라벨만 검색 |
| `deriveStatus()` GitHub 분기 | — | 3개만 유효 (TRANSITION_STATUSES 필터) |
| `deriveStatus()` 비-GitHub 분기 | — | **5개 모두 유효** (필터 없음) |

### 5.3 유저 오버라이드 시 영향

유저가 `statusMapping`을 커스터마이즈할 때:

```json
{
  "adapter": {
    "type": "github",
    "statusMapping": {
      "in-progress": "wip",
      "todo": "backlog"
    }
  }
}
```

- `in-progress` → `wip`: 정상 작동 (TRANSITION_STATUSES에 포함)
- `todo` → `backlog`: GitHub에서는 **무시됨** (reverseMap에 들어가지만 TRANSITION_STATUSES 필터에 걸림)
- 유저는 5개 키를 모두 커스터마이즈할 수 있다고 기대하지만, 실제로는 3개만 효과가 있음

### 5.4 개선 방향 제안

| 방향 | 설명 | 장단점 |
|------|------|--------|
| A. 3키로 축소 | `StatusMapping`에서 `todo`/`done` 제거, `TRANSITION_STATUSES`만 남김 | 명확하지만 확장성 감소 |
| B. 5키 완전 활용 | `deriveStatus()` GitHub 분기에서도 5키 모두 매핑, `setIssueStatus()`에서 `todo`/`done` 지원 | 일관성 확보, 구현 복잡도 증가 |
| C. Jira 전용 분기 강화 | `deriveStatus()`에서 Jira는 `labels` 대신 `status.name` 매핑 사용 | Jira 정합성 확보, Issue 인터페이스 확장 필요 |

Jira 문제(ST-04, ST-06)를 해결하려면 `Issue` 인터페이스에 `platformStatus?: string` 같은 필드를 추가하거나, `deriveStatus()`에서 Jira 전용 로직을 분리해야 한다.
