# claude-colony

어떤 Git 레포에든 붙이면 Claude 세션들이 자율적으로 개발 조직처럼 동작하는 시스템.

워커 세션이 브랜치별로 스폰되어 작업하고, PR 생성 시 리뷰어 세션이 자동 스폰되어 워커-리뷰어 핑퐁 리뷰가 자동화됩니다.

## 요구사항

- Node.js >= 20
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) 설치 및 인증
- [GitHub CLI (`gh`)](https://cli.github.com/) 설치 및 인증
- GitHub Personal Access Token (repo 스코프)

## 설치

```bash
git clone git@github.com:Ryokuman/claude-colony.git
cd claude-colony
npm install
```

## 설정

### 1. `.env` 생성

```bash
cp .env.example .env
```

```env
GITHUB_TOKEN=ghp_your_token_here
WEBHOOK_SECRET=your_webhook_secret
```

### 2. `colony.config.json` 생성

프로젝트 루트에 `colony.config.json`을 만듭니다:

```json
{
  "targetRepo": "/absolute/path/to/your/repo",
  "taskManager": "github",
  "github": {
    "repo": "owner/repo-name"
  },
  "obsidian": {
    "vaultPath": "/absolute/path/to/obsidian/vault",
    "enabled": false
  },
  "ports": {
    "dashboard": 4000,
    "webhook": 4001
  },
  "session": {
    "reviewerEnabled": true,
    "autoSpawn": true
  }
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `targetRepo` | O | 관리할 Git 레포 절대 경로 |
| `taskManager` | O | `"github"` 또는 `"obsidian"` |
| `github.repo` | taskManager=github 시 | `owner/repo` 형식 |
| `obsidian.vaultPath` | obsidian.enabled=true 시 | Obsidian vault 절대 경로 |
| `obsidian.enabled` | X | Obsidian 문서 레이어 활성화 (기본: false) |
| `ports.dashboard` | X | 대시보드 포트 (기본: 4000) |
| `ports.webhook` | X | Webhook 수신 포트 (기본: 4001) |
| `session.reviewerEnabled` | X | PR 시 리뷰어 자동 스폰 (기본: true) |
| `session.autoSpawn` | X | 워커 자동 스폰 (기본: true) |

### 3. GitHub Webhook 설정

타겟 레포의 GitHub Settings > Webhooks에서:

- **Payload URL**: `http://your-server:4001/webhook`
- **Content type**: `application/json`
- **Secret**: `.env`의 `WEBHOOK_SECRET`과 동일
- **Events**: `Pull requests`, `Issue comments`

## 실행

```bash
# 개발 모드 (tsx, 핫 리로드 없음)
npm run dev

# 프로덕션
npm run build
npm start
```

## 동작 플로우

```
1. colony 시작
   → config 로드 → vault 초기화 (선택) → webhook 서버 시작 → 이벤트 감시 시작

2. PR 생성 시
   → GitHub Webhook 수신 → /tmp/colony-events/ 에 이벤트 기록
   → file-watcher 감지 → 리뷰어 세션 자동 스폰

3. 리뷰 루프
   → 리뷰어가 PR 코멘트 작성 → 워커가 감지 → 반박 또는 수정
   → 재푸시 → 리뷰어 재리뷰 → 승인 시 유저에게 최종 확인 요청

4. 완료
   → 유저 승인 → 머지 → 작업 기록서 SSoT 승격 → Issue close
```

## 태스크 관리

### GitHub Issues 모드 (`taskManager: "github"`)

- 이슈 자동 생성/라벨링 (`backlog`, `in-progress`, `blocked`)
- PR 머지 시 관련 이슈 자동 close

### Obsidian 모드 (`taskManager: "obsidian"`)

- vault 폴더 구조: `spec/`, `context/`, `sessions/`
- 세션별 작업 기록서 자동 생성
- 중요 결정사항 SSoT 자동 승격

## Obsidian Vault 구조

`obsidian.enabled: true` 시 자동 생성:

```
vault/
├── spec/           ← 기획, 요구사항, 아키텍처 결정
├── context/        ← CLAUDE.md (컨벤션, 패턴 — SSoT)
└── sessions/       ← 세션별 작업 기록서
```

- **SSoT (`context/`)**: 느리게 변함. 검증된 결정사항만 승격.
- **작업 기록서 (`sessions/`)**: 빠르게 변함. 세션이 실시간 append.

## 세션 규칙

워커/리뷰어 세션에는 자동으로 규칙 프롬프트가 주입됩니다.

- `src/prompts/worker.md` — 워커 세션 규칙
- `src/prompts/reviewer.md` — 리뷰어 세션 규칙

## 개발

```bash
# 테스트
npm test

# 포맷팅
npm run format

# 포맷 체크
npm run format:check

# 타입 체크
npx tsc --noEmit
```

## 프로젝트 구조

```
src/
├── index.ts                ← 진입점
├── config.ts               ← 설정 로드/검증
├── core/
│   ├── errors.ts           ← ColonyError 에러 체계
│   ├── logger.ts           ← 구조화된 로거
│   ├── session-spawner.ts  ← 워커/리뷰어 세션 스폰
│   ├── session-logger.ts   ← 작업 기록서 관리
│   └── file-watcher.ts     ← 이벤트 파일 감시
├── github/
│   ├── webhook-server.ts   ← Webhook 수신 서버
│   ├── issues.ts           ← GitHub Issues CRUD
│   └── pr.ts               ← PR 생성/상태 관리
├── obsidian/
│   ├── vault-init.ts       ← Vault 초기화
│   ├── session-log.ts      ← 작업 기록서 생성/append
│   └── sot-sync.ts         ← SSoT 승격 동기화
└── prompts/
    ├── worker.md            ← 워커 규칙 템플릿
    └── reviewer.md          ← 리뷰어 규칙 템플릿
```

## 라이센스

MIT
