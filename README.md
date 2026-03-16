# claude-colony

**기존 Git 레포에 붙이는 AI 개발 파이프라인 서버.**

서버를 띄우면 Claude 세션이 워커/리뷰어로 자율 동작하며
이슈 관리 → 개발 → PR → 코드 리뷰 → 머지 요청까지 자동화합니다.
머지는 반드시 유저가 직접 승인합니다.

## 어떻게 동작하나

```
npx claude-colony init --repo owner/repo --target-repo ./my-project --token ghp_xxx
npx claude-colony start
```

```
┌─────────────────────────────────────────────────┐
│  claude-colony server                           │
│                                                 │
│  ┌──────────┐    PR 생성    ┌──────────┐        │
│  │  워커     │ ───────────→ │  리뷰어   │        │
│  │  세션     │ ←─────────── │  세션     │        │
│  └──────────┘  코멘트 핑퐁  └──────────┘        │
│       │                          │              │
│       ▼                          ▼              │
│  ┌──────────────────────────────────────┐       │
│  │  GitHub (Issues, PR, Webhook)        │       │
│  └──────────────────────────────────────┘       │
│       │                                         │
│       ▼                                         │
│  ┌──────────────────────────────────────┐       │
│  │  Obsidian vault (선택)               │       │
│  │  작업 기록 축적 + SSoT 승격          │       │
│  └──────────────────────────────────────┘       │
│                                                 │
└─────────────────────────────────────────────────┘
        │
        ▼
   유저가 최종 머지 승인
```

## 핵심 기능

- **워커 세션** — 브랜치별로 스폰, 코드 작성, PR 생성
- **리뷰어 세션** — PR 트리거로 자동 스폰, 코드 리뷰, 워커와 핑퐁
- **이슈 관리** — GitHub Issues 자동 생성/라벨링/close
- **장기 기억** — Obsidian vault에 작업 기록 축적, 컨텍스트 유실 방지
- **머지 보호** — init 시 브랜치 보호 규칙 자동 설정, AI가 머지 불가

## 왜 쓰는가

| 문제 | claude-colony의 해결 |
|------|----------------------|
| AI가 코드 리뷰 없이 머지 | 워커-리뷰어 분리 + 유저 최종 승인 강제 |
| 새 세션이 이전 맥락을 모름 | 작업 기록서 + SSoT로 컨텍스트 복원 |
| 이슈/PR 수동 관리 | 자동 생성, 라벨링, 연결, close |
| AI 에이전트 설정이 복잡 | `npx claude-colony init` 한 줄로 끝 |

## 빠른 시작

```bash
# 1. 초기화 (config 생성 + GitHub 브랜치 보호 설정)
npx claude-colony init \
  --repo owner/repo \
  --target-repo /path/to/repo \
  --token ghp_xxx

# 2. 서버 시작
npx claude-colony start
```

## 문서

- [설치 및 설정 가이드](docs/setup.md)
- [프로젝트 명세](claude-colony-SPEC.md)
- [코드 컨벤션](CONVENTIONS.md)

## 프로젝트 구조

```
src/
├── cli.ts              ← CLI 진입점 (init, start)
├── index.ts            ← 서버 진입점
├── config.ts           ← 설정 로드/검증
├── commands/
│   └── init.ts         ← init 명령어
├── core/               ← 세션 스폰, 로거, 이벤트 감시
├── github/             ← Webhook, Issues, PR
├── obsidian/           ← Vault 초기화, 기록서, SSoT
└── prompts/            ← 워커/리뷰어 규칙 템플릿
```

## 라이센스

MIT
