# 워커 세션 규칙

> 이 규칙은 Agent Team의 Worker 팀원에게 주입됩니다.

---

## 작업 시작 시

1. **컨텍스트 로드**
   - 이슈 내용을 분석하고 작업 계획을 세운다.
   - 주입된 Project Tooling 섹션의 컨벤션/포매터/린터 지시를 따른다.

2. **브랜치 확인**
   - Colony가 이미 워크트리와 브랜치를 생성했으므로, 직접 브랜치를 만들지 않는다.
   - 현재 브랜치에서 바로 작업을 시작한다.

---

## 작업 중

1. **코드 구현**
   - 이슈 요구사항에 따라 코드를 작성한다.
   - 프로젝트 컨벤션을 준수한다.

2. **블로커 발생 시**
   - 이슈를 등록한다: `agent-hive issue create --title "..." --body "..." --label blocked`
   - Reviewer에게 메시지로 블로커 사유를 알린다.

3. **스코프 외 작업 발견 시**
   - 이슈를 분리 등록한다: `agent-hive issue create --title "..." --body "..." --label backlog`
   - 현재 작업을 계속 진행한다.

---

## PR 생성 시

1. **PR 본문 작성**
   - `closes #{issue-number}`를 포함한다.
   - 주요 변경사항과 결정 근거를 명시한다.

2. **Reviewer 호출**
   - PR 생성 후 Reviewer에게 메시지를 보낸다: "PR #{pr-number} 생성 완료. 리뷰 부탁드립니다."

---

## 리뷰 피드백 수신 시

Reviewer로부터 메시지를 받으면:

1. **피드백 분석**
   - 수정 요청 사항을 파악한다.

2. **이슈 분류**
   - **현재 PR 스코프**: 바로 수정한다.
   - **별도 스코프**: 이슈를 분리 등록한다 (`agent-hive issue create --title "..." --body "..." --label backlog`). 근거와 함께 Reviewer에게 알린다.
   - **블로커급**: 이슈를 등록한다 (`agent-hive issue create --title "..." --body "..." --label blocked`). Reviewer에게 블로킹 사유를 알린다.

3. **수정 및 재푸시**
   - 코드를 수정하고 커밋 → 푸시한다.
   - Reviewer에게 메시지: "수정 완료했습니다. 재리뷰 부탁드립니다."

---

## 이슈 상태 관리

> `agent-hive` CLI를 통해 이슈를 관리한다. 어댑터 설정(GitHub/Jira/Local 등)에 따라 실제 동작이 달라지므로, `gh` CLI를 직접 호출하지 않는다.

- 작업 시작 시: `agent-hive issue label <N> --add in-progress`
- PR 생성 후: `agent-hive issue label <N> --remove in-progress --add in-review`
- 승인 후: `agent-hive issue label <N> --remove in-review --add awaiting-merge`

## 세션 종료

- Reviewer로부터 승인 메시지를 받으면:
  1. 이슈 라벨을 `awaiting-merge`로 변경한다.
  2. 총 수정사항을 간단히 정리한다.
  3. 세션을 종료한다.
