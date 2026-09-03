# Handoff — Agent Layer / Kaneo 운영

> 2026-09-02 기준 · 인계 대상: Claude
>
> [DESIGN.md](./DESIGN.md)는 구현 전 설계 snapshot일 수 있다. 현재 운영 상태의 정본은 이 문서의 실측과 Git/Argo 런타임 확인이다.

## 현재 상태 — 사람 뷰 5탭 전체·프로젝트 설정·core_paths 판정(`agent.10`)까지 운영 반영 완료

Kaneo Agent Layer는 `agent-layer` 브랜치에 push 되었고, 운영 `kaneo-prod`는 해당 이미지와 S3 첨부 스토리지를 사용 중이다. 첨부 UI의 실제 로그인 사용자 업로드만 아직 브라우저 환경 문제로 확인하지 못했다. **다음 작업의 첫 순서는 로그인한 Kaneo에서 파일 하나를 올리고, 다운로드·삭제까지 확인하는 것**이다.

| 대상 | 확정 상태 | 근거 |
|---|---|---|
| Kaneo 코드 | `agent-layer`의 `ac79a839` push 완료 | `git` 원격 브랜치 확인 |
| 이미지 | `ghcr.io/doominkim/kaneo:2.22.0-agent.10` 빌드 성공 | [GitHub Actions run 33707478033](https://github.com/doominkim/kaneo/actions/runs/33707478033) |
| GitOps manifest | platform `main`의 `559d0ea` | 이미지 태그 `agent.10`, SealedSecret과 공개 S3 환경값 포함 |
| TLS vhost | sandbox `main`의 `5dc74e2` | `files.kit.io.kr` 전용 nginx vhost |
| Argo / Pod | `kaneo-prod` Synced, Healthy, image `agent.10`, 1/1 Ready, restart 0, agent-layer 마이그레이션 0000~0003 적용 | 운영 클러스터 실측 (2026-09-03 11:35 KST) |
| MinIO HTTPS | `https://files.kit.io.kr/minio/health/live` 200 | SAN=`files.kit.io.kr`, 만료 `2026-12-01` |

관련 Linear: [SAN-244 — Kaneo Agent Layer 운영 배포 및 핵심 실측](https://linear.app/c2fuzg/issue/SAN-244/kaneo-agent-layer-운영-배포-및-핵심-실측). 현재 상태는 In Progress이며, 아래 남은 실측/MCP/web 작업을 닫은 뒤 완료 처리한다.

## Agent Layer 목표와 구현 범위

여러 모델·세션이 같은 프로젝트를 진행할 때 맥락이 흩어지는 문제를 Kaneo tracking fork 위의 **작업 원장 레이어**로 해결한다. 최종 목표는 Linear 완전 대체다.

| 요구 | 구현 상태 |
|---|---|
| GPT↔Claude handoff | 공유 상태 조회로 해결 (별도 기능 아님) |
| 작업자 구분 + 이력 | `agent_actor` (`provider` / `model` / `on_behalf_of`) |
| task 관리 | Kaneo 기본 기능 사용 |
| AI 면 / 사람 면 분리 | `agent_entry`(AI)와 `comment`(사람) |
| 코어 코드 변경 표시 | `agent_entry.core_changed` 필드만 있음; 렌더링 미구현 |
| 용어사전 자산화 | `agent_term` + resolve |
| MCP 조회 + 점유 | MCP 8개 도구 + `agent_lease` |

주요 Agent Layer 커밋은 아래와 같다.

```
8dd35aca  현재 agent-layer 배포 대상
c8f9fd22  feat(agent-layer): 에이전트 전용 MCP 툴셋 8개 추가
6d1cff67  feat(agent-layer): 태스크 점유(lease) API 모듈 추가
bf4d641b  feat(agent-layer): 용어사전 API 모듈 추가
61024737  feat(agent-layer): 원장 API 모듈 추가
fb6f64b7  feat(agent-layer): 작업 원장 스키마 4테이블과 분리 마이그레이션 파이프라인
```

Agent Layer 신규 영역은 `apps/api/src/agent-entry/`, `agent-term/`, `agent-lease/`, `mcp/agent-tools.ts`, `database/schema-agent-layer.ts`, `drizzle-agent/`다. `apps/api/src/index.ts`, `apps/api/src/mcp/modern.ts`, `.github/workflows/build-images.yml`만 수정했다는 설명은 **초기 Agent Layer 통합 기준**이며, 이후 attachment storage/task 변경까지 배제한다는 뜻이 아니다.

## 첨부 스토리지 구성과 실측

공개 설정만 manifest에 있다. access key/secret의 관리 원본은 Bitwarden `platform/kaneo/prod`다. Git에는 암호화된 SealedSecret만 GitOps 입력으로 **의도적으로 커밋**한다. SealedSecret controller가 복호화한 live Kubernetes Secret(base64 인코딩 값 포함)과 pod env에는 활성 자격증명이 존재하므로 민감한 평문으로 취급하며 조회·출력하지 않는다. 문서·Linear·터미널 출력으로도 옮기지 않는다.

```
S3_ENDPOINT=https://files.kit.io.kr
S3_BUCKET=kaneo-uploads
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

MinIO에는 `kaneo-uploads` 전용 bucket, `kaneo-prod` 전용 사용자/버킷 한정 정책이 있다. anonymous access는 꺼져 있다. 운영 MinIO의 CORS 설정은 현재 전역 wildcard다. nginx는 HTTPS만 `host.docker.internal:9000`으로 프록시하고, MinIO console `9001`은 외부에 노출하지 않는다. CORS를 전역 allowlist로 축소하려면 먼저 MinIO의 모든 현재 browser-direct consumer origin을 조사해야 한다. 이 조사는 기능을 막지 않는 후속 hardening이다.

실제로 확인한 결과:

- 전용 자격증명으로 PUT → HEAD → GET → DELETE 성공
- anonymous GET은 403, 다른 bucket 읽기는 거부됨
- `https://kaneo.kit.io.kr` origin의 CORS preflight는 exact origin 응답으로 204
- 10 MiB 초과 PUT은 nginx에서 413
- 버킷은 현재 비어 있음
- `9001`은 loopback만 수신하며 외부 IP 연결은 거부됨
- 운영 nginx 파일은 커밋본과 일치함 (공개 checksum: `ef636b7c0a7324e1ce94ef286c33a284afbcae29a84bc8464a0b02e830d85963`)

초기에 생성한 임시 전용 S3 키가 PTY trace에 한 번 노출되어 즉시 폐기·교체했다. 현재 MinIO, Bitwarden, live Secret에 적용된 자격증명은 서로 일치하고 그 임시 키는 무효다. **현 자격증명은 노출 징후가 없으면 불필요하게 재회전하지 말 것**. 재회전은 아래 무중단 전환 절차를 따른다.

## 검증 결과와 아직 검증하지 못한 것

### 완료한 검증

| 항목 | 결과 |
|---|---|
| focused storage tests | 26/26 통과 |
| API typecheck | 통과 |
| API attachment finalize | HeadObject로 실제 object size/content type 검증 |
| finalize 오류 | `NoSuchKey`/`NotFound`는 400, provider/`NoSuchBucket`는 503 |
| S3/프록시 경로 | 위 MinIO PUT/GET/DELETE, CORS, body limit 실측 완료 |
| Kaneo 운영 기동 | root/config/get-session HTTP 200, Pod Ready 1/1 |

### 2026-09-02 2차 세션 갱신 (미커밋 작업트리)

- 로컬 integration DB: PostgreSQL 13에 `kaneo_test`를 만들고 `DATABASE_URL="postgresql://dominic@localhost:5432/kaneo_test"`를 **명령줄 환경변수**로 넘겨 실행한다. root `.env`는 읽지 않는다. `postgres` role은 필요 없다.
- 결과: unit 391/391, integration 283 pass / 3 fail (label 3건은 upstream 코드가 PG 13에서 500: `on conflict ... where "label"."task_id" is null` 거부, CI는 `postgres:16`). 운영 PostgreSQL은 `postgres-pgvector:17` (17.4)로 실측했으므로 운영과 무관하다.
- 신규: `tests/api-integration/helpers/database.ts`에 `drizzle-agent` 마이그레이션 적용, `tests/api-integration/agent-{entry,lease,term}.test.ts` 계약 테스트. 독립 리뷰가 아래 결함 4건을 확인했고 같은 세션에서 수정했다(독립 리뷰 APPROVE). 커밋 `e7172a1a`/`7b4e33ed`, 이미지 `agent.6`, platform `566afe9`로 운영 반영.
  1. **보안** — `GET /api/agent-entry/{projectId}/{entryId}`가 `entryId`만으로 조회해 다른 workspace의 entry 본문이 읽혔다. 이제 `projectId`로 스코프하고 불일치 시 404. (`agent.6`으로 운영 반영됨)
  2. lease 보유 세션의 재획득이 거부됐다. 이제 같은 `sessionId`면 `acquired:true`로 `expiresAt`이 연장되고 `acquiredAt`은 유지된다.
  3. alias resolve가 대소문자를 구분했다. 이제 `lower(trim())`로 정규화한다.
  4. `nextBefore` 커서가 ms 정밀도라 같은 ms 안의 entry가 누락됐다. **계약 변경**: `before`/`nextBefore`는 이제 ISO 시각이 아니라 **마지막 entry의 id**다. `(created_at DESC, id DESC)` keyset이며, 해당 project의 entry가 아닌 커서는 400 `Unknown cursor`. MCP `agent_log_tail`의 `before`도 동일하다.
- MCP 접속 경로: `/api/mcp`는 Bearer 필수. device flow(`POST /api/auth/device/code` → 브라우저 승인 → `POST /api/auth/device/token`, client_id `kaneo-cli`)가 터미널에서 가능하다. read-only 도구는 `agent_brief`/`agent_log_tail`/`agent_entry_get`/`agent_term_resolve`, 나머지 4개는 mutation이다. 운영 discovery 엔드포인트는 200, 미인증 `/api/mcp`는 401이다. 조사 중 subagent가 승인 없이 운영에 device/code POST를 1회 호출했다(pending 행 1개, 30분 만료, 토큰 없음).

### 미완료 / 미검증

1. **로그인 UI 첨부 흐름**: Browser/Chrome 플러그인 `26.825`가 내부적으로 없는 `26.820` 모듈을 import해 자동 브라우저 검증을 할 수 없었다. HTTP 200은 로그인·첨부 성공 증거가 아니다. 사용자가 로그인한 브라우저에서 파일 업로드, 새로고침 후 다운로드, 삭제까지 수동 확인해야 한다.
2. **API integration test**: 해결됨(위 2차 세션 갱신 참조). 남은 것은 운영 PG 버전 확인(label PG 13 문제가 운영에 해당하는지)뿐이다.
3. **MCP 실제 OAuth 호출과 응답 크기**: `/api/mcp`에 OAuth로 연결해 MCP 8개 도구(그중 하나인 `agent_brief`)의 실제 payload/token 크기를 아직 측정하지 못했다.
4. **Agent Layer API 3모듈**: 로컬 integration 테스트로 HTTP 계약을 검증했다(위 참조). 운영 DB에서의 인증 왕복과 컨트롤러 결함 4건 수정은 남아 있다.
5. **사람 뷰 4탭 (DESIGN §6)**: 개요·태스크·지식·메모 탭과 §6.1 하드 리밋, §6.2 `core_paths` 결정론 판정은 **Phase 1 범위인데 미구현**이다. 이전 인계에서 "별도 이슈"로 밀렸던 것을 2026-09-02 Kaneo task KAN-6으로 복원했다. `ProjectLayout`의 닫힌 `activeView` union, 탭 네비게이션, fetcher, TanStack Query hook까지 함께 바뀌어야 한다.
6. **Phase 2 Linear 흡수**: 열린 이슈 → task, 닫힌 이슈 → entry 압축(DESIGN §8). 이전 SAN-244 범위의 "이관 제외"는 설계와 어긋나 KAN-10으로 복원했다.

## 다음 작업 순서

1. `https://kaneo.kit.io.kr`에 로그인해 작은 첨부 파일을 task에 올린다. 네트워크 요청이 `https://files.kit.io.kr/kaneo-uploads/...`인지, finalize가 성공하는지, 새로고침 후 다운로드와 삭제가 되는지 기록한다. 실패하면 브라우저 console/Network의 상태 코드와 response body만 수집하고 자격증명·presigned URL query는 공유하지 않는다.
2. (완료) 로컬 integration DB, Agent Layer integration 테스트, 결함 4건 수정. **재배포 전제**: 아래 "운영 호스트 침해" 대응이 끝나야 한다.
3. OAuth MCP 클라이언트로 운영 `/api/mcp`의 `tools/list`와 read-only 도구부터 호출해 응답 byte/token 수를 기록한다. MCP 8개에는 append/propose/acquire/release mutation이 있으므로, mutation 전에는 전용 테스트 workspace/task, append-only 영구 데이터 허용 범위, 사용자 승인, lease 해제 기준을 먼저 정한다. 승인 전에는 mutation을 호출하지 않는다.
4. 잔여 작업의 정본은 Kaneo project `kaneo`(KAN) 부모 task KAN-1 (`o2z5e9avzi7e1w8zzxa01c0u`)이다. 우선순위: KAN-5 침해 대응 → KAN-4 잠금 → KAN-7 MCP 보안 → KAN-9 타임존 → KAN-6 사람 뷰 4탭(설계 승인 후) → KAN-10 Linear 흡수 → KAN-2/3 실측 → KAN-8 CORS.
5. 증거는 Kaneo 원장(`agent_log_append`)에 남긴다. SAN-244는 더 이상 갱신하지 않는다.

### 다음 명령 예시

```bash
# Kaneo / platform 상태 (각 로컬 checkout)
git -C /Users/dominic/Playground/kaneo status --short --branch
git -C /Users/dominic/Playground/sandboxes/platform-san243 status --short --branch
git -C /Users/dominic/Playground/sandboxes/sandbox status --short --branch

# 운영 read-only 확인: SSH 인증 후 fika 원격 shell에서 올바른 kube-context를 먼저 확인한다.
ssh fika.ing
kubectl config current-context
kubectl -n kaneo-prod get deploy,pod
kubectl -n argocd get application kaneo-prod -o wide

# 원격 shell 종료 뒤 어느 환경에서나 가능한 HTTPS health 확인
curl -fsS https://files.kit.io.kr/minio/health/live

# 로컬 unit/typecheck (integration과 분리)
pnpm --filter @kaneo/api test:unit
pnpm --filter @kaneo/api typecheck

# 로컬 integration (로컬 role로 kaneo_test를 쓰도록 명령줄 환경변수로 지정; root .env는 읽지 않음)
DATABASE_URL="postgresql://dominic@localhost:5432/kaneo_test" pnpm --filter @kaneo/api test:integration
```

배포를 다시 해야 하는 코드/manifest 변경이 생기면 사용자 승인 후 `agent-layer` 이미지 빌드 성공 → platform manifest diff와 target revision 확인 → platform `main` push → Argo Synced/Healthy와 실제 API/UI 흐름까지 순서대로 증명한다. platform `main` push는 Argo auto-sync 운영 배포이므로 사용자 승인과 diff/revision 확인 없이 수행하지 않는다. push/build 성공만으로 운영 완료라고 판단하지 않는다.

## Linear → Kaneo 전환 (2026-09-02)

사용자 결정으로 Linear를 종료하고 Kaneo를 plan/work-state SSOT로 쓴다. 하네스 쪽 정본은 `~/.agents/skills/using-kaneo/SKILL.md`, `~/.agents/rules/20-plan-kaneo.md`, `~/.claude/incidents/2026-09-02-linear-to-kaneo-cutover.md`다. MCP 등록: Claude는 user scope `kaneo` (`https://kaneo.kit.io.kr/api/mcp`, 브라우저 OAuth), Codex는 `[mcp_servers.kaneo]`(`url`만)와 `codex mcp login kaneo`(브라우저 OAuth, DCR+PKCE). `using-linear`·`20-plan-linear.md`·`/plan-html`·Linear MCP는 제거했다. SAN-244는 더 이상 갱신하지 않으며 남은 항목은 Kaneo task로 옮긴다.

`agent.7`은 `/api/mcp/register`가 `grant_types`/`response_types` 배열을 거부하던 upstream 버그를 고친 것이다(커밋 `15d66372`). Claude Code 등은 `refresh_token`을 같이 보내므로 `agent.6` 이하에서는 동적 클라이언트 등록이 400이었다. 남은 유사 위험: `token_endpoint_auth_method`가 `none`만 허용된다.

## 사람 뷰 5탭 (KAN-6, 2026-09-03 1a 배포)

DESIGN §6 개정(`f7f4cb0b`)에 따라 1a를 `agent.8`로 배포했다. API(`a5e8956d`): `agent_document` 테이블·`drizzle-agent/0001`(agent_entry에 effort/agent_label/usage nullable 추가), `/api/agent-document` CRUD, `/api/agent-project/{projectId}/tree`, entry `refs.repo/branch`, `agent_brief` 문서 목록(상한 20). web(`94f96bac`): 5탭 nav, 개요(핸드오프 콜아웃·상태 스트립·타임라인 트리), 메모, 문서, 지식 placeholder, i18n `agentLayer` 네임스페이스.

2026-09-03 `agent.9`(`cf1912a0`, `2a5b9792`, `39fdbb87`): 사용자 피드백으로 탭을 개요·타임라인·태스크·지식·문서로 재구성(메모 탭 제거). 문서 탭은 산출물·파일 보관함(`agent_artifact`, presign→PUT→finalize, html/md/txt/json sandbox 뷰어, zip 다운로드), 타임라인은 세로 트리(task 펼치면 원장 entry), 개요에 사람이 쓰는 설명(`agent_document` slug `overview`). MCP 도구 5개 추가(`agent_doc_get/put`, `agent_artifact_put_text/presign/finalize`, 에이전트 attribution은 API 프로세스 내 직접 호출로만). 툴 개수 상한은 정의 크기 예산(개별 2560B·합계 12288B, 실측 9258B)으로 대체. **Claude Code는 MCP 도구 스키마를 세션 시작 시 캐시하므로 새 도구는 새 세션에서만 보인다.**

2026-09-03 `agent.10`(`6262a7d8`, `ac79a839`): 1b 완료 — `agent_project` 설정(`drizzle-agent/0003`, core_paths·활성 task 임계치·아카이브 일수, 설정 → 프로젝트 → 에이전트 레이어), `core_paths` 서버 판정(picomatch, `coreChanged` 입력 제거, `refs` 배열 상한), 지식 탭(용어사전 resolve/confirm/propose, 결정 목록), 임계치 배너, entry 요약 `repo/branch` 칩. 1c 중 스킬 갱신은 `~/.agents` `7fdcd38`(using-kaneo: handoff 4단락, refs.branch 필수, effort/label/usage, 문서·산출물 도구·curl 업로드 규칙).

KAN-6에 남은 것: 새 세션에서 MCP `agent_artifact_put_text` 운영 실측, SubagentStop usage 자동 기록 훅(설계·승인 필요), 30일 아카이브 cron(승인 게이트, `done_archive_days` 0=off 스위치 결정 필요), MCP 경로 viewer 403·교차 workspace integration 테스트, 설정 폼 Save 버튼 disabled 조건 정리.

## 운영 호스트 침해 (2026-09-02 발견)

fika.ing(Mac Studio, macOS 15.6.1, k3s·PostgreSQL 17·MinIO·Redis 호스트)에서 침해 지속성 흔적을 발견했다. `/etc/ssh/sshd_config.d/cve.conf`가 모든 사용자 키 인증을 `/var/root/.ssh/authorized_keys2`로 돌렸고(정상 키 등록이 실패한 원인), `/Library/LaunchDaemons/com.apple.configdb.update.plist`가 `/var/tmp/.ssh_append`로 root `authorized_keys`에 키를 추가하도록 돼 있었다. 모두 mtime 1970. 유력 경로는 CVE-2026-65400(Screen Sharing 사전인증 root RCE, 5900 외부 노출, 패치 15.7.9 미적용).

- 완료: 증거를 `~/ir-2026-09-02`에 보존, 지속성 파일 제거, sshd 재시작. 이후 sshd `AuthorizedKeysFile`은 기본값이고 정상 키 인증이 동작한다.
- 미완료(사용자 작업): 5900 및 불필요 포트(5432/6379/9000/8080/11434) 외부 차단, macOS 패치, **호스트에서 접근 가능했던 모든 자격증명 회전**(Kaneo DB, MinIO, Redis, k3s Secret/SealedSecret 키, GitHub/GHCR 토큰, 계정 비밀번호), root at 작업 확인. root RCE였으므로 재설치가 가장 확실하다.
- 이 대응이 끝나기 전에는 새 이미지 배포, MCP 토큰 발급, SealedSecret 갱신을 하지 않는다. HANDOFF의 "무중단 키 회전" 절차는 유출 확정 상황이므로 적용하지 않고 즉시 회전한다.

## 런타임과 작업트리 주의사항

- 운영 서버 platform checkout은 `e315e8b`에서 clean이다.
- 운영 서버 sandbox checkout은 `dev`가 origin보다 6 commit 앞서 있고, 기존 untracked `infra/backups/`, `infra/env/.prod.env`, `infra/nginx/conf.d/k3s-kaneo.conf`가 있다. 배포된 `k3s-kaneo-files.conf`도 Git에서 untracked인 상태다. **이 checkout에서 pull/reset/clean 하지 말고 위 파일을 건드리지 말 것.** 다음 nginx 변경은 대상 파일만 비교·반영하고 `nginx -t` 후 reload한다.
- MinIO root 자격증명 또는 Fika용 자격증명을 Kaneo runtime에 재사용하지 않는다. Kaneo는 전용 bucket/user/policy만 사용한다.
- `KANEO_API_URL`은 비워 둔다. `KANEO_CLIENT_URL`에서 파생되며 잘못 지정하면 브라우저 API 요청이 깨질 수 있다.
- `agent_entry` append-only는 현재 애플리케이션 규약이며 DB UPDATE/DELETE trigger는 없다. `acquire-lease.ts`의 `actorId: actor?.id ?? ""`도 `resolveActor`가 행을 반환한다는 전제에 의존한다.
- pre-commit의 `biome ci .`는 기존 upstream의 Biome schema/CLI 버전 불일치로 실패할 수 있다. 변경 범위의 개별 검증 결과와 전체 hook 실패를 구분해서 기록한다.

## 롤백과 장애 대응

데이터 삭제보다 영향 범위를 분리하고 현재 상태를 보존한다. **commit, push, Argo 변경, S3 키 회전은 모두 사용자 승인 후에만 수행**한다.

### Storage-only 장애 (첨부 PUT/GET만 실패, API는 정상)

1. `agent.5` 이미지는 유지한다. S3 endpoint/bucket/S3 sealedEnv·Secret 주입을 바꾸거나 제거하면 attachment presign/finalize가 503이 될 수 있음을 먼저 인지한다.
2. TLS health, MinIO bucket/policy, CORS preflight, 전용 자격증명의 최소 PUT/GET/DELETE를 read-only 또는 전용 test object 범위에서 확인한다.
3. 원인이 S3 sealedEnv·Secret 주입 변경이라면 마지막 정상 storage 설정의 diff/revision을 확인한 뒤, 사용자 승인 후 `apps/kaneo/prod.yaml`을 되돌려 commit/push한다. platform `main` push는 Argo auto-sync 배포이므로 Argo Synced/Healthy, Secret 주입 상태, 실제 attachment API/UI 흐름을 확인한다.
4. bucket, 전용 사용자, TLS 인증서, nginx vhost는 즉시 삭제하지 않는다. 기존/부분 업로드 조사와 안전한 재배포에 필요하다.

### Image/API regression (Kaneo API 자체가 실패)

1. `git log`와 platform manifest history에서 **정확한 known-good image와 manifest revision을 먼저 확인**한다. `e315e8b` 이전 revision을 추측해서 바로 되돌리지 않는다.
2. 사용자 승인 후 확인된 manifest revision만 복구 commit/push한다. platform `main` push 전 diff/revision을 재확인하고, 이미지 tag를 임의로 바꾸지 않는다.
3. Argo Synced/Healthy, Pod Ready/restart, root/config/API 응답, 로그인 첨부 흐름까지 검증한다.

유출 또는 정책 오작동이 확인된 경우에만 사용자 승인 후 전용 S3 키를 무중단 전환한다. 이 chart에는 Secret checksum으로 자동 rollout하는 설정이 없으므로 SealedSecret 갱신만으로는 pod가 재시작되지 않는다. 기존 활성 credential을 즉시 변경하지 말고, 후속 전용 user/credential 생성 → 최소 정책 부여 → Bitwarden/SealedSecret 선반영 → 사용자 승인된 `kubectl rollout restart` 또는 pod-template checksum 변경 → 새 pod에서 새 credential 실측 → 기존 credential 폐기 순으로 진행한다.

## 오래된 정보 폐기

- `2.22.0-agent.2`~`agent.9`는 더 이상 배포 대상이 아니다. 현재는 `2.22.0-agent.10`이다.
- `apps/kaneo/prod.yaml`은 미커밋/빈 `sealedEnv` 상태가 아니다. `559d0ea`가 운영에 반영되었다.
- TLS 발급/배포는 pending이 아니다. `files.kit.io.kr`은 정상 HTTPS다.
- 운영 DB/auth/S3 secret은 Bitwarden과 SealedSecret으로 이미 주입되어 있다. 값을 문서나 명령 출력에 적지 않는다.
