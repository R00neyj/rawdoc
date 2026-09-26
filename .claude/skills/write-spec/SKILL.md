---
name: write-spec
description: Writes a Rawdoc spec (specs/features/F-xxx.md) using the spec-writer agent. Covers both design overviews and small specs. Use it for requests like "F-273 명세 써줘", "검색 명세 작성", "남은 명세 리스트업 후 작성". Implementation belongs to ship-feature.
---

# write-spec

Writing specs only. Implementation is `ship-feature`.

Korean copy: `.claude/ko/skills/write-spec/SKILL.ko.md` (snapshot, for humans). This file is the source of truth.

## 1. Preparation — main decides these first

1. **Pick the number.** Hundreds per milestone — M1 `F-1NN`, M2 and M1 follow-ups `F-2NN`, M3 `F-3NN`. Find a free number with `ls specs/features/` and see what is outstanding with `npm run specs -- --todo` (numbers that exist only in an overview's roadmap table have no file yet, so you have to open that overview to see them)
2. **Decide overview or small spec**
   - Spanning several screens or implementation units → a **design overview** (the `F-270` / `F-277` / `F-284` format). Chapters 1–5 are decisions, chapter 6 is the roadmap table of children
   - One implementation unit → a **small spec** (the `F-279` / `F-282` format)
3. **Ask the user first what needs asking.** Do not let the agent pick where the design forks (where it runs, what UI shape, where the scope ends) — settle it with `AskUserQuestion` and put it in the prompt as **"이미 정한 것, 바꾸지 말 것"**. This makes the biggest difference in quality
4. Check whether `specs/product.md` records the feature as **out of scope**. If it does, have the prompt list it under "갱신 대상" (the agent cannot edit existing `specs/**`)
5. **Look for file overlap.** Specs touching the same source file can still run in parallel (each writes its own `F-xxx.md`), but tell both prompts about it so they do not make contradictory decisions
6. **Help sections.** A spec that grows a help section (`src/app/helpDoc.ts`) follows the rules in `specs/ia.md` 6.1 (F-2039) and adds its number rows to the tests R5 names — say so in the prompt. **Guide articles get no spec** (ia.md 6.1 R9, 2026-09-27) — use `write-guide` instead

## 2. Launching the agent

`Agent` with **`subagent_type: "spec-writer"`** (`.claude/agents/spec-writer.md` is defined with Opus, so do not pass a `model`). If they can run in parallel, put them in one message.

**Do not repeat in the prompt what the agent definition already covers** — reading order, invariants, the `node` test environment, visual values going to human checks, the dependency comparison table, including acceptance criteria / file-ownership table / 갱신 대상 / open questions, and the report format. The prompt carries **only what is specific to this spec**.

Prompt skeleton:

```
`specs/features/F-xxx.md` 를 새로 작성한다. **명세만 쓴다. 구현·코드 수정·커밋은 하지 않는다.**
새로 만드는 파일은 그 하나뿐이다.

## F-xxx 는 무엇인가
{quote the overview's roadmap row} / {status of the prerequisite spec}

## 사용자가 이미 정한 것 (바꾸지 말 것)
{the decisions from step 1, numbered, with reasons}

## 먼저 읽을 것 (읽기 순서는 에이전트가 안다 — 여기서는 어느 장·어느 파일인지만)
- specs/product.md {chapter} · ia.md {chapter} · design.md {chapter} · architecture.md {chapter}
- {the overview} in full
- {the prerequisite spec} in full — the format model and what it inherits
- 실제 코드: {file list, and what to check in each}

## 반드시 결론을 내는 것 (조사 항목으로 미루지 않는다)
{2–5 points that must not be left vague, including what to read and what to measure}

## 명세에 반드시 담을 것
{what each chapter must decide — only what is specific to this spec}

## 이 명세에만 해당하는 주의
{other specs running at the same time, boundaries not to cross, the state of already-implemented prerequisites}
```

### The line that raises quality

Shared rules live in the agent definition. In the prompt, point at **where in this spec to apply them**.

- Name the items the overview deferred and hand them over as "이건 네가 결론을 내라"
- If performance matters, say **what to measure at what scale** (e.g. "문서 1,000개·5,000개에서 링크 추출 시간과 레이아웃 계산 시간")
- Point at what the prerequisite spec already established (e.g. F-284's "공유받은 문서는 `content` 가 비어 있다") so the agent does not dig it up again

## 3. When the report arrives

0. **The spec is already open in VS Code.** A `PostToolUse` hook (`scripts/open-spec-hook.mjs`, wired in `.claude/settings.json`) runs `code <path>` whenever a `specs/features/F-xxx.md` is written — by the agent or by you. Read the report first, then read the file there. It reopens at most once a minute per file, so the frontmatter fixes that follow will not keep stealing focus
1. **Read "가정으로 둔 것" first.** That is where the next round of thinking belongs
2. Verify yourself any **conflict with existing code or specs** the report flags (reading a file or two is enough). Do not relay the agent's word to the user unchecked
3. Run `npm run review -- F-xxx` to confirm the file table parses, and `npm run specs -- --check` for the frontmatter (the former reads any of "파일 소유", "수정 파일", "바꾸는 파일")
4. Scan for broken section references with `grep -n "^### \|(N\.M)"` — agents often move a section without fixing what points at it

## 4. Commit

- Commit granularity follows `CLAUDE.md` "Commit granularity" — **the spec file only**. When running in parallel, always scope the paths: `git add -- specs/features/F-xxx.md` then `git commit … -- specs/features/F-xxx.md`
- The subject is one line, `F-xxx {title} 명세`. If a decision got reversed, put the reason in the body

## 5. Keep going when nothing needs deciding

**If the spec leaves no real fork for the user, do not stop — commit it and go straight into `ship-feature`** (user instruction, 2026-09-21: "명세 작성 후 사용자가 검토할 결정이 없으면 바로 구현까지 진행"). Report the facts and say what you are starting; do not wait for a reply.

A real fork is one of these. Anything else is not:

- An option table where the recommendation could reasonably go the other way
- A decision that reverses something the user already settled
- A new dependency the overview did not already name
- The spec contradicting existing code or an approved spec

Open questions that all have sound defaults are **not** a fork. Write "기본값대로 간다" in the report and keep going. Under this instruction the spec counts as approved, so set `status: approved` with today's `approved:` date and say in the prose status line that the approval came from the standing instruction, not a separate review.

## 6. Report to the user (음슴체, short)

- Facts newly established by measurement or reading code — this is the most valuable part
- **Items needing a human decision, as options with a recommendation.** If every default is sound, bundle them as "기본값대로 갈지만 확인"
- The next spec to write and the implementation order (based on file overlap)

## When to stop

- No overview exists but the work spans several implementation units → ask the user whether to write the overview first
- `specs/product.md` pins the feature as out of scope → get approval to change the scope first
