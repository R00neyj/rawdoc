# 메모

명세가 되기 전의 논의 기록. 결정이 굳으면 `product.md` 나 `specs/features/F-xxx.md` 로 옮기고 여기서는 지운다.

---

## 2026-09-22 — 자동화 연결 수단: 원격 MCP 서버 대신 CLI

**상태: 방향만 정함. 명세 없음. 승인 필요**

`product.md` 7장 F-223 의 "원격 MCP 서버는 M3(Durable Object 도입) 때 이 API 위에" 와 `specs/features/F-301.md` 1.2 의 "원격 MCP 는 뒤" 를 다시 본다. 사용자 제안(2026-09-22): "AI 에디터를 이용하는 사람을 위한 옵션" 이라면 MCP 서버를 따로 두는 것보다 CLI 를 배포하는 쪽.

### 근거

- 서버는 이미 다 있다. F-222 API 토큰(`9b4d698`), F-223 `/v1`(`35322ca`) 로 문서 목록·읽기·만들기·고치기, 폴더, 이미지 올리기, 공유 링크 발급이 HTTP 로 열려 있다. MCP 든 CLI 든 이 위의 얇은 래퍼다 — 서버 신규 코드는 양쪽 다 거의 없다
- **인증 부담은 MCP 쪽이 더 크다.** 인터넷에 노출된 MCP 서버는 OAuth 2.1 + PKCE(S256) 가 필수이고, 서버는 resource server 역할이라 authorization server 가 따로 있어야 하며 클라이언트는 RFC 8707 `resource` 파라미터를 보내야 한다. Rawdoc 의 인증은 Cloudflare Access + Worker JWT 검증뿐이라 **자체 OAuth 발급자가 없다** — MCP 를 열려면 `/oauth/authorize`·`/oauth/token`·메타데이터·동적 클라이언트 등록을 새로 만들어야 한다
- CLI 는 인증 방식에 스펙 강제가 없다. 토큰 복붙을 없애려면 OAuth 풀스펙이 아니라 **브라우저 위임**이면 된다: `rawdoc login` → localhost 임시 포트 listen → 브라우저로 `rawdoc.app` 의 CLI 인증 화면 열기 → 기존 Access 로그인 통과 → 웹앱이 기존 `POST /api/tokens`(F-222) 호출 → 발급된 `rd_…` 를 localhost 로 반환 → 권한 0600 파일로 저장. 신규 서버 작업은 인증 화면 하나
- CLI 가 M3 에 기댈 곳이 없다. `/v1` 은 이미 동작하고, CLI 는 `/v1` 의 요청·오류 모양에만 기댄다

### M3 진행과의 관계 (2026-09-23 추가)

M3 이 이미 시작됐다. F-301 개요 승인(`621ef50`), F-302 Yjs 골격 구현(`6ab3d93`) — 로컬 `Y.Doc` 과 CM6 연결까지이고 네트워크·서버·저장 경로는 그대로다. DO 는 F-304 부터

- **원격 MCP 는 M3 범위에서 이미 빠졌다.** F-301 1.2 "하지 않는 것" 에 들어 있고 그 개요가 승인됐다. `product.md` 7장 F-223 의 "M3 때 이 API 위에" 문장만 옛 계획으로 남아 있다
- **`/v1` 쓰기 동작이 M3 도중 두 번 바뀐다** (F-301 7장, 11장). 요청·오류 모양은 그대로라 CLI 코드가 깨지지는 않지만, 사용자가 겪는 결과가 다르다

  | 구간 | `PUT /v1/docs/:id` | 읽기 `GET /v1/docs/:id` |
  | --- | --- | --- |
  | 지금 ~ F-305 전 | 편집 잠금이 살아 있으면 423 | D1 그대로 |
  | F-305 ~ F-308 전 | 그 문서에 활성 DO 연결이 있으면 423 (임시 규칙) | D1 스냅샷. 마지막 편집 뒤 최대 5초 낡음 |
  | F-308 뒤 | DO 경유 diff 적용. 잠금 423 없음, `baseVersion` 검사는 DO 안에서 | 위와 같음 |

- 그래서 CLI 는 423 을 "누가 편집 중" 으로, 409 를 버전 충돌로 사람이 읽을 수 있게 보여 줘야 한다. **누가 문서를 열어 둔 동안에도 CLI 로 고칠 수 있는 건 F-308 뒤부터다.** 그 전에 내면 "AI 에디터에서 올리는데 웹에 문서가 열려 있으면 실패" 가 흔한 경험이 된다
- 파일 겹침: CLI 자체는 별도 패키지라 M3 과 안 겹친다. `/cli-auth` 화면은 `src/app` 을 건드리므로 F-305·F-306 (`App.tsx`·`serverStore.ts`) 과 순서를 맞춰야 한다

### 배포 경로

사용자 제안은 GitHub 릴리즈였고, 레포가 공개라 가능은 하다(2026-09-22 확인). 다만 대상이 AI 에디터 사용자라면 npm 쪽이 낫다고 본다 — 그 환경엔 Node 가 거의 항상 있어 `npx` 가 설치 0단계이고, GitHub 릴리즈는 플랫폼별 빌드 매트릭스(darwin-arm64/x64, linux-x64, win-x64)와 자체 업데이트 확인 로직을 직접 져야 한다. npm 을 주 경로로 하고 릴리즈는 병행 정도. **미결**

### MCP 와 배타적이지 않다

같은 패키지에 `rawdoc mcp` 서브커맨드(로컬 stdio MCP 서버)를 얹으면 원격 MCP 운영 없이 MCP 클라이언트도 붙는다. 원격 MCP 가 유일한 답인 경우는 터미널이 없어 CLI 를 깔 수 없는 곳(claude.ai 웹, Claude Desktop 커넥터)뿐이고, 그 수요가 생기면 그때 `/v1` 위에 올리면 된다 — 지금 결정이 낭비되지 않는다

### 다음에 정할 것

- 패키지 이름, 커맨드 구성, 토큰 저장 위치, CLI 인증 화면의 범위
- `product.md` 7장 F-223 의 MCP 문장을 이 방향으로 고칠지 (명세 수정이라 승인 필요). F-301 은 이미 MCP 를 범위 밖에 두고 있어 고칠 것 없음
- CLI 를 F-308 전에 낼지 뒤에 낼지. 전이면 쓰기가 423 으로 자주 막히고, 뒤면 M3 진행에 묶인다
- `rawdoc mcp` 서브커맨드를 1차 범위에 넣을지

### 출처

- MCP 인가 스펙: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization , https://authzed.com/learn/mcp-oauth-2-1-authentication (2026-09-22 웹 검색 요약 기준. 스펙 원문은 직접 확인하지 않았다)
- Claude Code 원격 MCP 등록(`claude mcp add --transport http`): https://code.claude.com/docs/en/agent-sdk/mcp
