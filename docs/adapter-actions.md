# 어댑터 액션 다이어그램

## IssueAdapter 인터페이스 전체 구조

```mermaid
graph TB
  subgraph IssueAdapter["IssueAdapter 인터페이스"]
    direction LR
    subgraph CRUD["Issue CRUD"]
      get["get(ref)"]
      list["list(options?)"]
      create["create(input)"]
      update["update(ref, input)"]
      close["close(ref)"]
    end
    subgraph Status["Status Semantics"]
      derive["deriveStatus(issue)"]
      setS["setStatus(ref, s)"]
      listBy["listByStatus(ss[])"]
    end
    subgraph Labels["Label Ops"]
      addL["addLabel()"]
      removeL["removeLabel()"]
    end
  end

  subgraph Extensions["플랫폼 전용 확장"]
    gh["GitHub: createPr, getPrStatus, addPrComment, getPrComments"]
    obs["Obsidian: initVault, createSessionLog, appendToLog, syncToSpec"]
  end

  IssueAdapter --> Extensions
```

---

## 액션별 플랫폼 구현

### get

```mermaid
flowchart LR
  A["adapter.get(ref)"] --> GH["GitHub<br/>gh issue view --json"]
  A --> JR["Jira<br/>GET /rest/api/3/issue/{ref}<br/>ADF 파싱 + statusCategory 변환"]
  A --> OB["Obsidian<br/>readFile({ref}.md)<br/>YAML frontmatter 파싱"]
  A --> LC["Local<br/>issues.json → find(number)"]
```

### list

```mermaid
flowchart LR
  A["adapter.list(options)"] --> GH["GitHub<br/>gh issue list --state --json<br/>hasLabel → --search '-no:label'<br/>labels → --label (AND 시맨틱)"]
  A --> JR["Jira<br/>POST /search<br/>JQL + startAt 페이지네이션"]
  A --> OB["Obsidian<br/>readdir → .md 파싱<br/>메모리 필터 (OR)"]
  A --> LC["Local<br/>issues.json<br/>메모리 필터 (OR)"]
```

### create

```mermaid
flowchart LR
  A["adapter.create(input)"] --> GH["GitHub<br/>gh issue create<br/>URL 파싱 → get() 재조회"]
  A --> JR["Jira<br/>POST /rest/api/3/issue<br/>ADF 변환 + issueType 매핑"]
  A --> OB["Obsidian<br/>.meta.json nextId<br/>{nextId}.md 생성"]
  A --> LC["Local<br/>issues.json push<br/>nextId++ → save"]
```

### update / close

```mermaid
flowchart LR
  subgraph update["update(ref, input)"]
    GH1["GitHub: gh issue edit"]
    JR1["Jira: PUT /issue/{ref} + ADF"]
    OB1["Obsidian: frontmatter 수정"]
    LC1["Local: JSON 수정 → save"]
  end

  subgraph close["close(ref)"]
    GH2["GitHub: gh issue close --reason completed"]
    JR2["Jira: transitionTo('done')"]
    OB2["Obsidian: update(state:'closed')"]
    LC2["Local: update(state:'closed')"]
  end
```

### addLabel / removeLabel

```mermaid
flowchart LR
  subgraph add["addLabel(ref, label)"]
    GH1["GitHub: --add-label"]
    JR1["Jira: update.labels.add"]
    OB1["Obsidian: push → writeFile"]
    LC1["Local: push → save"]
  end

  subgraph remove["removeLabel(ref, label)"]
    GH2["GitHub: --remove-label<br/>실패 시 warn"]
    JR2["Jira: update.labels.remove"]
    OB2["Obsidian: filter → writeFile"]
    LC2["Local: filter → save"]
  end
```

---

## 상태 시맨틱 (Status Semantics)

### 상태 흐름

```mermaid
stateDiagram-v2
  [*] --> todo: open + 라벨 없음
  todo --> in_progress: 라벨/전이
  in_progress --> reviewing: 라벨/전이
  reviewing --> waiting_merge: 라벨/전이
  waiting_merge --> done: close
  done --> [*]
```

### deriveStatus

```mermaid
flowchart TD
  A["adapter.deriveStatus(issue)"] --> C{state === closed?}
  C -->|Yes| D["done"]
  C -->|No| E{플랫폼별 분기}

  E --> GH["GitHub/Obsidian/Local<br/>labels 순회 → mapping 매칭<br/>TRANSITION_STATUSES 필터"]
  E --> JR["Jira<br/>platformStatus → mapping 매칭"]

  GH -->|매칭 없음| T["todo"]
  GH -->|매칭| R["해당 status 반환"]
  JR -->|매칭 없음| T
  JR -->|매칭| R
```

### setStatus

```mermaid
flowchart TD
  A["adapter.setStatus(ref, status)"] --> G{todo or done?}
  G -->|Yes| ERR["throw Error"]
  G -->|No| P{플랫폼별 분기}

  P --> GH["GitHub/Obsidian/Local<br/>관리 라벨 remove → 새 라벨 add"]
  P --> JR["Jira<br/>GET transitions → POST transition"]
```

### listByStatus

```mermaid
flowchart LR
  A["adapter.listByStatus(statuses)"] --> GH["GitHub<br/>list(open, hasLabel:true)<br/>→ deriveStatus 필터<br/>⚠️ 무관 라벨 포함"]
  A --> JR["Jira<br/>JQL: status IN (mapped...)<br/>네이티브 정확 매치"]
  A --> OB["Obsidian/Local<br/>list(open, labels:mapped)<br/>OR 필터"]
```

---

## 플랫폼 전용 확장

### GitHub: PR 관리

```mermaid
flowchart LR
  createPr["createPr(title, body, head, base?)"] --> ghpr["gh pr create → URL → getPrStatus()"]
  getPrStatus["getPrStatus(n)"] --> ghview["gh pr view --json"]
  addPrComment["addPrComment(n, body)"] --> ghcomment["gh pr comment --body"]
  getPrComments["getPrComments(n)"] --> ghapi["gh api repos/.../comments"]
```

### Obsidian: 볼트 & 세션 로깅

```mermaid
flowchart TD
  initVault["initVault()"] --> dirs["mkdir spec/, context/, sessions/"]
  dirs --> claude["context/CLAUDE.md 생성"]

  createLog["createSessionLog(opts)"] --> logFile["sessions/{role}-{branch}-{date}-{uid}.md"]

  appendToLog["appendToLog(path, content)"] --> ts["- timestamp content 추가"]
  appendDecision["appendDecision"] --> appendToLog
  appendSotCandidate["appendSotCandidate"] --> appendToLog
  appendBlocker["appendBlocker"] --> appendToLog

  closeLog["closeSessionLog(path, summary)"] --> summary["세션 종료 요약 추가"]
  syncToSpec["syncToSpec(topic, content)"] --> spec["spec/{topic}.md 생성/업데이트"]
```

---

## StatusMapping (3키)

| 내부 키 | GitHub | Jira | Obsidian | Local |
|---------|--------|------|----------|-------|
| `in-progress` | `in-progress` | `In Progress` | `in-progress` | `in-progress` |
| `reviewing` | `in-review` | `REVIEWING` | `reviewing` | `reviewing` |
| `waiting-merge` | `awaiting-merge` | `WAITING MERGE` | `waiting-merge` | `waiting-merge` |
| `todo` (파생) | open + 라벨 없음 | open + 매핑 없음 | open + 라벨 없음 | open + 라벨 없음 |
| `done` (파생) | closed | statusCategory=done | state: closed | state: closed |

## 데이터 저장 비교

| 항목 | GitHub | Jira | Obsidian | Local |
|------|--------|------|----------|-------|
| 저장소 | GitHub API (원격) | Jira API (원격) | `{n}.md` (로컬) | `issues.json` (로컬) |
| 상태 메커니즘 | label | workflow transition | frontmatter labels | JSON labels |
| 통신 방식 | gh CLI (execFile) | REST API (fetch) | 파일시스템 (fs) | 파일시스템 (fs) |
| 인증 | gh auth | Basic Auth (API토큰) | 없음 | 없음 |
| 페이징 | `--limit` | startAt (POST) | N/A | N/A |
| PR 지원 | ✅ | ❌ | ❌ | ❌ |
| 세션로깅 | ❌ | ❌ | ✅ | ❌ |
