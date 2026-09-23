# 메모

명세가 되기 전의 논의 기록. 결정이 굳으면 `product.md` 나 `specs/features/F-xxx.md` 로 옮기고 여기서는 지운다.

---

## 2026-09-23 — 금고(E2EE) 폴더·문서

**상태: 방향만 정함(grill 1차). 명세 없음. M3(F-305~F-309) 뒤에 설계 개요로 쓴다**

사용자 질문 "db에 평문 그대로 다 실리는데 암호화 가능?" 에서 출발. Cloudflare 가 D1·R2·DO 를 이미 저장 시 AES-256 으로 암호화한다는 것([D1](https://developers.cloudflare.com/d1/reference/data-security/)·[R2](https://developers.cloudflare.com/r2/reference/data-security/)·[DO](https://developers.cloudflare.com/durable-objects/reference/data-security/))을 확인한 뒤, 사용자가 **종단간 암호화(서버·운영자도 못 읽음)** 를 골랐다

### 정한 것 (2026-09-23 사용자, 전부 추천안)

| # | 결정 |
| --- | --- |
| 1 | **선택형.** 사용자가 켠 금고 폴더·문서만 E2EE. 일반 문서는 지금 경로(F-301·F-304, DO 가 평문 `Y.Doc` 병합·스냅샷) 그대로 |
| 2 | 암호화 대상: **본문 + 제목 + 첨부 이미지.** 폴더 이름·문서 수·크기·수정 시각은 평문(서버 목록·정렬 유지) |
| 3 | 키: **로그인과 별개인 금고 암호 + 복구 코드.** 암호에서 키 유도(WebCrypto PBKDF2 후보), 복구 코드는 한 번만 보여 준다. 키를 잃으면 복구 불가 |
| 4 | 순서: **F-304 를 그대로 재개하고, 금고는 M3 뒤** 새 설계 개요로. 금고는 일반 경로를 건드리지 않고 옆에 붙인다 |
| 5 | 1차 금고 문서는 **혼자 편집**(실시간 암호 협업은 2차). 저장은 문서 전체를 암호화해 올린다 |
| 6 | 1차 금고는 **나만.** 초대·공유 링크·`/v1`·CLI 에서 빠진다(목록에는 금고 표시만) |
| 7 | 첨부 정리(F-219, `attachmentGc.ts:110-124` 가 본문을 스캔): 금고 문서는 **저장할 때 클라이언트가 쓰는 첨부 id 목록을 평문으로 함께 올리고**, 정리 작업은 그 목록을 본다 |
| 8 | 기기 캐시(IndexedDB): **암호문으로 저장**, 열 때 복호화 |
| 9 | 자동 잠금: 키는 메모리에만. **탭을 닫거나 새로고침하면 잠기고, 30분 안 쓰면 잠긴다**(시간은 설정에서) |
| 10 | 두 기기 동시 수정: **버전 충돌 → 충돌 사본**(F-207 방식을 금고 문서에만 남긴다. F-306·F-309 가 일반 문서에서 걷어내도 금고 경로는 유지) |

### 남은 것 (grill 2차)

- 로그아웃 로컬 문서에도 금고가 있는지, 검색·지도(F-292)에서 금고 문서 처리(잠겨 있으면 빠짐?), 금고 켜기·끄기(기존 문서를 금고로 옮길 때 암호화·복호화), 크기 상한을 암호문 기준으로(F-206, base64 약 1.33배), 첨부 이미지 암호화 시 형식·너비 판정을 클라이언트로(`imageSniff.ts`), `content/legal/privacy.md` 문구
- 마일스톤·번호

### 조사해 둔 것 (2026-09-24, 다시 조사하지 말 것)

- 서버가 평문을 읽는 곳: `publicPage.ts:72-84`(OG 발췌), `links.ts`(공개 보기·묶음 위키링크 표·`stripComments`), `attachmentGc.ts:110-124`, `attachments.ts:173·212·254·296`(본문에 첨부 id 가 있는지로 남의 첨부 접근 허가), `imageSniff.ts`, `v1.ts:238·276-287`, `validate.ts:180-194`(크기). 검색·지도는 클라이언트 캐시에서 계산(`searchIndex.ts:78`, `mapIndex.ts:65`)
- WebCrypto 만으로 최소 구성 가능(AES-GCM, PBKDF2, RSA-OAEP/ECDH). Argon2id 는 `hash-wasm` 11.3KB gzip 이 필요
- 선행 사례: Proton Docs(클라이언트 squash), secsync, Excalidraw(`#key` 조각), Standard Notes(Argon2id), Skiff(공유 해제 때 키 교체 안 함). 암호 협업(2차)은 `YServer` 를 못 쓰고 `partyserver` 기반 `Server` 로 암호문 로그 + 클라이언트 스냅샷 교체

