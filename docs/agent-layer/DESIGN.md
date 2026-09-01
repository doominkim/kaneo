# Agent Layer — 설계 문서

> Kaneo tracking fork 위에 얹는 **멀티 에이전트 작업 원장** 레이어.
> 작성 2026-09-01 · 상태: 설계 확정 전 (구현 착수 전)

---

## 1. 문제

여러 모델(Claude, Codex/GPT)과 여러 세션으로 같은 프로젝트를 진행하면 맥락이 흩어진다.

- 세션이 끝나면 **왜 그렇게 했는지**가 사라진다. 코드에는 채택된 결과만 남는다.
- 같은 개념을 세션마다 다르게 부른다 (보험코드 / 청구코드 / 급여코드). 새 세션은 그걸 찾으려 코드베이스를 다시 뒤진다.
- 여러 세션이 같은 파일을 동시에 건드려도 서로 모른다.
- 결과가 **모델의 컨디션에 의존**한다.

### 진짜 목표

> 어떤 모델이든, 몇 번째 세션이든, 같은 질문에 같은 답이 나오는 상태.

모델을 교체 가능한 부품으로 만드는 것. 지식 베이스를 만드는 게 목적이 아니라 **수단**이다.

---

## 2. 지배 원칙

### 2.1 사실은 고정하고 판단은 모델에게

- 모델의 **변덕**은 없앤다 → 사실을 결정론적으로 조회 가능하게
- 모델의 **능력**은 깎지 않는다 → 추론·판단은 모델이 한다

이 둘을 가르는 선이 **사실 / 판단**이다.

> **KB는 사실을 공급하되 판단을 지시하지 않는다.**
> 항목에 "~하는 게 좋다", "~를 주의하라", "~를 먼저 고려하라"가 들어가면 그건 KB 항목이 아니라 룰이다.
> 애매한 프롬프트로 순정 모델의 능력을 막는 것이 최악의 실패다.

### 2.2 항목 자격 게이트 (3개 전부 통과해야 저장)

1. **복원 테스트** — 모델이 코드베이스에서 복원할 수 있나? → 예면 **기각**
2. **부패 테스트** — 6개월 뒤 틀렸을 때 감지·검증 가능한가? → 아니오면 **기각**
3. **지시 테스트** — 판단을 지시하는 문장인가? → 예면 **기각** (룰로 보냄)

**틀린 KB는 KB 없는 것보다 나쁘다.** KB가 없으면 모델이 코드를 읽어 정확한 답을 찾는다(느리지만 맞음). 낡은 KB는 확신에 찬 답을 주고, 모델은 코드 확인을 건너뛴다 → 조용히 틀린다.

### 2.3 AI가 쓰는 면과 사람이 읽는 면을 절대 같은 곳에 두지 않는다

Linear 실패의 단일 원인. AI는 append만 하고 compact를 안 한다. 사람은 길어지면 요약하지만 AI는 계속 덧붙인다.

- 세로로 터짐 → task 페이지 무한 성장
- 가로로 터짐 → 이슈 개수 무한 증가

**프롬프트로 막을 수 없다. 구조로만 막힌다** (append할 데가 없으면 안 한다).

### 2.4 원장은 append-only, 삭제 대신 압축

빈도가 낮은 항목일수록 KB의 한계 효용이 **높다** (자주 쓰는 개념은 어차피 코드에 널려 있고 모델이 맞춘다). 그래서 접근 빈도로 삭제하면 **가장 값비싼 항목부터 지우게 된다.**

감쇠는 **저장이 아니라 인출**에 적용한다. 직접 물으면(`resolve`) 항상 100% 답한다.

---

## 3. 기반 선택 — Kaneo tracking fork

- upstream: https://github.com/usekaneo/kaneo (MIT)
- fork: https://github.com/doominkim/kaneo

### 3.1 왜 Kaneo인가

이미 있어서 만들지 않아도 되는 것:

| 항목 | 비고 |
|---|---|
| 원격 MCP + OAuth (`mcp_oauth_state`, `device_code`, `apikey`) | 직접 만들면 수 주 |
| better-auth 인증 / 초대 / 역할 | |
| `workspace` + `member` + `role` + `team` 테넌시 | |
| billing (creem, seats, trial) | |
| 알림 (email/ntfy/gotify/webhook) + preference | |
| 통합 (github/gitea/slack/discord/telegram) | |
| WebSocket 실시간 | presence 기반 |
| `asset` 첨부 | Linear에서 불편했던 지점 |
| Docker / Helm / Coolify 배포, i18n | |

`AGENTS.md`의 철학도 일치한다: *"Simplicity is a product requirement. Build the smallest model that makes correct behavior obvious."*

### 3.2 조사 결과 (2026-09-01, 정적 분석)

**확장 지점 — 셋 다 열려 있음**

| 층 | 방식 | 비용 |
|---|---|---|
| API | Hono 도메인 모듈. `api.route("/entry", entry)` | 기존 파일 1줄 |
| Web | TanStack 파일 기반 라우팅. `project/$projectId/{board,backlog,calendar,gantt}.tsx` 옆에 파일 추가 | 파일 추가 = 새 탭 |
| DB | Drizzle. `schema.ts`에 테이블 append | 마이그레이션 생성 |

**문제 — MCP 레이어**

1. **API 응답을 그대로 프록시한다.** `run(() => client.json(...))` → `textResult(data)`. 가공·축소가 전혀 없어 응답 예산이 없다. Linear의 토큰 문제가 그대로 재현된다.
2. **툴이 36개.** 툴 정의 자체가 매 세션 컨텍스트를 먹는다. 그리고 `create_task_comment`가 있어 **에이전트가 comment에 무한 append할 경로가 열려 있다.**
3. **`brief` 같은 통합 조회가 없다.** 세션 부팅에 `list_workspaces` → `list_projects` → `list_tasks` → … 왕복 4~5회.

> Kaneo MCP는 "API를 MCP로 노출"한 것이지 "에이전트를 위해 설계"된 것이 아니다. **차별점의 위치가 정확히 여기다.**

4. **Kaneo도 Linear와 같은 데이터 모델을 쓴다.** `commentTable`/`activityTable` 모두 `taskId`에 붙는다. `activity.taskId`는 NOT NULL이라 task 없는 작업(조사, 설계 논의)을 담을 수 없다.

### 3.3 tracking fork 규율

divergent fork가 되면 유지보수가 전부 우리 몫이 되고 upstream 개선을 못 받는다. 아래를 지킨다.

1. **기존 파일 수정은 등록 라인만.** `index.ts`에 라우트 1줄, `schema.ts` 끝에 테이블 append. 그 이상 손대지 않는다.
2. **새 코드는 전부 새 디렉터리.** `apps/api/src/{entry,term,lease}/`. 기존 `comment/`, `activity/`는 읽기만 한다.
3. **마이그레이션은 별도 폴더 + 별도 추적 테이블.**
   당초 `9000_` 번호대를 쓰려 했으나, `drizzle/meta/_journal.json`이 **단일 정렬 JSON 배열**이라 upstream이 마이그레이션을 추가할 때마다 충돌이 확정된다. 그래서 완전히 분리한다.
   - config: `apps/api/drizzle-agent.config.ts` (`out: ./drizzle-agent`)
   - `schema`를 `schema-agent-layer.ts` **하나만** 지정한다. `tablesFilter: ["agent_*"]`는 `generate`에 적용되지 않아 upstream 테이블 37개가 전부 SQL에 섞여 들어갔다(실측). schema 범위를 좁히는 것이 유일하게 동작하는 방법이며, FK는 import를 통해 정상 해석된다.
   - 실행: `migrationsTable: "__drizzle_migrations_agent"` — 기본 `__drizzle_migrations`를 공유하면 두 폴더가 서로의 이력을 덮어쓴다.
   - 결과: upstream의 journal·추적 테이블을 한 글자도 건드리지 않는다.
4. **upstream 정기 merge.** 리듬을 정하고 밀리지 않는다.
5. **MCP는 `tools.ts`를 건드리지 않고 별도 툴셋 파일을 추가**해 등록만 한다.

목적은 퇴로 유지다 — upstream이 같은 방향으로 가면 fork를 버리고 돌아갈 수 있어야 한다. 그것이 성공이다.

---

## 4. 데이터 모델

### 4.1 면 분리

```
comment (기존, 그대로)  →  사람 전용 면
entry   (신규)          →  에이전트 전용 면
```

에이전트는 `comment`를 쓰지 않는다. **MCP 툴에 comment 쓰기를 넣지 않으면 구조적으로 강제된다.**
사람은 `entry`를 직접 읽지 않는다. 렌더된 요약만 본다.
Task 본문은 고정 크기를 유지하고, 증가는 전부 `entry`로 나간다.

### 4.2 추가 테이블 (기존 스키마 무수정)

정의: `apps/api/src/database/schema-agent-layer.ts` (단방향 import, `schema.ts`는 무수정)

| 테이블 | 역할 |
|---|---|
| `agent_actor` | AI 행위자. `provider`, `model`, `on_behalf_of` → 기존 `user` |
| `agent_entry` | append-only 원장. `project_id`, **`task_id` nullable**, `decision` jsonb |
| `agent_lease` | 점유. `task_id`(unique), `session_id`, `expires_at` |
| `agent_term` | 용어사전. `canonical`, `aliases`, `not_to_confuse_with` |

**모든 테이블에 `agent_` prefix를 붙인다.** upstream이 `entry`·`term` 같은 흔한 이름을 나중에 쓸 수 있고, prefix가 있어야 마이그레이션 범위를 이름으로 가를 수 있다.

**ID는 `cuid2`를 쓴다** (Kaneo 관례). 설계 초안에서는 ULID를 고려했으나 일관성이 우선이며, 시간 정렬은 `created_at` 인덱스로 대체한다.

**actor의 신원은 (workspace, user, model)이며 세션 단위가 아니다.** 세션 단위로 만들면 행이 무한 증가한다. `session_id`는 entry와 lease에 기록하므로, 한 사람이 같은 모델의 세션을 여럿 돌려도 구분된다.

`db.query.*`(relational API)를 쓰려면 `database/index.ts`의 `schema` 객체에 등록해야 하지만, **등록하지 않는다** — 그 객체는 upstream이 테이블을 추가할 때마다 수정되어 충돌 지점이 된다. `db.select().from(agentEntryTable)` 형태로 충분하다.

- `on_behalf_of`가 기존 `user`를 참조하므로 권한·알림 체계에 그대로 얹힌다.
- **`entry.task_id`는 nullable이어야 한다.** task 없는 작업(조사, 설계 논의, 실패한 시도)도 원장에 남아야 한다. Kaneo `activity`가 못 하는 지점.

### 4.3 entry가 담는 것

git이 이미 갖고 있는 것은 **참조만** 한다 (commit sha, PR 번호). 복제하면 썩는다.

```
decision: { what, why, rejected, reversible }
```

- **`why`** — 코드에 남지 않는다
- **`rejected`** — 코드에는 채택된 것만 남는다. 복원 확률 0. **가장 값비싼 필드.**
  폐기된 안을 지우면 6개월 뒤 같은 안이 다시 제안된다.

### 4.4 용어사전 (`term`)

```yaml
canonical: 급여코드
aliases: [보험코드, 청구코드, BenefitCode]
not_to_confuse_with: [claim-code]     # 동의어 목록보다 중요
anchors: [{ kind: db, table: benefits, column: benefit_cd }]
confidence: confirmed | proposed | disputed
```

- **`not_to_confuse_with`가 핵심 필드.** "이건 다른 거다"가 사고를 더 많이 막는다.
- 앵커는 **검색으로 못 찾는 매핑만** 담는다. `symbol: BenefitCode`는 grep으로 5초면 나오므로 게이트 1에 걸린다. `보험코드 → benefit_cd`는 검색어가 코드에 없으므로 담는다.
- 모델이 제안한 항목은 `proposed`. 사람이 승인해야 `confirmed`. **자동 승인 금지.**

### 4.5 상태 전이 — 삭제 없음

```
active ──인출 없음──▶ dormant ──인출/검증──▶ active
active/dormant ──앵커 깨짐──▶ stale ──검수──▶ active | retired(tombstone)
```

`dormant`는 검색 랭킹만 낮추고 부팅 팩에서 제외한다. **저장은 그대로**이며 직접 물으면 즉답한다.
`retired`는 삭제가 아니라 tombstone이다 — "무효, 대신 X를 보라".

### 4.6 압축 계층

```
최근 7일 → entry 원본 전부
7~30일   → 주 단위 요약 (decision 보존)
30일+    → decision만 남기고 원본 archive
영구     → decision, rejected
```

삭제가 아니라 **해상도가 낮아지는 것**이다. 압축되는 것은 "파일 3개 수정함" 같은 git이 이미 가진 노이즈뿐이다.

---

## 5. MCP 설계

### 5.0 실측 (2026-09-01, 로컬 기동)

Docker compose로 기동 후 **task 20개 / 코멘트 30개**짜리 장난감 프로젝트에서 측정.
MCP는 API 응답을 무가공 프록시하므로(§3.2) 아래 값이 곧 MCP 응답 크기다.
토큰은 3 bytes/token(한글+JSON 혼합) 근사치.

| MCP 툴 | 실제 응답 | 추정 토큰 |
|---|---|---|
| `list_workspaces` | 163 B | ~54 |
| `list_projects` | 390 B | ~130 |
| **`list_tasks` (20건)** | **18.5 KB** | **~6,200** |
| `get_task` (1건) | 838 B | ~279 |
| **`list_task_comments` (30건)** | **21.1 KB** | **~7,000** |
| **`list_task_activity`** | **24.1 KB** | **~8,000** |
| `list_project_columns` | 958 B | ~319 |

**세션 부팅 시퀀스** (`list_workspaces` → `list_projects` → `list_tasks`): 왕복 3회, 19 KB ≈ **6,400 토큰**.
여기서 task 하나만 열면 comments + activity로 **45 KB ≈ 15,000 토큰**이 더 붙는다.

추가로 툴 정의 자체가 상주한다 — 툴 36~38개, inputSchema 필드 약 106개.
tools/list JSON은 **대략 15~20 KB(≈5,000~7,000 토큰)**로 추정된다(MCP가 OAuth 토큰만 받아 직접 계측은 못 함, 정적 추정).

**결론 세 가지**

1. `list_tasks`가 각 task의 `description` **전문**을 싣는다. task 20개에 6,200 토큰이면 200개짜리 실제 프로젝트는 선형 외삽으로 **62,000 토큰** — 한 번의 호출로.
2. `list_task_activity`(24 KB)가 `list_task_comments`(21 KB)보다 **크다**. 코멘트를 쌓으면 activity 레코드가 함께 늘어 **이중으로 부푼다.**
3. 세션을 열고 task 하나를 보는 것만으로 툴 정의 포함 **약 27,000 토큰**이 소모된다. §2.3의 무한 append 문제가 토큰 비용으로 직결된다는 것이 수치로 확인됐다.

### 5.1 응답 예산을 스키마로 강제

권장이 아니라 **응답 스키마 자체**로 강제한다. 필드가 없으면 과다 응답이 불가능하다.

| 툴 | 상한 |
|---|---|
| `brief(project)` | ~2KB. 진행중 task + 최근 entry + 활성 lease |
| `task_list()` | 제목·상태·담당만. 본문 제외 |
| `log_tail(n)` | 기본 n=10, 요약 라인만 |
| 본문 전체 | 명시 요청 시에만 |

### 5.2 툴 표면 (기존 36개와 별도)

```
brief(project)          세션 부팅 — 왕복 1회
task_list / task_save
log_append / log_tail
lease_acquire / leases
resolve(term)
```

**8개를 넘기지 않는다.** comment 쓰기 툴은 넣지 않는다(§4.1).

### 5.3 handoff는 기능이 아니라 결과다

문서를 만들어 넘기는 방식은 실패한다 — 요약하며 정보가 죽고, 넘길 시점을 판단해야 하고, 받는 쪽이 안 읽을 수 있다.

**공유 상태를 양쪽이 읽으면 handoff가 저절로 된다.** push가 아니라 pull이다. 별도로 만들 것이 없다.

---

## 6. 사람 뷰

프로젝트 하위 탭으로 추가한다 (`project/$projectId/` 아래 파일 추가).

| 탭 | 내용 |
|---|---|
| 개요 | 목표 / 현재 상태 / 지금 누가 무엇을 잡고 있나 |
| 태스크 | 기존 Kaneo 뷰 (board/backlog/…) |
| 지식 | 용어사전, 결정 목록 |
| 메모 | 타임라인 (최근 20 + 드릴다운), 코어 변경 하이라이트 |

### 6.1 하드 리밋

- `done`은 기본 접힘, 30일 후 아카이브
- 타임라인은 최근 20개. 그 이상은 드릴다운
- 활성 task가 임계치를 넘으면 경고 (워킹셋이 부푸는 신호)

### 6.2 "코어 변경"은 결정론으로 판정한다

모델이 판단하면 세션마다 달라진다 — 없애려는 그 변덕이다. 경로 패턴을 사람이 프로젝트당 한 번 정의하고, `git diff --name-only`와 매칭한다.

```yaml
core_paths:
  - src/domain/**
  - "**/migrations/**"
```

### 6.3 HTML은 캐시다

원본은 DB이고 렌더 결과는 파생물이다. 보관 대상이 아니므로 "어디 저장하지" 문제가 발생하지 않는다.

---

## 7. 안 하기로 한 것 (근거 포함)

> 3개월 뒤 반드시 다시 논쟁이 붙는다. 근거 없이 재론하지 않는다.

| 항목 | 기각 근거 |
|---|---|
| **개념 관계 그래프 (온톨로지)** | 모델이 코드를 읽어 더 잘한다(게이트 1). 낡으면 모델을 틀린 방향으로 끌고 간다 |
| **코드베이스 RAG** | codegraph/grep으로 충분. 모델이 직접 읽는 게 정확하다 |
| **전면 코드 앵커** | grep으로 찾히는 앵커는 stale 관리 비용만 늘고 이득이 0 |
| **세션 부팅 팩 push** | 안 쓰일 정보가 컨텍스트를 오염시킨다. ID만 주고 pull하게 한다 |
| **빈도 기반 삭제** | 희소 항목이 가장 값비싸다(§2.4). 랭킹만 낮춘다 |
| **AI용/사람용 저장소 분리** | 두 개의 진실이 생겨 반드시 갈라진다. **저장은 하나, 렌더링을 나눈다** |
| 사이클/스프린트, 로드맵, 번다운 | 타겟(에이전트를 굴리는 소규모 팀)에 불필요 |
| 인앱 알림 센터 | Kaneo 기존 알림으로 충분 |
| 세분화된 권한 | workspace 멤버 = 전체 접근으로 시작 |
| Org 계층 추가 | Kaneo `workspace`가 최상위. 돈 목적이 아니므로 불필요 |

---

## 8. 단계

| Phase | 내용 | 완료 조건 |
|---|---|---|
| **0** | 스키마 확정 (4테이블, 마이그레이션 번호대, actor 모델) | 되돌리기 비싼 결정 완료 |
| **1** | API 모듈 + 에이전트 MCP 툴셋 + 4탭 뷰 | **dogfooding 시작, Linear 종료** |
| 2 | Linear export → entry 흡수 | 열린 이슈만 Task로, 닫힌 이슈는 entry 1개로 압축. 코멘트는 가져오지 않는다 |
| 3 | 압축 계층 (§4.6) | entry가 쌓인 뒤 |
| 4 | consolidation → 용어사전 승격 | 반복 등장 개념을 제안 큐로 |

**Phase 1이 끝나면 Linear를 끌 수 있다.** 3·4는 데이터 없이는 설계할 수 없다(cold start).

### 승격 파이프라인 (Phase 4)

```
entry N개에 같은 용어 반복 등장
  → consolidation 배치가 제안 큐에 올림
  → 사람 승인
  → term(confirmed) 진입
```

빈도는 **삭제가 아니라 승격**에 쓴다.

---

## 9. Linear를 대체하는 이유

사용 후기를 원인별로 가르면:

| 문제 | 돈으로 풀리나 |
|---|---|
| 이슈 한도 | ✅ 유료 전환 |
| 느림 / 토큰 과다 | ❌ 원격 API + 과다 응답 |
| 이슈 과다 시 UI 과밀 | ❌ flat list 설계 |
| AI의 무한 append로 사람이 못 읽음 | ❌ 쓰기면 = 읽기면 구조 |

4개 중 3개가 구조적이라 유료 전환으로 풀리지 않는다.

**주의: 같은 실패를 반복하지 않으려면 §5.1(응답 예산)과 §4.1(면 분리)이 반드시 지켜져야 한다.** Kaneo를 그대로 쓰면 같은 벽을 다시 만난다.

---

## 10. 미결

1. 레이어 이름 (현재 `agent-layer`는 임시)
2. Entry 생성 주체 — 세션 종료 hook 자동 draft vs 에이전트가 `log_append` 호출.
   섞는 쪽이 유력: 자동 draft + 에이전트가 `decision`만 채움
3. 커밋 트레일러로 작업자를 구분할지 — 사용자 전역 룰(`30-safety.md`)이 AI `Co-Authored-By` 트레일러를 금지하고 있어 충돌한다. 트레일러 없이 entry에서만 추적하는 방안 검토
4. upstream merge 주기
5. ~~MCP 실측~~ → **완료** (§5.0). 남은 것: tools/list 실크기 계측에 OAuth 플로우 통과 필요
6. Kaneo 커뮤니티에 문제 제기 시점 — 작동하는 것을 보여준 뒤가 유리하나, "이 문제 겪고 계신가요"라는 **질문**은 비용 0이므로 선행 가능

---

## 부록 — 검증 상태

| 주장 | 근거 |
|---|---|
| 확장 지점 3층 개방 | 코드 정적 분석 (2026-09-01) |
| MCP 응답 무가공 프록시 | `apps/api/src/mcp/tools.ts:94` `run()` |
| 툴 36개 | `tools.ts` `registerTool` 호출 계수 |
| `activity.taskId` NOT NULL | `apps/api/src/database/schema.ts` |
| 마이그레이션 `0044`까지 | `apps/api/drizzle/` |
| upstream 활성 | 최근 커밋 2026-08-31 (PR #1677) |
| **응답 크기 실측** | ✅ 로컬 기동 후 계측 (§5.0). Docker compose, task 20 / 코멘트 30 |
| MCP tools/list 크기 | ⚠️ **정적 추정** — MCP가 OAuth 토큰만 받아 직접 계측 실패 (apikey·세션쿠키 모두 401) |
| 대규모 프로젝트 수치 | ⚠️ **선형 외삽** — task 200개는 실측 아님 |
| Web 탭 추가 난이도 | ⚠️ 미검증 — 파일 추가만으로 되는지 실제로 안 해봄 |

### Phase 0 스키마 검증 (2026-09-01, 로컬 Postgres 실적용)

| 검증 | 결과 |
|---|---|
| `pnpm typecheck` | ✅ 에러 0 (`packages/**` 빌드 후) |
| 생성 SQL 범위 | ✅ `CREATE TABLE`이 agent 4개만. FK는 upstream 4개 테이블 정상 참조 |
| 마이그레이션 적용 | ✅ `ON_ERROR_STOP=1`로 무오류 |
| actor 구분 | ✅ `anthropic/claude-opus-5`, `openai/gpt-5.6` 동시 기록 |
| **task 없는 entry** | ✅ `task_id IS NULL`로 조사·설계 기록 저장됨 |
| `decision.why` / `rejected` | ✅ jsonb 왕복 무손실 |
| **term 역방향 조회** | ✅ `aliases ? '보험코드'` → `급여코드` + `benefit_cd` 반환 |
| lease 중복 점유 | ✅ `agent_lease_task_unique` 위반으로 차단됨 |
| **task 삭제 시 원장 보존** | ✅ task 삭제 후에도 entry 잔존, `task_id`만 NULL |

마지막 항목이 upstream과의 결정적 차이다. `activity.task_id`는 `ON DELETE CASCADE`라 task가 사라지면 이력도 함께 사라진다. `agent_entry`는 `SET NULL`이므로 **기록이 살아남는다.** 원장이 원장이려면 이래야 한다.
