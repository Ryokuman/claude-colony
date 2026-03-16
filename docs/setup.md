# 설치 및 설정

## 요구사항

- Node.js >= 20
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) 설치 및 인증
- [GitHub CLI (`gh`)](https://cli.github.com/) 설치 및 인증
- GitHub Personal Access Token (`repo` 스코프)

## 빠른 시작

```bash
npx agent-hive init \
  --repo owner/repo-name \
  --target-repo /path/to/your/repo \
  --token ghp_your_token
```

이 한 줄로:
- `hive.config.json` 자동 생성
- `.env` 자동 생성
- GitHub 브랜치 보호 규칙 자동 설정 (PR 필수 + 승인 필수)

### init 옵션

| 플래그 | 필수 | 설명 | 기본값 |
|--------|------|------|--------|
| `--repo` | O | GitHub 레포 (`owner/repo`) | |
| `--target-repo` | O | 로컬 레포 절대 경로 | |
| `--token` | O | GitHub PAT | |
| `--webhook-secret` | X | Webhook 시크릿 | |
| `--base-branch` | X | PR 타겟 브랜치 | `main` |
| `--obsidian-vault` | X | Obsidian vault 경로 | |
| `--webhook-port` | X | Webhook 서버 포트 | `4001` |
| `--dashboard-port` | X | 대시보드 포트 | `4000` |

## 수동 설정

`init`을 쓰지 않고 직접 설정할 수도 있습니다.

### 1. `.env` 생성

```bash
cp .env.example .env
```

```env
GITHUB_TOKEN=ghp_your_token_here
WEBHOOK_SECRET=your_webhook_secret
```

### 2. `hive.config.json` 생성

```json
{
  "targetRepo": "/absolute/path/to/your/repo",
  "taskManager": "github",
  "github": {
    "repo": "owner/repo-name",
    "baseBranch": "main"
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
| `github.baseBranch` | X | PR 타겟 브랜치 (기본: `main`) |
| `obsidian.vaultPath` | obsidian.enabled=true 시 | Obsidian vault 절대 경로 |
| `obsidian.enabled` | X | Obsidian 문서 레이어 (기본: false) |
| `ports.dashboard` | X | 대시보드 포트 (기본: 4000) |
| `ports.webhook` | X | Webhook 수신 포트 (기본: 4001) |
| `session.reviewerEnabled` | X | PR 시 리뷰어 자동 스폰 (기본: true) |
| `session.autoSpawn` | X | 워커 자동 스폰 (기본: true) |

### 3. GitHub Webhook 설정

타겟 레포의 GitHub Settings > Webhooks:

- **Payload URL**: `http://your-server:4001/webhook`
- **Content type**: `application/json`
- **Secret**: `.env`의 `WEBHOOK_SECRET`
- **Events**: `Pull requests`, `Issue comments`

## 실행

```bash
# 서버 시작
npx agent-hive start

# 또는 개발 모드
npm run dev

# 프로덕션 빌드
npm run build && npm start
```

## 개발

```bash
npm test              # 테스트
npm run format        # 포맷팅
npm run format:check  # 포맷 체크
npx tsc --noEmit      # 타입 체크
```
