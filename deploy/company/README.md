# 사내 Kaneo 배포 (kaneo.vanpharm.com)

사내 서버 olap-server(192.168.9.32) 에 Kaneo 를 docker compose 로 띄우고,
test-web01(192.168.9.121) nginx 가 `https://kaneo.vanpharm.com` 으로 프록시한다.
운영 인스턴스(kaneo.kit.io.kr, k3d + helm) 와는 별개 인스턴스이며 데이터도 공유하지 않는다.

```
브라우저 ─ 공유기:443 ─ test-web01 nginx ─ 192.168.9.32:8892 ─ kaneo 컨테이너(:5173) ─ postgres 컨테이너
```

## 파일

| 파일 | 용도 |
|---|---|
| `docker-compose.yml` | kaneo + postgres:16-alpine, named volume `pgdata` |
| `kaneo.env.example` | 환경변수 예시. 복사해서 `kaneo.env` 로 쓴다 |
| `nginx/test-web01-kaneo.conf` | test-web01 vhost. 인증서 발급 절차는 파일 주석에 있다 |

## 전제

- olap-server 에 docker / docker compose v2 가 있다.
- ghcr.io 의 fork 이미지를 받을 수 있다 (private 이면 `docker login ghcr.io` 로 PAT 로그인 필요).
- `kaneo.vanpharm.com` A 레코드와 인증서는 test-web01 기준으로 준비한다.

## 노출 범위 — 먼저 정할 것

compose 는 기본적으로 `127.0.0.1:8892` 에만 바인딩한다. test-web01 은 다른 호스트이므로
이 상태로는 프록시가 닿지 않는다. 둘 중 하나를 골라 적용한다.

| 선택 | 방법 | 비고 |
|---|---|---|
| LAN 바인딩 | `KANEO_BIND_ADDR=192.168.9.32 docker compose up -d` | 방화벽에서 8892 를 test-web01 만 허용해야 한다 |
| loopback 유지 | olap-server 에 nginx 를 두고 LAN:8892 → 127.0.0.1:8892 | `deploy/nginx/vanpharm-mcp.conf`(vanpharm-olap) 와 같은 구조 |

## 기동 순서

```bash
# 1. 이미지 pull (태그는 빌드된 값으로 고정한다. latest 를 쓰지 않는다)
docker pull ghcr.io/doominkim/kaneo:2.22.0-agent.18

# 2. env 작성
cd deploy/company
cp kaneo.env.example kaneo.env
chmod 600 kaneo.env
openssl rand -hex 32   # 결과를 AUTH_SECRET 에 넣는다
# POSTGRES_PASSWORD, CUSTOM_OAUTH_* 를 실제 값으로 채운다

# 3. 기동
docker compose up -d

# 4. 컨테이너 상태 확인 (kaneo 가 healthy 가 될 때까지 최대 2분)
docker compose ps
docker compose logs -f kaneo
```

첫 기동에서 drizzle 마이그레이션(코어 + agent-layer)이 돌아 수십 초가 걸린다.
`healthy` 가 되지 않으면 `docker compose logs postgres` 로 DB 연결부터 확인한다.

## 검증

로컬(olap-server) 에서 컨테이너만 먼저 확인한다.

```bash
curl -fsS http://127.0.0.1:8892/api/health
```

nginx 반영 후 외부에서 확인한다.

```bash
# 1. 헬스체크
curl -fsS https://kaneo.vanpharm.com/api/health

# 2. MCP protected resource metadata — resource / authorization_servers 가
#    https://kaneo.vanpharm.com 기준으로 나와야 한다. localhost 나 다른 호스트가
#    나오면 KANEO_CLIENT_URL 이 잘못됐거나 KANEO_API_URL 을 직접 지정한 것이다.
curl -fsS https://kaneo.vanpharm.com/api/.well-known/oauth-protected-resource/api/mcp

# 발급자(issuer) 는 authorization server metadata 에 있다.
curl -fsS https://kaneo.vanpharm.com/api/.well-known/oauth-authorization-server/api

# 3. 미인증 MCP 호출은 401 + WWW-Authenticate 여야 한다.
curl -sS -i -X POST https://kaneo.vanpharm.com/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -20
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer resource_metadata="https://kaneo.vanpharm.com/api/.well-known/oauth-protected-resource/api/mcp"
```

## nginx 반영과 DNS

1. `kaneo.vanpharm.com` A 레코드를 공유기 공인 IP 로 등록한다.
2. test-web01 에서 인증서를 발급한다 (`nginx/test-web01-kaneo.conf` 상단 주석의 acme 임시 블록 → certbot → 임시 블록 제거).
3. `nginx/test-web01-kaneo.conf` 를 `sites-available/kaneo.vanpharm.com` 으로 복사하고 `sites-enabled` 에 심링크한다.
4. `sudo nginx -t && sudo systemctl reload nginx`.
5. renew 스크립트에 `--cert-name kaneo.vanpharm.com` 블록을 추가한다.

## 첫 로그인

`DISABLE_REGISTRATION=true` 여도 사용자가 0명인 동안 첫 가입 1건은 허용되고, 그 사용자가
인스턴스 관리자가 된다. 이후 가입은 초대 링크로만 가능하다.

`CUSTOM_OAUTH_AUTO_LOGIN=true` 는 로그인 화면을 건너뛰고 곧바로 IdP 로 보낸다.
IdP 설정이 틀리면 로그인 경로가 막히므로, 처음에는 `false` 로 띄워 OAuth 왕복을 확인한 뒤
`true` 로 바꾸고 `docker compose up -d` 로 재적용한다.

## 워크스페이스 자동 편입

사내 인스턴스는 로그인을 mcp.vanpharm.com 에 위임하고, mcp 에서 `kaneo` 권한을 받은 사람만
로그인에 성공한다. 접근 통제가 mcp 에서 이미 끝나므로 Kaneo 초대 단계는 쓰지 않는다.
`CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID` 에 workspace id 를 넣으면, custom OAuth 콜백으로
사용자 레코드가 처음 만들어질 때 그 워크스페이스에 멤버로 들어간다. 역할은
`CUSTOM_OAUTH_AUTO_JOIN_ROLE`(기본 `member`).

| 조건 | 동작 |
| --- | --- |
| env 미설정 | 자동 편입 없음. 초대를 받아야 워크스페이스가 생긴다 |
| IdP 가 `email_verified` 를 안 내림 | 초대 자동 수락·자동 편입 모두 건너뜀 |
| 이미 그 워크스페이스 멤버 | 건너뜀. 초대로 받은 역할이 유지된다 |
| workspace id 가 없는 값 | 로그만 남기고 로그인은 정상 진행 |
| 기존 사용자(두 번째 로그인) | 해당 없음. 신규 사용자 생성 시점에만 돈다 |

워크스페이스 id 는 `select id, slug, name from workspace;` 로 확인한다.
값을 나중에 바꾸면 그 이후 신규 사용자부터 적용되고, 기존 사용자는 수동으로 초대해야 한다.

## 백업

DB 백업(pg_dump 스케줄, 보관 주기, 복구 리허설)은 이 문서 범위 밖이며 후속 task 로 다룬다.
현재는 named volume `kaneo-company_pgdata` 에만 데이터가 있다.
