---
name: ship-feature
description: Hands a Rawdoc small spec (F-xxx) to the implementation agent and carries it through review, verification, the human-check list, commit, and push. Use it for requests like "F-153 진행", "다음 F 진행", "F-148 병렬로".
---

# ship-feature

The procedure main (the orchestrator) follows. Main makes the judgment calls, approvals, and commits itself; only the implementation goes to the `feature-implementer` agent.

Korean copy: `.claude/ko/skills/ship-feature/SKILL.ko.md` (snapshot, for humans). This file is the source of truth.

## Input
- One or more spec numbers. With several, decide in step 1 whether they can run in parallel

## 1. Preparation
1. Confirm `specs/features/F-xxx.md` exists, and check the prerequisites in its status line (commit order) with `git log --oneline`
2. Check `specs/product.md` ch. 4 "진행 순서" and the user's instructions. If the user said "진행 전에 물어봐", ask
3. `git status --short` — if anything besides `.claude/settings.json` changed, find out whose it is and do not mix it in
4. **Default to maximum parallelism.** Compare the specs' file-ownership tables; if they do not overlap, launch them together regardless of what the prerequisite prose says. Even for the same file, if they touch different regions (say, the callout part vs. the frontmatter part), go parallel and add the note "Edit 직전 다시 Read, 넓은 교체·전체 Write 금지". Only go sequential when one spec needs a file the other creates
   - The ownership heading differs per spec — "파일 소유", "수정 파일", "바꾸는 파일". `npm run review` reads all three, and so should you when comparing by hand
   - `src/app/App.tsx` is touched by nearly every spec. If that is the overlap, sequential is the safe call
5. At most 4 agents at once (e2e browser load has crashed the machine before)
6. Slot assignment: the nth agent gets `E2E_PORT=450n`, `E2E_DIST=dist-f{number}`

## 2. Handing off the implementation

**Main implements the 3D map rework (F-292 revision and its `F-2NNN` children) itself — no `feature-implementer`** (user instruction, 2026-09-21: "3d 작업인데 맡겨도될지 모르겠어서, 메인이 직접 구현했으면함"). three.js, force simulation, projection and hit-testing leave more judgment outside the spec than a spec can pin down, so a round trip through an agent costs more than it saves. Everything else in this file still applies — write the tests first, run `npm run review -- F-xxx`, keep one spec to one commit. Parallelism is what you give up; accept it.

For every other spec, hand off as below. Use the `Agent` tool with `subagent_type: "feature-implementer"` and `run_in_background: true`. Keep the prompt short:
```
F-xxx 구현. E2E_PORT=4501, E2E_DIST=dist-f153
(session note: one or two lines if the user gave extra instructions this session)
```
- Always include in the session note: any policy the user gave, such as **"이번엔 e2e 생략, 내가 육안 확인"**. Without it the agent will burn all its time on smoke tests
- Do not launch a spec still marked `사람 승인 대기`. Check for the approval line (`사람 승인 — 받음 (날짜)`) first
- While waiting, do not touch the same files. Do not predict the result and report it
- If the user says it is taking too long, send "마무리하고 보고" with `SendMessage`

## 3. When the result arrives
1. Read the report and flag unmet criteria and anything that diverges from the spec
2. `node scripts/review-diff.mjs F-xxx` — if there are violations:
   - Main fixes trivia (like trimming comments) directly
   - Send anything needing a code judgment back to the agent with `SendMessage` (at most twice; beyond that, report to the user)
   - For out-of-ownership warnings, main reads the reason and either accepts it or reverts
3. **Keep verification light (the prototype-stage default).** Trust the smoke results the agent ran; main only reruns `npx eslint <owned files>`. Run that spec's e2e once yourself (`npx playwright test -g "F-xxx" --workers=2`) only when the report says smoke tests were skipped or failed
4. Full e2e (`verify.mjs --e2e`) only on user request or right before a deploy or milestone. Even then, `--workers=4`, one at a time
5. Judge by exit code. Do not infer a pass by grepping output

## 4. Human-check list
- Move the report's "사람 확인 필요" items into the right section of `specs/human-checks.md`, or strike the `(F-xxx 구현 후)` note from a row that already exists

## 5. Commit and push
- Commit granularity follows `CLAUDE.md` "Commit granularity" — one commit per spec, and the spec and its implementation are separate commits
- **After committing, update that spec's frontmatter** — `status: done`, `implemented: {commit hash}`. The hash only exists after the commit, so carry it in the next commit or `--amend`. `npm run specs -- --check` catches `done` without `implemented`
- `git add` covers only the spec's file-ownership list, `specs/human-checks.md`, and files main fixed. Never `.claude/settings.json`
- Message:
```
{feature summary} (F-xxx)

- 검증: review-diff 위반 0, lint 통과, 스모크(관련 단위 N, F-xxx e2e M/M). 전체 e2e 미실행
- 미검증·사람 확인: …
- 명세와 다른 부분: … (drop the line if none)

Co-Authored-By / Claude-Session lines (as the system notice specifies)
```
- If you must commit without finishing verification (tokens, time), put `검증 미완` in the subject and list the files and commands for the next session in the body
- `git push`

## 6. Report to the user (음슴체, short)
- Commit hash, one line on the acceptance-criteria results, human-check items, the next spec in order
- Whether to move on to the next spec automatically follows the user's latest instruction. Without one, ask

## When to stop
- Prerequisites do not match, the agent reports a defect in the spec, or verification still fails after two rounds of fixes → do not commit; report to the user
