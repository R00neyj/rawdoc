---
name: grill
description: Stress-tests a plan or idea before it becomes a spec, by putting every open decision to the user as clickable options with a recommendation. Use it for requests like "그릴링 해줘", "이 아이디어 검증해줘", "명세 쓰기 전에 따져보자", "이거 괜찮은지 봐줘". Produces the decision table that write-spec's prompt is built from.
---

# grill

Interrogate a plan until every decision is settled, then hand the settled decisions to `write-spec`.

Korean copy: `.claude/ko/skills/grill/SKILL.ko.md` (snapshot, for humans). This file is the source of truth.

This is a Rawdoc-local replacement for the generic `grilling` skill. The difference is the **delivery**: decisions go to the user through `AskUserQuestion` as clickable options, never as prose the user has to answer by typing.

## 1. Why this exists

The generic skill prints numbered questions and waits for typed answers. In practice that produced two failures:

- The user had to re-type the option they wanted, so answers came back partial — a whole question got skipped without anyone noticing (2026-09-21, the touch-rotation question went unanswered for a full round)
- Options with real trade-offs were hard to compare in a wall of prose

`AskUserQuestion` fixes both: every question is answered or explicitly skipped, and `preview` puts the concrete shape of each option side by side.

## 2. The loop

Work the decisions as a **tree**. The **frontier** is every decision whose prerequisites are already settled — the questions answerable *now* without guessing at an answer you have not heard yet.

Each round:

1. **Find the facts yourself.** Never ask the user something the repo, npm, or the web can tell you. Dispatch a subagent for anything that takes more than a couple of commands (bundle sizes, how a library actually behaves, what an existing spec locked in). Do not block on it — a running exploration is an unsettled prerequisite, so only the questions downstream of it wait
2. **Ask the frontier through `AskUserQuestion`.** Up to 4 questions per call; if the frontier is wider, split across calls in the same turn
3. **Read the answers, recompute the frontier.** Answers push it outward and unblock what depended on them
4. Stop when the frontier is empty

## 3. Writing the questions

- **The recommended option goes first and is labeled `(추천)`.** Recommend on every question — "둘 다 일리 있음" is not a recommendation
- **Put the cost in the option, not in the question.** `Canvas 2D + d3-force-3d — 9KB (추천)` beats a label that makes the user open the description to learn the price
- **Use `preview` whenever the options differ in shape** — a control mapping, a file list, what survives and what dies, before/after. Previews render side by side and are where comparison actually happens. Keep them short; they are a diagram, not a paragraph
- **Put the pressure in the question body.** This is a grilling, so the question states the objection plainly: *"3D 그래프는 정보를 더 보여주지 않고 가려진 걸 회전으로 바꿔 보게 만듦"*. Then the options let the user answer it
- **Cite what is already fixed.** Name the spec, the file, the line: *"이 앱은 우클릭을 이미 쓰고 있음 — F-170, `createEditor.ts:227`, 그리고 F-174 가 미구현으로 남아 있음"*. A decision made against a constraint the user did not know about is not a decision
- Headers are 12 characters at most, so they are a label (`렌더러`, `터치 회전`, `PWA 캐시`), not a summary
- Write Korean literally in the tool parameters. Never `\uXXXX`

## 4. When the user goes against the recommendation

Take it. Then ask the **next** question their choice creates, instead of re-litigating the one they just answered.

> The user chose "F-292 를 직접 개정" over the recommended per-chapter verdict. The reply did not re-argue; it named the bookkeeping that choice broke (`status: done` + `implemented: 24fadd2` would now point at code that does not match the text) and proposed the fix.

If a choice contradicts an earlier one, say which two and ask which wins — that is a new question, not a repeat.

## 5. Closing

The session is done when the frontier is empty. Then:

1. **Print the full decision table** — every decision in one table, in the order the specs will need them. This table is the raw material for `write-spec`'s "사용자가 이미 정한 것 (바꾸지 말 것)" section, so it must be complete enough to paste
2. **Name the loose ends** the answers created — bookkeeping, contradictions with existing specs, files that need updating
3. **Ask the user to confirm the understanding is shared.** Do not start writing specs on the strength of the answers alone

Then hand off to `write-spec`. Carry the measured facts into that prompt under "이미 측정해 둔 것 (다시 조사하지 말 것)" so the spec agent does not spend its budget re-deriving them.

## When to stop and ask instead

- The idea contradicts an invariant in `CLAUDE.md` — settle whether the invariant moves before grilling the rest
- `specs/product.md` records the feature as out of scope — that is one question, asked first
- The answers imply throwing away shipped code: say how much and which commits, as its own question
