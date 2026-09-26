---
name: write-guide
description: Writes one Rawdoc guide article (content/guides/{slug}.md) and its help section without a spec — an agent checks every fact against the code, writes the article, the help-section link line and the number-check test rows, and main commits it as one unit. Use it for requests like "사용법 글 써줘", "검색 사용법 글", "다음 사용법 글".
---

# write-guide

Guide articles get no spec (`specs/ia.md` 6.1 R9, user instruction 2026-09-27: "명세 없이 바로 쓰는 걸로 바꿔"). Four articles written with specs (F-2045~F-2048) showed the quality came from the automatic tests and from checking every sentence against the code, not from the spec document.

## 1. Main decides first

- The slug, and which help section(s) link to it (R3: at most one link line per section; one article may be linked from several sections)
- Anything the user already settled — pass it as "이미 정한 것"
- If the article would need a new feature, new UI text, or a behavior change, it is not an article — send that part to `write-spec` or `tweak`

## 2. Launch one agent

`Agent` with `subagent_type: "general-purpose"`, `model: "opus"`, `run_in_background: true`. Prompt skeleton:

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
- 수치 대조 행: 앱 상수 → site/helpGuides.test.ts, 서버 상수 → worker/guideLimits.test.ts, 도움말 절 수치 → src/app/helpDoc.test.ts. 상수에 export 만 붙이는 것은 허용
- 도움말에 ##/### 를 더하면 site/pageNav.test.ts·site/render.test.ts 의 제목 수
- e2e/site.spec.js — 글이 뜨는지·목록·앱 도움말 링크 스모크 한 묶음

## 검증 (이것만)
eslint(바꾼 파일), npx vitest run src/app/helpDoc.test.ts site/ worker/guideLimits.test.ts, npm run build 뒤 dist/guides/{slug}.html, e2e:one "{slug}" 한 번

## 보고 (음슴체)
바꾼 파일, 사실 근거 표(글 문장 → 코드 이름), 코드와 명세가 어긋난 곳, 확인 못 한 것, 사람 확인 항목
```

## 3. When the report arrives

1. Read "확인 못 한 것" and the code-vs-spec mismatches first. Verify one or two facts yourself
2. `npx eslint` on the changed files; rerun the vitest line if the report is unclear
3. Add the human-check rows to `specs/human-checks.md`
4. Commit only the files in the list above plus `specs/human-checks.md` — subject `{title} 사용법 글 (guide)`, body = the fact basis (short) + verification line
5. Fix the mismatched specs in a separate docs commit, or tell the user if one needs a decision
6. `git push`
