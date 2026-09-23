---
name: tweak
description: Fixes a small design or interaction detail in Rawdoc directly, without writing a spec, and leaves a one-line note in specs/tweaks.md as evidence. Use it for requests like "간격 좀 줄여줘", "이 색 바꿔줘", "버튼 위치 옮겨줘", "메뉴 순서 바꿔", "명세 없이 바로 고쳐". Anything bigger goes to write-spec.
---

# tweak

Main does this itself — no agent. The point is a short loop: edit → user looks at `npm run dev` → edit again → commit.

Korean copy: `.claude/ko/skills/tweak/SKILL.ko.md` (snapshot, for humans). This file is the source of truth.

Rule basis: `CLAUDE.md` "Direction" 3 carries the exception for this skill (user instruction, 2026-09-23: "디자인 명세 구현안하고 빠르게 수정한 뒤 그냥 증거로 간단하게 노트 남기는 모드", scope "작은 동작까지", notes in `specs/tweaks.md`).

## 1. Is it a tweak?

**In scope** — change it directly:

- Visual: color, spacing, size, alignment, typeface, icon, shadow, motion, z-order
- UI copy: labels, tooltips, notice wording
- Small interactions on things that already exist: move a button, reorder menu items, hover / focus / active indication, which existing element gets focus, show or hide an existing control

**Out of scope** — stop and send it to `write-spec`:

- Data, storage, sync, server (`worker/`), migrations, the Yjs path
- A new screen, dialog, menu, command, or keyboard shortcut
- A new dependency
- Anything touching an invariant in `CLAUDE.md`
- Changing what a spec's **behavioral** acceptance criterion says (an `e2e/F-xxx` behavior test would have to change its expectation, not just its selector)

If it is borderline, say which side you put it on and why in one line, then proceed. If the user disagrees, they will say so.

Invariants still apply inside a tweak: no product name or color hex outside `brand.config.ts`, colors derived with `color-mix()`, decorations never change document content.

## 2. Loop

1. Find the code (`Grep` the class name, the UI string, or the component). Read `specs/design.md` / `specs/ia.md` for the value or string you are about to change
2. Edit. Keep to the existing tokens in `tokens.css` where one fits; add a token only if the value will be reused
3. Tell the user what changed and where to look. The dev server is usually already running (`npm run dev`); if not, start it in the background. Visual judgment belongs to the user — do not sit on screenshots or measurements unless asked
4. Repeat 2–3 until the user is satisfied

## 3. Check before committing

Light, as in "How we work" — no TDD, no new visual e2e:

- `npx eslint <changed files>`
- `Grep` `e2e/` for the class names, selectors, and UI strings you changed or removed. If any test uses them, run those tests once (`npm run e2e:one -- "<title>|<title>"`) and fix **selectors only**. If a behavioral expectation breaks, the change was not a tweak — stop (1)
- If a value or string in `specs/design.md` or `specs/ia.md` changed, update that line in the same commit. The user's request is the approval; say so in the note

## 4. Note — `specs/tweaks.md`

Append one row at the top of the table (newest first):

```
| 2026-09-23 | 사이드바 행 간격 6px → 4px | 사용자: "사이드바가 너무 헐렁함" | F-153, design.md 4.2 |
```

- 무엇을: before → after when there is a value
- 왜: quote the user's words; if the user said nothing about why, write `사용자 요청`
- 관련: the spec(s) whose screen it touches and any spec doc line you updated. `—` if none
- No commit hash column — `git log -- specs/tweaks.md` finds the commit

## 5. Commit

- One commit = one tweak request (several related changes on the same screen may share it). Files: the changed code + `specs/tweaks.md` + any `design.md` / `ia.md` line from (3)
- Scope paths explicitly: `git add -- <paths>` then `git commit … -- <paths>`
- Subject: `{what changed} (tweak)`. Body: one line on what was checked (eslint, which e2e)
- `git push`

## 6. Report (음슴체, short)

What changed, the commit hash, and anything the user should look at again.
