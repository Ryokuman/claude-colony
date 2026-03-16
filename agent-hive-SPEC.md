# agent-hive — 프로젝트 명세

## 1. 프로젝트 개요

어떤 Git 레포에든 붙이면 Claude 세션들이 자율적으로 개발 조직처럼 동작하는 시스템.

**핵심 가치:**
- 워커 세션이 브랜치별로 스폰되어 작업 컨텍스트를 축적하며 개발
- PR 생성 시 리뷰어 세션 자동 스폰 → 워커-리뷰어 핑퐁 자동화
- Obsidian vault를 장기 기억 레이어로 활용 (SSoT + 작업 기록서)
- GitHub Issues 또는 Obsidian으로 태스크 관리 선택 가능
- claude-worktree-system을 포함한 어떤 레포도 이 시스템으로 관리 가능

---

## 2. 핵심 개념

### 세션 타입

| 타입 | 역할 | 생명주기 |
|------|------|----------|
| 워커 세션 | 브랜치 작업 + 컨텍스트 축적 + PR 생성 | 브랜치 작업 내내 살아있음 |
| 리뷰어 세션 | PR 트리거로 스폰 + 워커와 핑퐁 리뷰 | PR 승인 또는 머지까지 |

**세션이 살아있어야 하는 이유:**
워커 세션은 작업 중 이슈화하고 넘어간 결정사항, race condition 등의 맥락을 컨텍스트로 보유함.
새 세션은 이 히스토리를 모르기 때문에 리뷰 반박/근거 있는 대응이 불가능.
컨텍스트가 너무 길어질 경우를 대비해 작업 기록서(Obsidian)에 핵심 결정사항을 실시간 기록하여 복원 가능하게 함.

### Obsidian 두 레이어

| 레이어 | 역할 | 변경 속도 | 작성 주체 |
|--------|------|-----------|-----------|
| SSoT (Single Source of Truth) | 기획, 컨벤션, 아키텍처 결정사항, 패턴 | 느림 (정제 후 업데이트) | 중요 결정 시 세션이 승격 |
| 작업 기록서 (Session Log) | 세션별 날것의 기록, 왜 그 결정을 했는지 | 빠름 (실시간 append) | 해당 세션이 직접 기록 |

### GitHub 역할

| 역할 | 설명 |
|------|------|
| PR 코멘트 | 워커-리뷰어 세션 간 통신 매개체 (메시지 큐) |
| Issues | 태스크 상태 관리 (taskManager=github 시) |
| Webhook | PR 이벤트 → 리뷰어 세션 스폰 트리거 |

---

## 3. 기술 스택

| 항목 | 기술 |
|------|------|
| 언어 | TypeScript |
| 런타임 | Node.js |
| 파일 감시 | chokidar |
| GitHub 연동 | gh CLI + GitHub REST API |
| 세션 스폰 | claude CLI (`claude -p`) |
| 설정 | hive.config.json + .env |

---

## 4. 프로젝트 구조

```
agent-hive/
├── hive.config.json          ← 자동생성, gitignore
├── .env                        ← 시크릿 (token, secret), gitignore
├── CLAUDE.md                   ← hive 자체 개발용 규칙
├── SPEC.md                     ← 이 파일
│
├── src/
│   ├── index.ts                ← 진입점
│   ├── config.ts               ← hive.config.json + .env 로드/파싱/검증
│   │
│   ├── core/
│   │   ├── session-spawner.ts  ← 워커/리뷰어 세션 스폰
│   │   ├── session-logger.ts   ← 작업 기록서 append
│   │   └── file-watcher.ts     ← chokidar 기반 이벤트 감시
│   │
│   ├── github/
│   │   ├── webhook-server.ts   ← PR/이슈 이벤트 수신 서버
│   │   ├── issues.ts           ← 이슈 생성/라벨링/상태 업데이트
│   │   └── pr.ts               ← PR 생성/상태 관리
│   │
│   ├── obsidian/
│   │   ├── vault-init.ts       ← vault 폴더 구조 자동 생성
│   │   ├── sot-sync.ts         ← SSoT 업데이트 (작업 기록서 → SSoT 승격)
│   │   └── session-log.ts      ← 작업 기록서 생성/append
│   │
│   └── prompts/
│       ├── worker.md           ← 워커 세션 CLAUDE.md 규칙 템플릿
│       └── reviewer.md         ← 리뷰어 세션 CLAUDE.md 규칙 템플릿
│
└── vault/                      ← Obsidian vault 기본 구조 (obsidianEnabled 시 생성)
    ├── spec/                   ← 기획, 요구사항, 아키텍처 결정
    ├── context/                ← CLAUDE.md, 컨벤션, 패턴
    └── sessions/               ← 세션별 작업 기록서
```

---

## 5. 설정

### hive.config.json (자동생성)

```json
{
  // 타겟 레포 절대 경로
  "targetRepo": "/path/to/your/repo",

  // 태스크 관리 방식: "github" | "obsidian"
  // github: Issues를 태스크 SSoT로 사용
  // obsidian: Obsidian vault를 태스크 SSoT로 사용
  "taskManager": "github",

  "github": {
    // owner/repo 형식
    "repo": "owner/repo-name"
  },

  "obsidian": {
    // Obsidian vault 절대 경로 (taskManager=obsidian 또는 문서 레이어 사용 시)
    "vaultPath": "/path/to/obsidian/vault",
    // Obsidian 문서 레이어 사용 여부 (taskManager와 무관하게 SSoT/기록서 활성화)
    "enabled": true
  },

  "ports": {
    // hive 대시보드 포트
    "dashboard": 4000,
    // webhook 수신 서버 포트
    "webhook": 4001
  },

  "session": {
    // PR 생성 시 리뷰어 세션 자동 스폰 여부
    "reviewerEnabled": true,
    // 워커 세션 자동 스폰 여부
    "autoSpawn": true
  }
}
```

### .env (시크릿)

```env
GITHUB_TOKEN=ghp_xxx
WEBHOOK_SECRET=xxx
```

### 우선순위

`hive.config.json` 우선, 없으면 `.env` 폴백.
민감한 값(token, secret)은 반드시 `.env`에.

---

## 6. 핵심 모듈 명세

### config.ts
- `hive.config.json` 로드 및 파싱
- `.env` 폴백 처리
- 설정 검증 (필수값 누락 시 명확한 에러)
- 설정 객체 타입 정의 및 export

### core/session-spawner.ts
- 워커 세션 스폰: `claude -p` + 워커 규칙 프롬프트 주입
- 리뷰어 세션 스폰: PR 번호 + 리뷰어 규칙 프롬프트 주입
- 세션 시작 시 작업 기록서 파일 자동 생성
- 세션 종료 감지 후 정리

### core/session-logger.ts
- 세션별 작업 기록서 파일 생성 (`sessions/{role}-{branch}-{date}.md`)
- 실시간 append
- 중요 결정사항 SSoT 승격 트리거

### core/file-watcher.ts
- chokidar로 `/tmp/hive-events/` 감시
- 새 이벤트 파일 감지 → 해당 세션 깨우기
- webhook-server가 이벤트를 파일로 기록하면 여기서 감지

### github/webhook-server.ts
- Express 기반 HTTP 서버 (WEBHOOK_PORT)
- GitHub Webhook 이벤트 수신 (PR opened, PR review comment, PR closed)
- 이벤트를 `/tmp/hive-events/{pr-number}.json`에 기록
- Webhook secret 검증

### github/issues.ts
- `gh` CLI 래퍼
- 이슈 생성: 제목, 본문, 라벨
- 라벨 업데이트: `backlog` | `in-progress` | `blocked`
- 이슈 close
- taskManager=github 시에만 활성화

### github/pr.ts
- PR 생성
- PR 코멘트 작성/조회
- PR 상태 조회 (open, merged, closed)
- 리뷰어 세션 스폰 트리거 연결

### obsidian/vault-init.ts
- vault 폴더 구조 생성 (`spec/`, `context/`, `sessions/`)
- obsidian.enabled=true 시 최초 실행에 자동 생성

### obsidian/sot-sync.ts
- 작업 기록서의 중요 결정사항 → SSoT 승격
- `context/CLAUDE.md` 업데이트
- `spec/` 문서 업데이트

### obsidian/session-log.ts
- 작업 기록서 파일 생성/append
- 세션 종료 시 요약 기록

---

## 7. 전체 동작 플로우

### 시작
```
index.ts 실행
→ config.ts로 설정 로드
→ obsidian.enabled=true면 vault-init 실행
→ webhook-server 시작 (WEBHOOK_PORT)
→ file-watcher 시작 (/tmp/hive-events/ 감시)
→ 대기
```

### 프로젝트 기획 → 태스크 생성
```
유저가 기획 초안 작성
→ Claude와 함께 구체화
→ Obsidian spec/에 문서화
→ taskManager에 따라:
    github  → GitHub Issues 자동 생성
    obsidian → Obsidian tasks/에 기록
```

### 워커 세션 작업
```
태스크 시작
→ session-spawner가 워커 세션 스폰
→ 세션 시작 시 SSoT 읽어 컨텍스트 로드
→ 작업 기록서 자동 생성 (sessions/worker-{branch}-{date}.md)
→ 작업 중 실시간 기록서 append
→ 블로커 발생 시:
    → GitHub Issue 자동 등록 (label: blocked)
    → 작업 기록서에 사유 기록
→ 작업 완료 → PR 생성
```

### 리뷰 루프
```
PR 생성
→ GitHub Webhook 발동
→ webhook-server 수신 → /tmp/hive-events/{pr}.json 기록
→ file-watcher 감지
→ session-spawner가 리뷰어 세션 스폰
→ 리뷰어가 PR 코멘트 작성
→ 워커 세션이 file-watcher로 새 코멘트 감지
→ 컨텍스트 기반 대응 (반박 or 수정)
→ 재푸시 → 리뷰어 재리뷰
→ 핑퐁 반복
→ 리뷰어 승인 → 유저에게 최종 확인 요청
```

### 완료
```
유저 승인 → 머지
→ 작업 기록서 중요 결정사항 → SSoT 승격
→ GitHub Issue close
→ 작업 기록서 아카이브
```

---

## 8. CLAUDE.md 규칙 (prompts/)

### worker.md — 워커 세션 규칙

```markdown
## 워커 세션 규칙

### 작업 시작 시
- vault/context/CLAUDE.md 반드시 읽기
- vault/spec/ 관련 문서 읽기
- 작업 기록서 파일 생성: sessions/worker-{branch}-{date}.md

### 작업 중
- 결정사항, 이슈화한 항목, 왜 그렇게 했는지 작업 기록서에 실시간 기록
- 블로커 발생 시: GitHub Issue 등록 후 작업 기록서에 기록, 작업 중단
- 현재 scope 아닌 작업 발견 시: backlog Issue 등록 후 계속 진행
- 반복되는 패턴/규칙 발견 시: vault/context/CLAUDE.md 업데이트 제안

### PR 생성 시
- 작업 기록서에 PR 번호 기록
- PR 본문에 관련 Issue 번호 연결 (closes #N)

### 리뷰 코멘트 수신 시
- 작업 기록서 참조하여 컨텍스트 기반 대응
- 이미 이슈화한 항목 지적 시 → 해당 Issue 번호로 반박
- 정당한 지적 시 → 수정 후 재푸시
- 리뷰 중 새 이슈 발견 시 → Issue 등록
```

### reviewer.md — 리뷰어 세션 규칙

```markdown
## 리뷰어 세션 규칙

### 리뷰 시작 시
- vault/context/CLAUDE.md 읽기
- PR 전체 diff 검토
- 워커 세션 작업 기록서 읽기 (sessions/worker-{branch}-*.md)

### 리뷰 중
- 코드 품질, 버그, 보안, 성능 순으로 검토
- 작업 기록서에서 이미 인지한 이슈는 재지적 금지
- 새로운 이슈 발견 시 PR 코멘트 + GitHub Issue 등록
- 수정 요청 시 구체적인 근거 제시

### 승인 조건
- 모든 수정 요청 반영 확인
- 새로운 크리티컬 이슈 없음
- 승인 후 유저에게 최종 확인 요청 메시지 작성
```

---

## 9. 이벤트 파일 포맷 (/tmp/hive-events/)

```json
{
  "type": "pr_opened" | "pr_comment" | "pr_closed" | "pr_merged",
  "prNumber": 123,
  "branch": "feat/feature-name",
  "payload": { /* GitHub Webhook payload */ },
  "timestamp": "2025-03-16T00:00:00Z"
}
```

---

## 10. 아키텍처 결정 사항

| 결정 | 이유 |
|------|------|
| 세션을 살아있게 유지 | 작업 중 이슈화한 결정사항 컨텍스트로 리뷰 대응 가능 |
| GitHub PR 코멘트를 통신 매개체로 | 두 독립 프로세스 간 자연스러운 메시지 큐 |
| file-watcher로 세션 깨우기 | webhook → 파일 기록 → chokidar 감지 → 세션 알림 |
| Obsidian을 장기 기억으로 | 컨텍스트 유실 시 작업 기록서로 복원 가능 |
| taskManager 선택 가능 | 오픈소스(GitHub Issues) vs 개인 프로젝트(Obsidian) 모두 지원 |
| hive.config.json 자동생성 | 사용자가 별도 init 없이 바로 수정해서 사용 |
| 시크릿은 .env 분리 | config 파일 실수 커밋 방지 |
