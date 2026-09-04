# Agent Layer — 설계 문서

> Kaneo tracking fork 위에 얹는 **멀티 에이전트 작업 원장** 레이어.
> 작성 2026-09-01 · 상태: 설계 확정 전 (구현 착수 전)
> 개정 2026-09-02 — 사람 뷰 5탭, 개요=파생 이력 뷰(핸드오프 + 타임라인 트리), `agent_document`·`agent_project` 테이블, entry에 `refs.branch`·`effort`·`usage`, core_paths 서버 측 판정, MCP 툴 10개 (KAN-6)
> 개정 2026-09-03 — §2.3 면 분리 폐기 — 원장은 사람·AI 공용 노트, 작성자만 표시 (KAN-12)
> 개정 2026-09-04 — 어휘: 사람이 보는 이름은 "용어"가 아니라 **지식 항목**. 검수 자리는 지식 탭에서 도메인 페이지로 이동 (KAN-16, §4.4·§6)

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

### 2.3 노트는 하나, 작성자만 다르다

Linear 실패 자체는 실재한다. AI는 append만 하고 compact를 안 한다. 사람은 길어지면 요약하지만 AI는 계속 덧붙였고, 형식 없는 자유 텍스트 로그가 뒤섞여 사람이 읽을 수 없게 됐다.

- 세로로 터짐 → task 페이지 무한 성장
- 가로로 터짐 → 이슈 개수 무한 증가

**프롬프트로 막을 수 없다. 구조로만 막힌다.** 다만 여기서 말하는 구조는 **작성자를 가르는 것이 아니다**(2026-09-03 개정, KAN-12). 실제로 문제를 푼 것은 원장의 **형식**이다 — 고정된 `kind`·`summary`·`body`·`refs`·`decision`, append-only, 그리고 그 형식을 렌더하는 사람 뷰. 못 읽었던 원인은 형식의 부재였지 사람과 AI가 같은 곳에 썼다는 사실이 아니었다.

그래서 **원장(`agent_entry`)은 사람과 에이전트가 함께 쓰는 하나의 노트 스트림**이다. 사람은 UI에서 쓰고 에이전트는 `agent_log_append`로 쓴다. 보이는 차이는 작성자 표시뿐이다.

- Task 본문은 **명세**다. 진행 로그는 본문에 쌓지 않고 전부 원장으로 나간다.
- 산출물은 문서·아티팩트 보관함이 받는다(§4.2, §6).
- **코멘트는 upstream의 기능이며 이 레이어의 일부가 아니다.** "에이전트는 코멘트를 쓰지 않는다"는 규칙은 폐기한다 — 사람이 명시적으로 요청하면 에이전트도 task 코멘트를 쓸 수 있다.

### 2.4 원장은 append-only, 삭제 대신 압축

빈도가 낮은 항목일수록 KB의 한계 효용이 **높다** (자주 쓰는 개념은 어차피 코드에 널려 있고 모델이 맞춘다). 그래서 접근 빈도로 삭제하면 **가장 값비싼 항목부터 지우게 된다.**

감쇠는 **저장이 아니라 인출**에 적용한다. 직접 물으면(`resolve`) 항상 100% 답한다.

**삭제 대신 숨김.** 원장 행은 수정도 삭제도 되지 않는다. 사람이 지운 행은 `deleted_at`/`deleted_by`만 찍히고 다른 열은 그대로 남는다(soft delete, `drizzle-agent/0006`). 기본 읽기(목록·단건·`agent_brief`·`agent_log_tail`·`agent_entry_get`·트리 집계·최신 handoff 선택)는 숨긴 행을 제외하고, `project:update`를 가진 사람만 `includeDeleted=true`로 다시 볼 수 있으며 같은 권한으로 복구한다. 숨길 수 있는 사람은 그 행의 사람 작성자 본인 또는 `project:update` 보유자다 — 에이전트 행에는 사람 작성자가 없으므로 후자만 해당한다. 지식 항목(§4.4)은 반대로 `proposed` 상태에서만 하드 삭제한다: 아직 아무도 의존하지 않은 제안이기 때문이며, 확정된 항목은 삭제 대신 `retired` 툼스톤으로 남긴다.

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
| Web | TanStack 파일 기반 라우팅. `project/$projectId/{board,backlog,calendar,gantt}.tsx` 옆에 파일 추가 | 파일 추가 = 새 **라우트**. 탭 노출은 upstream 컴포넌트 2개 수정 필요 (부록 참조) |
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

### 4.1 작성 주체

`agent_entry`는 사람과 에이전트가 공유하는 하나의 노트 스트림이다(§2.3). 행마다 작성자는 정확히 하나다.

- 에이전트가 쓰면 `actor_id`(`agent_actor`)가 채워진다.
- 사람이 UI에서 쓰면 `actor_id`는 NULL이고 사람 저자 컬럼이 채워진다. 스키마에 사람 저자 컬럼이 없으면 nullable `created_by`(FK `user`, `SET NULL`)를 `drizzle-agent/0004`로 추가한다.
- 사람 뷰는 저자만 다르게 렌더한다 — 사람은 이름, 에이전트는 `provider/model`(+`agent_label`).

Task 본문은 고정 크기(명세)를 유지하고, 증가는 전부 `entry`로 나간다.

### 4.2 추가 테이블 (기존 스키마 무수정)

정의: `apps/api/src/database/schema-agent-layer.ts` (단방향 import, `schema.ts`는 무수정)

| 테이블 | 역할 |
|---|---|
| `agent_actor` | AI 행위자. `provider`, `model`, `on_behalf_of` → 기존 `user` |
| `agent_entry` | append-only 원장. `project_id`, **`task_id` nullable**, `decision` jsonb, `effort`·`agent_label`·`usage`(§4.3) |
| `agent_lease` | 점유. `task_id`(unique), `session_id`, `expires_at` |
| `agent_term` | 지식 항목(§4.4). `canonical`, `aliases`, `not_to_confuse_with` |
| `agent_document` | 사람이 읽는 산출물. `project_id`+`slug` unique, **`task_id` nullable**(FK task, `SET NULL`), `title`, `body`(markdown), `updated_by`(user, nullable) / `actor_id`(`agent_actor`, nullable), `updated_at` |
| `agent_project` | 프로젝트별 설정. `project_id` PK, `core_paths` jsonb, `active_task_threshold`(기본 20), `done_archive_days`(기본 30) |
| `agent_domain` | 워크스페이스 도메인 지식 페이지 트리(§4.7). `workspace_id`, `parent_id`(self, `SET NULL`), `slug`(레벨별 unique), `title`, `body`(markdown), `position`, `updated_by` / `actor_id` |
| `agent_project_domain` | 프로젝트 ↔ 도메인 페이지 링크. PK (`project_id`, `domain_id`), 양쪽 `CASCADE` |

**모든 테이블에 `agent_` prefix를 붙인다.** upstream이 `entry`·`term` 같은 흔한 이름을 나중에 쓸 수 있고, prefix가 있어야 마이그레이션 범위를 이름으로 가를 수 있다.

`agent_document`는 **에이전트가 만든 사람용 산출물**이 1차 용도다 — 세션 리포트, 설계 패킷처럼 원장 entry 한 건에 담기엔 크고 사람이 통째로 읽어야 하는 글. 사람도 같은 면에 쓴다. 여기서 막아야 할 것은 무한 append이고, 그것은 slug 단위 **덮어쓰기**로 막힌다.

- 저자 출처: `updated_by`(사람)와 `actor_id`(에이전트) 중 **쓰기 한 번에 정확히 하나**만 채운다. 어느 쪽이 썼는지가 문서를 읽는 판단의 절반이다.
- 본문은 덮어쓰기(+`updated_at`)다. §2.4 append-only는 원장의 원칙이지 산출물에 적용하지 않는다. 버전 이력이 필요해지면 `agent_document_revision`을 얹는다(§10).
- `task_id`는 선택이다. 채우면 개요 트리에서 그 task 아래 잎으로 붙고(§6), task가 지워져도 문서는 `SET NULL`로 살아남는다 — 원장과 같은 규율이다.
- 파일·이미지 첨부는 1a'의 fork 전용 `agent_artifact`로 간다(§6, §10). upstream 업로드 경로는 MIME을 거부하지 않지만 `taskId`·`surface`에 묶이고 inline 열람 URL이 없다.

`agent_project`는 행이 없으면 기본값으로 응답한다. 여기 담기는 것은 본문이 아니라 **설정**이므로 문서와 분리한다.

**ID는 `cuid2`를 쓴다** (Kaneo 관례). 설계 초안에서는 ULID를 고려했으나 일관성이 우선이며, 시간 정렬은 `created_at` 인덱스로 대체한다.

**actor의 신원은 (workspace, user, model)이며 세션 단위가 아니다.** 세션 단위로 만들면 행이 무한 증가한다. `session_id`는 entry와 lease에 기록하므로, 한 사람이 같은 모델의 세션을 여럿 돌려도 구분된다.

`db.query.*`(relational API)를 쓰려면 `database/index.ts`의 `schema` 객체에 등록해야 하지만, **등록하지 않는다** — 그 객체는 upstream이 테이블을 추가할 때마다 수정되어 충돌 지점이 된다. `db.select().from(agentEntryTable)` 형태로 충분하다.

`agent_entry`의 `effort`·`agent_label`·`usage`는 **nullable 컬럼 추가**이므로 `drizzle-agent/0001`에 `agent_document`와 함께 `ALTER TABLE agent_entry ADD COLUMN` 으로 들어간다. 기존 행은 그대로 두고 값은 NULL이다.

- `on_behalf_of`가 기존 `user`를 참조하므로 권한·알림 체계에 그대로 얹힌다.
- **`entry.task_id`는 nullable이어야 한다.** task 없는 작업(조사, 설계 논의, 실패한 시도)도 원장에 남아야 한다. Kaneo `activity`가 못 하는 지점.

### 4.3 entry가 담는 것

`kind`는 네 값 중 하나다 (`apps/api/src/agent-entry/schema.ts`의 enum이 정본, 기본값 `work`).

| kind | 뜻 |
|---|---|
| `work` | 실제로 무언가를 바꾼 작업 단위. 커밋·파일 변경이 따라오는 것이 보통이다 |
| `investigation` | 조사·분석. 코드는 바뀌지 않았고 알아낸 사실만 남긴다. task 없이도 기록한다 |
| `decision` | 방향 선택. `decision.why`·`rejected`를 채우는 것이 목적이며 코드 변경 여부와 무관하다 |
| `handoff` | 세션 종료 시 다음 세션에게 넘기는 상태 요약. 개요 탭 콜아웃이 최신 handoff를 집는다(§6) |

git이 이미 갖고 있는 것은 **참조만** 한다 (commit sha, PR 번호). 복제하면 썩는다.

```
refs: { repo, branch, commits, prs, files }
```

```
actor_id:   FK agent_actor  — 에이전트가 썼을 때. 응답에는 actor{id, provider, model, onBehalfOf}
created_by: FK user         — 사람이 UI에서 썼을 때 (0004). 응답에는 author{userId, name}
```

행마다 둘 중 정확히 하나가 채워진다(§4.1, 앱 레벨 강제). `POST /api/agent-entry`는 `provider`+`model`이 둘 다 오면 에이전트 entry, 둘 다 없으면 호출자를 `created_by`로 하는 사람 entry로 저장하고, 하나만 오거나 사람 entry에 `effort`·`agent_label`·`usage`가 실리면 400이다. MCP `agent_log_append`는 에이전트 전용이라 `provider`·`model`이 계속 필수다. 트리 롤업(§6)에서 사람 entry는 `entryCount`에는 들지만 `byModel`에는 들지 않는다 — usage를 가질 수 없기 때문이다.

`repo`(`doominkim/kaneo`)와 `branch`(`agent-layer`)는 선택 필드이고 `agent_log_append` 입력이 받는다. **git 작업이었다면 브랜치는 반드시 기록한다** — 어느 브랜치에서 한 일인지는 commit sha만으로는 세션 밖에서 복원되지 않으며, 병합 전 작업이 어디 있는지 사람이 찾는 첫 단서다.

```
effort:      low | medium | high | xhigh | max
agent_label: "3setter" | "codex" | …          하네스 로스터 이름
usage:       { inputTokens, outputTokens, totalTokens, cacheReadTokens? }
```

누가·얼마나 들여 한 일인지는 **모델(provider·model)만으로는 부족하다.** 같은 모델도 effort에 따라 결과와 비용이 갈린다. provider·model은 `agent_actor`에 남고, 이 셋은 entry마다 다르므로 entry에 남는다. 셋 다 선택 필드다.

- `effort`·`agent_label`은 `agent_log_append` 호출자가 넘긴다.
- **`usage`는 모델이 스스로 모른다.** 하네스가 준다. 경로 둘: (a) 매니저가 subagent 완료 알림에서 받은 값을 그대로 넘긴다, (b) Phase 1c에서 하네스 훅(Claude Code `SubagentStop`, `~/.claude/ballclub/events/`)이 자동으로 붙인다.
- **원장은 append-only이므로 나중에 온 usage로 기존 행을 고치지 않는다.** 원 entry id를 참조하는 `kind: work` entry를 새로 쓴다. 트리·개요의 합계는 어차피 task 단위 합산이므로 어느 쪽이든 총량은 맞는다.

```
decision: { what, why, rejected, reversible }
```

- **`why`** — 코드에 남지 않는다
- **`rejected`** — 코드에는 채택된 것만 남는다. 복원 확률 0. **가장 값비싼 필드.**
  폐기된 안을 지우면 6개월 뒤 같은 안이 다시 제안된다.

### 4.4 지식 항목 (저장은 `agent_term`)

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

**이름 규약 (2026-09-04, KAN-16).** 여기 저장되는 한 건은 이름 붙은 **검수된 사실**이다 — canonical 이름에 정의·별칭·혼동 금지 목록·DB/코드 앵커가 붙는다. 사람 면과 문서에서는 이것을 "지식 항목"이라 부른다. "용어"는 담기는 것보다 좁아서, 이름 붙은 규칙("보험코드 필수 규칙")이나 매핑을 여기 넣기를 주저하게 만들었다.

- **지식 항목** = 이름 있음, 검수 있음. 사람이 확정하기 전까지 에이전트가 읽지 못한다.
- **도메인 페이지 본문**(§4.7) = 이름 없는 서술. 검수를 거치지 않고 바로 읽히되 마지막 작성자와 갱신 시각이 함께 나온다.

이 구분이 **모델을 이름 기반으로 유지하는 근거**다. `agent_term_resolve`는 이름으로 정확히 일치시키는 결정적 조회이고 임베딩·랭킹·모델 판단을 쓰지 않는 것이 §2.1의 핵심이므로, 저장되는 모든 항목에는 이름이 있어야 한다. 이름을 붙일 수 없는 서술은 지식 항목이 아니라 도메인 페이지 본문이다.

**식별자는 바꾸지 않는다.** DB 테이블 `agent_term`, API `/api/agent-term`, MCP `agent_term_resolve`·`agent_term_propose`, 웹 컴포넌트 `TermList`·`TermRow`는 그대로 둔다. Claude·Codex 두 하네스가 이미 그 툴 이름으로 붙어 있어 바꾸면 배포 순간 양쪽이 깨진다. 도메인 언어와 저장소 이름을 분리하는 통상적 처리이며 **의도된 것**이다 — 어느 한쪽을 다른 쪽에 맞추려고 고치지 않는다.

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

### 4.7 도메인 지식 (`agent_domain`, 2026-09-03 승인)

프로젝트는 일이 흐르는 단위이고 **의미는 프로젝트를 가로지른다** — "입고내역"이 무엇인지는 약국 프로젝트 셋이 공유한다. 그래서 도메인 지식은 워크스페이스 단위 **페이지 트리**로 두고, 프로젝트·지식 항목·문서가 페이지를 **가리키게** 한다. 페이지는 링크된 것을 복사하지 않고 조회 시 집계한다(§2.1 — 사실은 한 곳에만).

| 항목 | 정의 |
|---|---|
| 테이블 | `agent_domain`: `id`, `workspace_id`, `parent_id`(self FK, `SET NULL`), `slug` `^[a-z0-9][a-z0-9-]{0,63}$`, `title`(≤200), `body`(markdown ≤200KB, 기본 `''`), `position`(형제 순서, 기본 0), `updated_by`(user) / `actor_id`(agent_actor), `created_at`/`updated_at`(앱 시계) |
| 유일성 | `(workspace_id, parent_id, slug)` UNIQUE + 루트용 partial unique index `(workspace_id, slug) WHERE parent_id IS NULL`. Postgres는 UNIQUE에서 NULL을 서로 다르게 보므로 복합 제약만으로는 루트 slug 중복을 못 막는다 |
| 인덱스 | `(workspace_id, parent_id)` — 트리 조회 |
| 링크 | `agent_term.domain_id`, `agent_document.domain_id`(둘 다 nullable, `SET NULL`), `agent_project_domain(project_id, domain_id)` PK·양쪽 `CASCADE` |
| 마이그레이션 | `drizzle-agent/0007_agent_domain.sql` — 추가만, 기존 행 무변경 |
| 저자 | 문서와 같은 규칙: 쓰기 한 번에 `updated_by`(사람, HTTP)와 `actor_id`(에이전트, MCP) 중 정확히 하나. 이동(move)은 저자를 바꾸지 않는다 |

**API** (`/api/agent-domain/{workspaceId}`, 전부 `workspaceAccess.fromParam`):

| 라우트 | 권한 | 동작 |
|---|---|---|
| `GET /{ws}` | 접근 | 평면 목록 `{domains:[{id,parentId,slug,title,position,updatedAt,childCount}]}`, `(parentId NULLS FIRST, position, title)` 순. 트리는 클라이언트가 조립 |
| `POST /{ws}` | `task:update` | `{parentId?, slug, title, body?}`. 부모가 워크스페이스 밖이면 400, 같은 레벨 slug 충돌 409. 형제 중 마지막 `position` |
| `GET /{ws}/{id}` | 접근 | 페이지 + `author{userId,name}`/`actor` + `ancestors`(루트→부모), `children`, `terms`, `projects`, `documents` |
| `PUT /{ws}/{id}` | `task:update` | `{title?, body?}` 중 하나 이상. body는 전체 교체. `updated_by`=호출자, `actor_id`=NULL |
| `POST /{ws}/{id}/move` | `workspace:update` | `{parentId\|null, position?}`. 자기 자신·자손 아래로는 400, 대상 레벨 slug 충돌 409 |
| `DELETE /{ws}/{id}` | `workspace:update` | 자식·지식 항목·문서·프로젝트 링크가 하나라도 있으면 409(개수 명시), 없으면 hard delete |

링크 쪽 변경: `PUT /api/agent-project/{projectId}`에 `domainIds?: string[]`(≤20, 전부 그 워크스페이스 페이지여야 하며 아니면 400; **보내면 전체 교체, 안 보내면 무변경** — 옛 폼이 링크를 지우지 못하게), `GET`은 `domainIds`와 `domains[{id,slug,title}]`를 함께 돌려준다. `POST /api/agent-term`에 `domainId?`, `PATCH /api/agent-term/{ws}/{termId}/domain {domainId|null}`(`workspace:update` — 지식 항목이 어디 속하는지는 검수와 같은 게이트). `PUT /api/agent-document/{project}/{slug}`에 `domainId?`(같은 워크스페이스, 아니면 400; 전체 교체라 생략하면 해제).

**MCP** (§5.2): `agent_domain_list(workspaceId)` — 평면 트리 id/parentId/slug/title 200개 상한. `agent_domain_get(workspaceId, domainId? | slugPath?, offset?)` — `slugPath`는 루트→자식 slug를 `/`로 이은 것(`billing/refunds`)이고 트리를 받아 프로세스 안에서 순수 함수로 푼다(`agent-domain/slug-path.ts`, DB 없이 단위 테스트). 본문은 `doc_get`과 같은 8KB 바이트 창 + `nextOffset`, 링크(지식 항목·프로젝트·문서·자식)는 이름만 20개씩(`linksTotal`로 잘린 수 표시). `agent_domain_put(workspaceId, domainId? | parentId?+slug, title, body, provider, model)` — upsert, `agent-direct`로 프로세스 내 호출해 `actor_id` 기록(`task:update`). `agent_brief`에 프로젝트에 링크된 페이지 `domains[{id,title}]`(10개 상한)가 붙는다.

**slug는 ASCII다.** 한글 제목은 `title`에 두고 slug는 `[a-z0-9-]`로 쓴다. `slugPath`도 slug 기준이므로 `약국/입고내역` 같은 경로는 400이다 — 사람 뷰는 title로 표시하고 경로는 slug로 만든다.

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

`agent_log_append` 입력에 `effort`·`agentLabel`·`usage`를 더한다(모두 선택). 스칼라 셋과 정수 네 개라 **수십 바이트**이며 예산에 영향이 없다.

### 5.2 툴 표면 (기존 36개와 별도)

```
brief(project)          세션 부팅 — 왕복 1회
task_list / task_save
log_append / log_tail
lease_acquire / leases
resolve(term)
doc_get(project, slug, offset?)  8KB(바이트) 창 + nextOffset 이어읽기. UTF-8 문자 경계 보장
doc_put(project, slug)  title + body(≤200KB) 덮어쓰기. lease 불필요. actorId 기록
artifact_put_text(project, name, contentType, text, taskId?)   ≤200KB 텍스트(html/md/json/txt)를 서버가 S3에 쓰고 즉시 확정. actorId 기록
artifact_presign(project, name, contentType, size, taskId?)    큰 파일·zip·pdf: presigned PUT URL 반환. 바이트는 MCP를 타지 않는다 — 에이전트가 curl -T 로 올린다
artifact_finalize(project, artifactId, storageKey)             HeadObject 검증 후 확정(멱등)
domain_list(workspace)                                         도메인 페이지 평면 트리(id/parentId/slug/title, ≤200)
domain_get(workspace, domainId? | slugPath?, offset?)          페이지 메타 + 8KB 본문 창 + 링크 이름(지식 항목·프로젝트·문서·자식 각 ≤20)
domain_put(workspace, domainId? | parentId?+slug, title, body) upsert. actorId 기록. body 전체 교체
```

**툴 개수 상한은 두지 않는다(2026-09-03 개정).** 대신 정의 크기 예산으로 관리한다: `tools/list` 기준 `agent_*` 툴 정의(이름·설명·inputSchema) 합계 **12,288B 이하**, 툴 하나 **2,560B 이하**. `tests/api/mcp-agent-tools-budget.test.ts`가 실제 핸들러의 `tools/list`를 직렬화해 측정하고 초과 시 실패한다. 실측(2026-09-03, 13개 툴): 합계 **9,258B**, 최대 `agent_log_append` **2,148B** — 이 툴은 inputSchema만 1,695B(필드 14개·중첩 객체 3개)라 초안의 2KB로는 `decision.why`/`rejected`를 설명할 설명문이 들어가지 않아 2.5KB로 조정했다. 도메인 툴 3개 추가 후 재실측(2026-09-03, 16개 툴): 합계 **11,924B**(잔여 364B), 최대 `agent_log_append` **2,207B**, `agent_domain_put` 894B·`agent_domain_get` 613B·`agent_domain_list` 396B. `doc_put`·`term_propose`의 `domainId`와 `brief`의 `domains` 설명이 나머지 증가분이다. 다음 툴을 추가하려면 기존 설명을 줄이거나 예산을 재산정해야 한다. 참고로 upstream 36개 툴 합계는 16,455B다. 근거: 툴 정의는 세션마다 상주하지만 하네스마다 비용 모델이 다르다 — Claude Code는 지연 로딩이라 개별 스키마 크기가 비용이고, Codex처럼 전체 스키마를 싣는 클라이언트는 개수×크기가 비용이다. 개수는 그 비용을 대표하지 못한다. 산출물 바이트를 MCP JSON에 싣는 단일 업로드 툴(base64)은 기각 — 1MB html이 약 35만 토큰이 된다.
`doc_put`·`artifact_put_text`·`artifact_presign`·`domain_put`은 HTTP를 거치지 않고 프로세스 내에서 컨트롤러를 직접 호출한다(`apps/api/src/mcp/agent-direct.ts`). MCP가 API를 부를 때 쓰는 bearer는 사용자의 일반 세션 토큰이라 API 쪽에서 MCP 호출과 `curl`을 구분할 수 없고, 따라서 `actorId`를 HTTP 필드·헤더로 열면 누구나 에이전트 저자를 사칭할 수 있다. 직접 호출 경로에서도 인가는 HTTP와 같은 원시 함수(`validateWorkspaceAccess`, `hasWorkspacePermission`, `task:update`)로 다시 수행한다.
`doc_put`은 산출물을 남기는 경로다 — 세션 리포트를 사람에게 넘기는 유일한 쓰기 면이며, 원장 entry를 부풀리는 대신 여기로 나간다. slug 단위 덮어쓰기라 무한 append가 구조적으로 불가능하고, task를 잡지 않는 조사·설계 세션도 써야 하므로 lease를 요구하지 않는다.
`brief`에는 문서 목록(`slug`/`title`/`updatedAt`)만 싣고 본문은 `doc_get`으로만 나간다(§5.1 예산).
**문서는 산출물이지 KB가 아니다.** §2.2의 자격 게이트는 지식 항목(`agent_term`, §4.4)에 적용되는 것이고 문서에는 적용하지 않는다 — 대신 문서는 저자 종류(사람/에이전트)와 `updatedAt`을 함께 실어 낡음이 보이게 한다. 툴 설명에도 명시한다.

### 5.3 handoff는 기능이 아니라 결과다

문서를 만들어 넘기는 방식은 실패한다 — 요약하며 정보가 죽고, 넘길 시점을 판단해야 하고, 받는 쪽이 안 읽을 수 있다.

**공유 상태를 양쪽이 읽으면 handoff가 저절로 된다.** push가 아니라 pull이다. 별도로 만들 것이 없다.

---

## 6. 사람 뷰

프로젝트 하위 탭으로 추가한다 (`project/$projectId/` 아래 파일 추가).

| 탭 | 내용 |
|---|---|
| 개요 | 사람이 쓰는 프로젝트 설명(`agent_document` 예약 slug `overview`, 편집 `task:update`·삭제 `project:update`) + 최신 핸드오프 콜아웃(사람·에이전트 무관) + 라이브 섹션(열림/완료·lease) |
| 타임라인 | 태스크 타임라인 트리 — **세로**, 최신이 위, 자식은 들여쓰기. task를 펼치면 그 task의 원장 entry(최근 20 + 드릴다운)가 인라인으로 나오고, 그 자리에서 사람이 직접 entry를 쓸 수 있다 (2026-09-03: 메모 탭을 흡수) |
| 태스크 | 기존 Kaneo 뷰 (board/backlog/calendar/gantt). 상단 탭 아래 2단 스위처로 유지 |
| 지식 | **확정된 지식 항목**(§4.4) 목록과 결정 목록. 읽기 전용이다 — 확정·이의는 도메인 페이지에서 한다(2026-09-04, KAN-16) |
| 도메인 (사이드바, 워크스페이스 단위) | `agent_domain` 페이지 트리(§4.7). 프로젝트 탭이 아니라 워크스페이스 사이드바 항목 "도메인"으로, 왼쪽에 트리·오른쪽에 페이지(markdown 본문 + 저자·시각 + 링크된 지식 항목·프로젝트·문서 집계). 생성·편집 `task:update`, 이동·삭제 `workspace:update`. 사람과 에이전트가 같은 페이지를 쓴다. **지식 항목 검수가 여기서 일어난다**(2026-09-04, KAN-16): 확정/미확정/이의 필터와 확정·이의 버튼이 페이지에 붙고, 사이드바 도메인 항목에는 미검수 건수 배지가, 목록 맨 아래에는 페이지가 아닌 고정 "미분류" 항목이 있다 |
| 문서 | 프로젝트를 진행하며 쌓이는 **산출물·파일 보관함**. `agent_artifact`(html 리포트·zip·pdf·md·json: 업로드·보기·다운로드·삭제)가 중심이고 `agent_document`(마크다운 텍스트, MCP `doc_put`이 남기는 산출물)는 같은 목록의 한 종류. 이름·종류·크기·연결 task·올린 주체·시각, task/날짜 그룹. 위키가 아니다 (2026-09-03 재정의) |

기존 4개 URL은 건드리지 않고 형제 라우트(`overview / timeline / knowledge / docs / docs.$slug`)를 더한다. 탭 순서는 개요·타임라인·태스크·지식·문서다. `notes` 라우트는 2026-09-03에 제거했다. **기본 랜딩 탭은 Phase 1에서 board를 유지한다** — 개요로 옮기는 것은 2줄 변경이므로 dogfooding 후에 결정한다.
문서 쓰기는 `task:update`(member 포함), 삭제와 설정(`agent_project`)은 `project:update`. 편집기는 task description이 쓰는 기존 tiptap 에디터를 재사용하고, 파일·이미지 첨부는 업로드 경로가 `taskId`를 요구하므로 Phase 1a에서 제외한다(§10).

**개요의 상태 부분은 파생 뷰다** (§6.3, §2.1) — 원본은 원장과 task다. 단 하나 예외로, 사람이 쓰는 **프로젝트 설명**을 상단에 둔다(2026-09-03): `agent_document` 예약 slug `overview`에 저장해 저자·시각이 보이고, 에이전트도 `doc_put`으로 같은 slug를 쓸 수 있다. 개요가 담는 것은 셋이다.

1. **핸드오프 콜아웃** — 프로젝트의 최신 `kind: handoff` entry를 `summary` + `body`로 펼치고 작성자와 시각을 함께 보여준다. 작성자는 사람일 수도 에이전트일 수도 있다(§2.3) — 사람이면 이름을, 에이전트면 `provider/model`(+`agent_label`)을 적는다. handoff가 없으면 kind 무관 최신 entry로 폴백한다. "지금 어디까지 왔나"에 대한 답이 매번 같은 자리에 있다.
2. **태스크 타임라인 트리 (타임라인 탭)** — `subtask` 관계의 대상이 **아닌** task를 부모로 보고 시간 순 **세로**(최신이 위)로 쌓으며, 자식은 들여쓰기로 아래에 붙는다. 산출물은 그것을 만든 task·subtask 아래 **잎**으로 달린다. task를 펼치면 그 task의 원장 entry 목록이 인라인으로 나온다(메모 탭 대체). 목록 위에는 **사람용 작성기**가 붙어 같은 스트림에 append 한다 — 행마다 작성자를 표시하며, 사람은 이름, 에이전트는 `provider/model`(+`agent_label`)이다.

```
● task 3                       (2026-09-03)
● task 2                       (2026-09-02)
● task 1                       (2026-09-01)
  ㄴ task 1-2 (feat/kpa-v2, hotfix/kpa-login)
  ㄴ task 1-1 (feat/kpa-v2)
     ㄴ report.html   (보기 · 다운로드)
     ㄴ bundle.zip    (다운로드)
     ▸ entries (12)   (작성자: 사람 이름 / provider·model·label)
```

   - 조립은 서버가 한다. 클라이언트가 task마다 관계·문서·첨부를 조회하면 N+1이므로 `GET /api/agent-project/{projectId}/tree`가 노드당 `id, number, title, status, isFinal, createdAt, completedAt?, branches[], actors[]{provider, model, effort, appearances}, usage{inputTokens, outputTokens, totalTokens}, documents[]{id, slug, title, authorKind, updatedAt}, attachments[]{id, name, contentType, size, url}, children[]`를 한 번에 내려준다. `done`은 §6.1대로 접는다.
   - 노드에는 **모델 · effort · 토큰**(그 task의 entry `usage` 합)을 함께 적고, 서브트리 단위로 롤업(모델별 토큰 합, 등판 횟수)을 낸다. 누가 얼마를 썼는지가 보이지 않으면 모델 배치를 고칠 근거가 없다.
   - **브랜치 라벨**은 그 task의 entry들이 담은 `refs.branch`(+`refs.repo`)의 **distinct 집합**이다. 한 task가 여러 브랜치를 가질 수 있으므로 노드 옆에 나열한다. 파생값이므로 task에 컬럼을 추가하지 않는다.
   - 잎의 출처는 둘이다: task에 연결된 `agent_document`(§4.2 `task_id`)와 upstream 첨부(`asset` 테이블 — `apps/api/src/database/schema.ts:586`; 생성 경로는 `POST /api/task/image-upload/{id}` + `/finalize`, `apps/api/src/task/index.ts:460,488`). 다만 그 경로는 MIME을 거부하지는 않지만(비이미지는 `kind: attachment`로 저장, `task/index.ts:889`) 항상 task와 `surface`(`description | comment`)에 묶이고 inline 열람용 URL 라우트가 없다. 그래서 산출물은 fork 전용 `agent_artifact`(1a')에 두고 트리의 첨부 잎은 거기서 채운다(2026-09-02 결정). `asset` 행 자체는 `kind`·`mime_type`이 자유 텍스트라 스키마 변경 없이 담긴다.
   - **클릭 동작.** HTML 산출물은 `allow-same-origin` **없는** `<iframe sandbox>` 안에서 인라인으로 연다. iframe이 에셋 URL을 직접 불러야 하며 **본문을 앱 DOM에 렌더하지 않는다** — 에이전트가 생성한 HTML은 신뢰 경계 밖이고, 앱 DOM에 넣는 순간 세션을 가진 XSS가 된다. markdown 문서는 문서 탭(`docs.$slug`)으로 열고, zip·pdf 등 나머지는 다운로드 링크로 보낸다.
3. **라이브 섹션** — 열린/완료 카운트, 활성 task 임계치 배너, 활성 lease.

### 6.1 하드 리밋

- `done`은 기본 접힘 — 칸반은 무수정이고, **개요 탭의 타임라인 트리**가 완료 컬럼(`isFinal`) task를 "완료 N" 한 줄로 접는다
- 30일 후 아카이브 — `agent_project.done_archive_days`(기본 30, 0=off) 기준 cron. **대량 상태 변경과 알림을 유발하므로 Phase 1c에서 별도 사용자 승인 후 도입한다**
- 타임라인은 최근 20개. 그 이상은 기존 커서(`before`=entry id)로 드릴다운
- 활성 task가 임계치를 넘으면 경고 (워킹셋이 부푸는 신호). 임계치는 `agent_project.active_task_threshold`(기본 20, brief 상한과 정렬)이며 개요 탭 배너로 띄운다

### 6.2 "코어 변경"은 결정론으로 판정한다

모델이 판단하면 세션마다 달라진다 — 없애려는 그 변덕이다. 경로 패턴을 사람이 프로젝트당 한 번 정의하고, `git diff --name-only`와 매칭한다.

```yaml
core_paths:
  - src/domain/**
  - "**/migrations/**"
```

**판정 주체는 서버다** (1b 구현, 2026-09-03). 패턴은 `agent_project.core_paths`에 저장하고(`PUT /api/agent-project/{projectId}`, `project:update`), `POST /api/agent-entry`(= `agent_log_append`)가 `refs.files`를 받으면 append 시점에 `apps/api/src/agent-project/core-paths.ts`가 `picomatch(core_paths, { dot: true })`로 대조해 `core_changed`에 기록한다. 클라이언트 입력 `coreChanged`는 HTTP·MCP 스키마 모두에서 제거했다 — 모델이 채우는 필드로 두면 없애려던 변덕이 그대로 남는다.

- 값의 의미: `null` = 판정하지 않음(`refs.files` 자체가 없음), `[]` = 판정했으나 매칭 0건(패턴이 비어 있거나 설정 행이 없는 경우 포함).
- 패턴 규칙(Zod): 최대 50개, 각 1–200자, 절대경로(`/`, `\`, `C:\`)와 `..` 세그먼트 금지. 저장 시 앞의 `./`를 벗기고 공백을 다듬고 중복을 제거한다.
- 파일 규칙: `refs.files`는 자유 입력이므로 거부하지 않는다. 매칭 전에 `./`를 벗기고, 절대경로·`..` 포함 경로는 **매칭 대상에서 제외**한다(append 자체는 성공). `core_changed`에는 정규화된 경로가 입력 순서대로 중복 없이 들어가고, `refs`는 받은 그대로 저장한다.
- `**`는 dotfile을 포함한다(`src/**`가 `src/.env.example`에 매칭).
- glob 의미는 picomatch 기본(matchBase 꺼짐)이다: 슬래시 없는 `*.ts`는 **최상위 파일만** 매칭한다. 어디서든 매칭하려면 `**/*.ts`로 쓴다.
- 판정은 append 시점에 한 번이다. 패턴을 바꿔도 기존 행은 **재판정·백필하지 않는다** — 서버 판정 이전 값은 당시 클라이언트의 주장이며, 원장은 append-only다.
- 구 클라이언트가 보내는 `coreChanged`는 unknown key strip으로 400 없이 무시된다.

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
| **1** | API 모듈 + 에이전트 MCP 툴셋 + 5탭 뷰 | **5탭 뷰 포함, dogfooding 시작**[^linear] |
| 1a | `agent_document` API(`task_id` 포함) + `agent_entry`에 `effort`·`agent_label`·`usage` 컬럼 + 문서 탭 + 개요 탭(핸드오프 콜아웃 + `/tree` 엔드포인트 + 브랜치 라벨 + 모델·effort·토큰 롤업 + 산출물 잎·sandbox 뷰어) + 메모 탭 + 5탭 nav | 산출물 저장·열람, 개요에서 이력·비용 파악 |
| 1b | `agent_project` + core_paths 서버 판정 + 지식 탭 + `workspace:update` capability. **API 완료(2026-09-03)**: `drizzle-agent/0003` `agent_project`, `GET`/`PUT /api/agent-project/{projectId}`, `/tree`의 `threshold`, append 시 서버 판정, entry 요약의 `repo`/`branch`. 웹(설정 UI·배너·브랜치 칩·지식 탭)은 미구현 | 결정론 판정, 용어 확정 UI |
| 1c | MCP `agent_doc_get`/`agent_doc_put`, `using-kaneo` 핸드오프 entry 형식 4섹션(완료·진행 중·막힘·다음) 고정 + git 작업 시 `refs.branch` 필수, 하네스 훅으로 `usage` 자동 기록, 아카이브 cron 승인 게이트, 운영 반영 | 툴 10개 확정, 에이전트가 스스로 리포트를 남김 |
| 2 | Linear export → entry 흡수 | 열린 이슈만 Task로, 닫힌 이슈는 entry 1개로 압축. 코멘트는 가져오지 않는다 |
| 3 | 압축 계층 (§4.6) | entry가 쌓인 뒤 |
| 4 | consolidation → 지식 항목 승격 | 반복 등장 개념을 제안 큐로 |

**Phase 1이 끝나면 Linear를 끌 수 있다.** 3·4는 데이터 없이는 설계할 수 없다(cold start).

[^linear]: Linear → Kaneo 전환 자체는 2026-09-02에 이미 이뤄졌다. Phase 1의 완료 조건은 "5탭 뷰 포함, dogfooding 시작"이다.

### 승격 파이프라인 (Phase 4)

```
entry N개에 같은 이름 반복 등장
  → consolidation 배치가 제안 큐에 올림
  → 사람 승인
  → 지식 항목(confirmed) 진입
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
| AI의 무한 append로 사람이 못 읽음 | ❌ 형식 없는 자유 텍스트 로그 (원인은 작성자 혼재가 아니다, §2.3) |

4개 중 3개가 구조적이라 유료 전환으로 풀리지 않는다.

**주의: 같은 실패를 반복하지 않으려면 §5.1(응답 예산)과 원장 형식(§2.3·§4.3)이 반드시 지켜져야 한다.** Kaneo를 그대로 쓰면 같은 벽을 다시 만난다.

---

## 10. 미결

1. 레이어 이름 (현재 `agent-layer`는 임시)
2. Entry 생성 주체 — 세션 종료 hook 자동 draft vs 에이전트가 `log_append` 호출.
   섞는 쪽이 유력: 자동 draft + 에이전트가 `decision`만 채움
3. 커밋 트레일러로 작업자를 구분할지 — 사용자 전역 룰(`30-safety.md`)이 AI `Co-Authored-By` 트레일러를 금지하고 있어 충돌한다. 트레일러 없이 entry에서만 추적하는 방안 검토
4. upstream merge 주기
5. ~~MCP 실측~~ → **완료** (§5.0). 남은 것: tools/list 실크기 계측에 OAuth 플로우 통과 필요
6. Kaneo 커뮤니티에 문제 제기 시점 — 작동하는 것을 보여준 뒤가 유리하나, "이 문제 겪고 계신가요"라는 **질문**은 비용 0이므로 선행 가능
7. 문서 버전 이력 — Phase 1은 덮어쓰기. `agent_document_revision`은 컬럼 변경 없이 얹을 수 있으므로 필요해질 때 결정한다. 동시 편집은 마지막 저장 승리이며 `updatedAt` 조건부 PUT은 후속
8. 산출물 첨부(HTML 리포트·zip·pdf) — **구현됨(1a', 2026-09-03)**: fork 전용 `agent_artifact`(`drizzle-agent/0002`; projectId, taskId nullable SET NULL, name, contentType, size, storageKey unique, uploadedBy/actorId, `finalizedAt` — presign 시 pending 행을 먼저 쓰고 finalize가 HeadObject로 size·contentType을 대조한 뒤 활성화. pending 행은 목록·트리·URL 어디에도 노출되지 않고 storageKey를 보존하므로 미완 업로드는 삭제 API로 정리할 수 있다). 라우트(`apps/api/src/agent-artifact`): `POST /api/agent-artifact/{projectId}/presign`(task:update, 10MiB, allowlist text/html·text/markdown·text/plain·application/json·application/pdf·application/zip) → `POST …/finalize`(task:update, 멱등; 객체 없음·불일치 400, 스토리지 오류 503) → `GET …/{projectId}?taskId=`(목록, 최신순) → `GET …/{projectId}/{artifactId}/url?disposition=inline|attachment`(기본 60s, `AGENT_ARTIFACT_URL_TTL_SECONDS`; inline은 html·md·txt·json·pdf만, zip은 항상 attachment; `response-content-type`을 저장값으로 고정) → `DELETE …/{projectId}/{artifactId}`(project:update, 객체 삭제 후 행 삭제). 키 배치 `agent-artifacts/<ws>/<project>/<artifactId>/<sanitized name>`. 트리의 `attachments` 잎은 여기서 채운다. upstream `asset`·image-upload 경로는 건드리지 않았다. 미결로 남는 것: 문서 본문 안의 이미지 삽입(에디터 업로드가 taskId 의존), 만료된 pending 행·객체 자동 정리 job
9. 30일 아카이브 cron의 부작용 — 대량 상태 전이가 activity·알림·웹훅을 한꺼번에 발생시킨다. 배치 상한과 리더 락을 함께 설계하고 사용자 승인 뒤 켠다(Phase 1c)
10. upstream task 코멘트를 타임라인 뷰에 함께 접어 보여줄지 — **표시 전용**이다(원장에 흡수하지 않고, 코멘트 쓰기는 여전히 upstream 기능이다). 사람·AI가 원장을 공유하게 되면서(§2.3) 코멘트만 다른 화면에 남는 것이 맞는지가 미결이다
11. 문서가 사실상 KB로 읽힐 위험(§2.2) — 문서는 자격 게이트를 거치지 않은 산출물인데, 에이전트가 `doc_get`으로 읽으면 낡은 리포트가 KB처럼 작동한다. 저자 종류·`updatedAt` 노출과 툴 설명은 완화일 뿐 근본 해결이 아니다

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
| Web 탭 추가 난이도 | ✅ 실측 (2026-09-02, 정적 분석) — **파일 추가만으로는 안 된다.** 라우트는 파일로 생기지만 탭은 upstream 컴포넌트 2개를 고쳐야 나온다: `apps/web/src/components/common/project-layout.tsx:35`의 닫힌 `activeView` union과 하드코딩된 탭 버튼 4개, `header/mobile-project-nav.tsx`의 같은 union과 `grid-cols-4`. 추가로 `routeTree.gen.ts`가 git 추적 대상이라 재생성·커밋이 필요하다. §3.3 "등록 라인만" 규율을 web에 그대로 적용할 수 없으므로, 스위처를 fork 컴포넌트로 뽑아 두 파일의 diff를 국소화한다 |

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
