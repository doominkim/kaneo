# Handoff — Agent Layer / Kaneo 운영

> 2026-09-02 기준 · 인계 대상: Claude
>
> [DESIGN.md](./DESIGN.md)는 구현 전 설계 snapshot일 수 있다. 현재 운영 상태의 정본은 이 문서의 실측과 Git/Argo 런타임 확인이다.

## 현재 상태 — 첨부 업로드 인프라까지 운영 반영 완료

Kaneo Agent Layer는 `agent-layer` 브랜치에 push 되었고, 운영 `kaneo-prod`는 해당 이미지와 S3 첨부 스토리지를 사용 중이다. 첨부 UI의 실제 로그인 사용자 업로드만 아직 브라우저 환경 문제로 확인하지 못했다. **다음 작업의 첫 순서는 로그인한 Kaneo에서 파일 하나를 올리고, 다운로드·삭제까지 확인하는 것**이다.

| 대상 | 확정 상태 | 근거 |
|---|---|---|
| Kaneo 코드 | `agent-layer`의 `8dd35aca` push 완료 | `git` 원격 브랜치 확인 |
| 이미지 | `ghcr.io/doominkim/kaneo:2.22.0-agent.5` 빌드 성공 | [GitHub Actions run 33579884424](https://github.com/doominkim/kaneo/actions/runs/33579884424) |
| GitOps manifest | platform `main`의 `e315e8b` | SealedSecret과 공개 S3 환경값 포함 |
| TLS vhost | sandbox `main`의 `5dc74e2` | `files.kit.io.kr` 전용 nginx vhost |
| Argo / Pod | `kaneo-prod` Synced, Healthy, image `agent.5`, 1/1 Ready, restart 0 | 운영 클러스터 실측 |
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

### 미완료 / 미검증

1. **로그인 UI 첨부 흐름**: Browser/Chrome 플러그인 `26.825`가 내부적으로 없는 `26.820` 모듈을 import해 자동 브라우저 검증을 할 수 없었다. HTTP 200은 로그인·첨부 성공 증거가 아니다. 사용자가 로그인한 브라우저에서 파일 업로드, 새로고침 후 다운로드, 삭제까지 수동 확인해야 한다.
2. **API integration test**: 로컬 PostgreSQL에 `postgres` role이 없어 테스트 DB를 만들지 못했다. 이는 코드 실패가 아니라 로컬 테스트 DB 사전조건 부재다.
3. **MCP 실제 OAuth 호출과 응답 크기**: `/api/mcp`에 OAuth로 연결해 MCP 8개 도구(그중 하나인 `agent_brief`)의 실제 payload/token 크기를 아직 측정하지 못했다.
4. **Agent Layer API 3모듈**: typecheck만 통과했다. Agent Layer 단위 테스트와 인증된 HTTP 동작은 미검증이다. 실제 계약은 entry의 append/list/get, lease의 acquire/release/list, term의 resolve/list/propose/confirm을 포함한다.
5. **web 탭**: Agent Layer 전용 UI 탭은 아직 구현하지 않았다. `ProjectLayout`의 닫힌 `activeView` union, 탭 네비게이션, fetcher, TanStack Query hook까지 함께 바뀌어야 한다.

## 다음 작업 순서

1. `https://kaneo.kit.io.kr`에 로그인해 작은 첨부 파일을 task에 올린다. 네트워크 요청이 `https://files.kit.io.kr/kaneo-uploads/...`인지, finalize가 성공하는지, 새로고침 후 다운로드와 삭제가 되는지 기록한다. 실패하면 브라우저 console/Network의 상태 코드와 response body만 수집하고 자격증명·presigned URL query는 공유하지 않는다.
2. 로컬 integration DB를 준비한 뒤 attachment/Agent Layer API integration test를 실행한다. production DB나 storage를 개발·테스트에 사용하지 않는다.
3. OAuth MCP 클라이언트로 운영 `/api/mcp`의 `tools/list`와 read-only 도구부터 호출해 응답 byte/token 수를 기록한다. MCP 8개에는 append/propose/acquire/release mutation이 있으므로, mutation 전에는 전용 테스트 workspace/task, append-only 영구 데이터 허용 범위, 사용자 승인, lease 해제 기준을 먼저 정한다. 승인 전에는 mutation을 호출하지 않는다.
4. 검증된 계약을 바탕으로 web Agent Layer 탭을 별도 이슈로 설계·구현한다.
5. 증거를 SAN-244에 남기고 남은 범위가 끝났을 때만 완료 처리한다.

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

# 로컬 integration (테스트 DB의 postgres role을 준비한 뒤)
pnpm --filter @kaneo/api test:integration
```

배포를 다시 해야 하는 코드/manifest 변경이 생기면 사용자 승인 후 `agent-layer` 이미지 빌드 성공 → platform manifest diff와 target revision 확인 → platform `main` push → Argo Synced/Healthy와 실제 API/UI 흐름까지 순서대로 증명한다. platform `main` push는 Argo auto-sync 운영 배포이므로 사용자 승인과 diff/revision 확인 없이 수행하지 않는다. push/build 성공만으로 운영 완료라고 판단하지 않는다.

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

- `2.22.0-agent.2`는 더 이상 배포 대상이 아니다. 현재는 `2.22.0-agent.5`다.
- `apps/kaneo/prod.yaml`은 미커밋/빈 `sealedEnv` 상태가 아니다. `e315e8b`가 운영에 반영되었다.
- TLS 발급/배포는 pending이 아니다. `files.kit.io.kr`은 정상 HTTPS다.
- 운영 DB/auth/S3 secret은 Bitwarden과 SealedSecret으로 이미 주입되어 있다. 값을 문서나 명령 출력에 적지 않는다.
