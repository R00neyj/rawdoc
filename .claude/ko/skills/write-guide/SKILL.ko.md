---
name: write-guide
description: Rawdoc 사용법 글(content/guides/{slug}.md) 한 편과 그 도움말 절을 명세 없이 쓴다 — 에이전트가 모든 사실을 코드와 대조하고, 글·도움말 절 링크 줄·수치 대조 테스트 행을 쓰고, 메인이 한 단위로 커밋한다. "사용법 글 써줘", "검색 사용법 글", "다음 사용법 글" 같은 요청에 쓴다.
---

> **이 파일은 2026-09-28 시점 스냅샷이다. 원본은 `.claude/skills/write-guide/SKILL.md`(영어).**
> 규칙을 고칠 때는 원본을 고친다. 이 파일은 사람이 읽기 위해 남겨 둔 것이고 자동으로 따라가지 않는다

# write-guide

사용법 글은 명세를 쓰지 않는다(`specs/ia.md` 6.1 R9, 사용자 지시 2026-09-27: "명세 없이 바로 쓰는 걸로 바꿔"). 명세를 거쳐 쓴 글 네 편(F-2045~F-2048)을 보니, 품질은 명세 문서가 아니라 자동 테스트와 모든 문장을 코드와 대조하는 데서 나왔다.

## 1. 메인이 먼저 정한다

- 슬러그, 그리고 어떤 도움말 절(들)이 그리로 링크하는지 (R3: 절당 링크 줄 최대 한 줄, 한 글이 여러 절에서 링크될 수 있음)
- 사용자가 이미 정한 것 — "이미 정한 것" 으로 넘긴다
- 그 글이 새 기능·새 UI 문구·동작 변화를 필요로 하면 그건 글이 아니다 — 그 부분은 `write-spec` 이나 `tweak` 으로 보낸다

## 2. 에이전트 하나 띄우기

`Agent`, `subagent_type: "general-purpose"`, `model: "opus"`, `run_in_background: true`. 프롬프트 뼈대:

```
사용법 글 `content/guides/{slug}.md` 를 새로 쓴다. 명세는 쓰지 않는다(ia.md 6.1 R9). 커밋하지 않는다.

## 이미 정한 것
{slug, linked help sections, user decisions}

## 규칙
- specs/ia.md 6.1 R1~R9 와 6장 쓰지 않는 말. 형식 모델은 최근 글 content/guides/{latest}.md 와 그 도움말 절
- 모든 문장은 현재 코드로 확인한다(화면 글자는 컴포넌트 원문 그대로). 원천 명세는 참고만 — 명세와 코드가 다르면 코드를 따르고 보고한다
- 확인 못 한 것은 쓰지 않는다. 브라우저·외부 서비스 동작은 모르면 빼고 보고한다
- 기존 글 전부와 겹치지 않게 — 겹치면 짧게 두고 링크(R8)

## 바꾸는 파일 (이 밖은 건드리지 않는다)
- content/guides/{slug}.md (신규)
- src/app/helpDoc.ts — {sections} 절만. 절 끝 `사용법 글:` 줄, R2 분량
- 수치 대조 행: 앱 상수 → tests/site/helpGuides.test.ts, 서버 상수 → tests/worker/guideLimits.test.ts, 도움말 절 수치 → tests/src/app/helpDoc.test.ts. 상수에 export 만 붙이는 것은 허용
- 도움말에 ##/### 를 더하면 tests/site/pageNav.test.ts·tests/site/render.test.ts 의 제목 수
- e2e/site.spec.js — 글이 뜨는지·목록·앱 도움말 링크 스모크 한 묶음

## 검증 (이것만)
eslint(바꾼 파일), npx vitest run tests/src/app/helpDoc.test.ts tests/site/ tests/worker/guideLimits.test.ts, npm run build 뒤 dist/guides/{slug}.html, e2e:one "{slug}" 한 번

## 보고 (음슴체)
바꾼 파일, 사실 근거 표(글 문장 → 코드 이름), 코드와 명세가 어긋난 곳, 확인 못 한 것, 사람 확인 항목
```

## 3. 보고가 오면

1. "확인 못 한 것" 과 코드-명세 불일치를 먼저 읽는다. 사실 한둘은 직접 확인한다
2. 바뀐 파일에 `npx eslint`; 보고가 불명확하면 vitest 줄을 다시 돌린다
3. `specs/human-checks.md` 에 사람 확인 행을 추가한다
4. 위 목록의 파일과 `specs/human-checks.md` 만 커밋한다 — 제목 `{제목} 사용법 글 (guide)`, 본문 = 사실 근거(짧게) + 검증 줄
5. 명세와 어긋난 곳은 별도 문서 커밋으로 고치거나, 결정이 필요하면 사용자에게 말한다
6. `git push`
