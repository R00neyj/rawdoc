# 메모

명세가 되기 전의 논의 기록. 결정이 굳으면 `product.md` 나 `specs/features/F-xxx.md` 로 옮기고 여기서는 지운다.

---

## 2026-09-22 — 자동화 연결 수단: 원격 MCP 서버 대신 CLI

**상태: 방향만 정함. 명세 없음. 승인 필요**

`product.md` 7장 F-223 의 "원격 MCP 서버는 M3(Durable Object 도입) 때 이 API 위에" 와 `specs/features/F-301.md` 7장의 "원격 MCP 는 뒤" 를 다시 본다. 사용자 제안(2026-09-22): "AI 에디터를 이용하는 사람을 위한 옵션" 이라면 MCP 서버를 따로 두는 것보다 CLI 를 배포하는 쪽.

### 근거

- 서버는 이미 다 있다. F-222 API 토큰(`9b4d698`), F-223 `/v1`(`35322ca`) 로 문서 목록·읽기·만들기·고치기, 폴더, 이미지 올리기, 공유 링크 발급이 HTTP 로 열려 있다. MCP 든 CLI 든 이 위의 얇은 래퍼다 — 서버 신규 코드는 양쪽 다 거의 없다
- **인증 부담은 MCP 쪽이 더 크다.** 인터넷에 노출된 MCP 서버는 OAuth 2.1 + PKCE(S256) 가 필수이고, 서버는 resource server 역할이라 authorization server 가 따로 있어야 하며 클라이언트는 RFC 8707 `resource` 파라미터를 보내야 한다. Rawdoc 의 인증은 Cloudflare Access + Worker JWT 검증뿐이라 **자체 OAuth 발급자가 없다** — MCP 를 열려면 `/oauth/authorize`·`/oauth/token`·메타데이터·동적 클라이언트 등록을 새로 만들어야 한다
- CLI 는 인증 방식에 스펙 강제가 없다. 토큰 복붙을 없애려면 OAuth 풀스펙이 아니라 **브라우저 위임**이면 된다: `rawdoc login` → localhost 임시 포트 listen → 브라우저로 `rawdoc.app` 의 CLI 인증 화면 열기 → 기존 Access 로그인 통과 → 웹앱이 기존 `POST /api/tokens`(F-222) 호출 → 발급된 `rd_…` 를 localhost 로 반환 → 권한 0600 파일로 저장. 신규 서버 작업은 인증 화면 하나
- M3(Durable Object)를 기다릴 이유가 없다. `/v1` 은 이미 동작한다

### 배포 경로

사용자 제안은 GitHub 릴리즈였고, 레포가 공개라 가능은 하다(2026-09-22 확인). 다만 대상이 AI 에디터 사용자라면 npm 쪽이 낫다고 본다 — 그 환경엔 Node 가 거의 항상 있어 `npx` 가 설치 0단계이고, GitHub 릴리즈는 플랫폼별 빌드 매트릭스(darwin-arm64/x64, linux-x64, win-x64)와 자체 업데이트 확인 로직을 직접 져야 한다. npm 을 주 경로로 하고 릴리즈는 병행 정도. **미결**

### MCP 와 배타적이지 않다

같은 패키지에 `rawdoc mcp` 서브커맨드(로컬 stdio MCP 서버)를 얹으면 원격 MCP 운영 없이 MCP 클라이언트도 붙는다. 원격 MCP 가 유일한 답인 경우는 터미널이 없어 CLI 를 깔 수 없는 곳(claude.ai 웹, Claude Desktop 커넥터)뿐이고, 그 수요가 생기면 그때 `/v1` 위에 올리면 된다 — 지금 결정이 낭비되지 않는다

### 다음에 정할 것

- 패키지 이름, 커맨드 구성, 토큰 저장 위치, CLI 인증 화면의 범위
- `product.md` 7장 F-223 의 MCP 문장과 `F-301.md` 7장을 이 방향으로 고칠지 (명세 수정이라 승인 필요)
- `rawdoc mcp` 서브커맨드를 1차 범위에 넣을지

### 출처

- MCP 인가 스펙: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization , https://authzed.com/learn/mcp-oauth-2-1-authentication (2026-09-22 웹 검색 요약 기준. 스펙 원문은 직접 확인하지 않았다)
- Claude Code 원격 MCP 등록(`claude mcp add --transport http`): https://code.claude.com/docs/en/agent-sdk/mcp
