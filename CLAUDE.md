# Rawdoc

A source-preserving Markdown collaboration tool. Typing `##` does not make the marks disappear, and exporting to `.md` gives back the exact bytes the user typed.

> **This file holds rules only.** Why each rule exists — the user instruction, date and incident behind it — lives in `CLAUDE.why.md`, grouped under the same section headings. Add a new rule here and its reason there.
> Korean translation: `CLAUDE.ko.md` (snapshot, for humans). This file is the source of truth; the Korean copy does not follow automatically.
> UI strings, user quotes, and test selectors stay in Korean everywhere.

- Product background, competitors, rationale for tech choices: `docs/research.html`
- Screen and feature prototype: `docs/prototype.html` (textarea + overlay approach. Reference for behavior only; do not follow its structure)

## Direction

1. **Web app first.** Finish it for desktop browsers. PWA (install, offline) counts as part of finishing the web app
2. Android (Capacitor) comes after the web app is done. Until then, no Android-only work
3. Order is spec → small spec → implementation. **If it is not in a spec, do not build it.** Exceptions:
   - **Tweak** — a small visual or interaction fix to something that already exists (color, spacing, copy, moving a button, menu order, hover/focus). Goes through the `tweak` skill and leaves one line in `specs/tweaks.md`
   - **Guide article** — `content/guides/*.md` plus its help section. Goes through the `write-guide` skill
   - Data, storage, server, new screens/commands/shortcuts, new dependencies and invariants always need a spec

## How we work

- **Logic is TDD.** Write the acceptance criteria as failing tests first (unit `*.test.ts`, browser behavior in `e2e/F-xxx`), confirm red for unit tests only (e2e are written first but first run after implementing), then implement. Write only as much as it takes to pass
- **Each criterion is tested in one place.** A criterion a pure function can decide gets a unit test only, never a second e2e. e2e is for what only a browser shows — wiring, focus, IME, sync between contexts — **at most 3 e2e per spec**; more needs a line in the spec saying why. App.tsx split characterization tests (F-2059) are exempt
- If a test could not come first (unknown external response shape, bug fixes), check whether the test you added **fails against the pre-fix code**, decide whether it works as a regression test, and say so in your report
- **A feature lives in its own component or hook file; `src/app/App.tsx` only wires it in.** A spec may grow App.tsx by at most 30 lines net; `npm run review` flags more as a violation. A spec that truly needs more writes `App.tsx 증가 허용: N — {reason}` in its body
- **Design does not get TDD.** Smoke e2e only covers whether interactive elements — buttons, menus, dialogs — open, close, and respond. Never pin visual values (color, spacing, alignment, typeface) in e2e
- **Build design fast and let the user look.** Implement → `npm run dev` / deploy → user checks → fix. Visual judgment goes to `specs/human-checks.md`, not to an agent

## Code comments

Overrides "match the surrounding code" — older multi-line blocks are not precedent. Applies to `src/`, `worker/`, `cli/`, `site/`; `e2e/` and `scripts/` are exempt.

- **A comment is one line.** If one line cannot say it, fix the code or the naming instead
- **Exception: a "why" the code cannot show** — a pitfall, a race, an external constraint — may take **at most two lines**. A spec or review number (`F-xxx`, `리뷰 Y3`) does not make a comment an exception; the number goes at the end of the one line
- No comments that restate what the code already says. Detailed rationale lives in the spec the number points to
- Clean up three-line-or-longer blocks whenever that code is touched

## Document layout

| Location | Contents | Edited |
| --- | --- | --- |
| `CLAUDE.why.md` | Reasons behind the rules in this file | With every rule change |
| `docs/` | Research and prototype originals | Never |
| `specs/product.md` | Full feature spec (scope, milestones, exclusions) | After human approval |
| `specs/ia.md` | Screen structure, user flows, states, UI strings | After human approval |
| `specs/design.md` | Typography, color tokens, shape and motion | After human approval |
| `specs/architecture.md` | `src/` layout, storage interfaces, state flow, setting keys | After human approval |
| `specs/features/F-xxx.md` | Small specs. One spec = one implementation unit. Numbers run in hundreds per milestone — M1 `F-1NN`, M2 and M1 follow-ups `F-2NN`, M3 (live collaboration) `F-3NN`. A full hundred block widens to four digits with the same leading digit (M2 continues at `F-2001`). `npm run specs` sorts numerically. YAML frontmatter at the top (below) | After human approval |
| `specs/human-checks.md` | Items no automated test can judge, plus their status | By main, as each spec lands |
| `specs/tweaks.md` | One line per tweak: date, what, why (user's words), related spec | By main, in the tweak's commit |
| `specs/map.md` | Mermaid map of every page, screen, dialog and feature group, plus the mobile review checklist. Derived from `ia.md` and the code, not a source of truth | By main, when a screen, layer or entry route is added or removed |
| `specs/notes.md` | Discussion notes before anything becomes a spec. Move into `product.md` or an `F-xxx.md` once settled, and delete here | Freely |
| `content/` | Public-site article sources, `.md` (F-272). `site/` reads them | Per spec |
| `site/` | Public-site build — articles → HTML, 404, sitemap, robots (F-272). `src/` never imports from here | Per spec |
| `e2e/` | Playwright E2E tests (F-150) | Per spec |
| `.workflow/` | Closed CM6 spike records. Not used for new work | Never |
| `spike/` | Spike code. Reference only when porting the editor | Never |
| `src/` | The web app itself | Per spec |
| `cli/` | npm-published CLI (F-2021). `src/`·`worker/` never import from here | Per spec |
| `.claude/agents/`, `.claude/skills/` | Agent and skill definitions. English is the source of truth | As rules change |
| `.claude/ko/` | Korean snapshots of the above. Not scanned as agents or skills | Never auto-synced |

Reading order before starting work: this file → `specs/product.md` → `specs/ia.md` → `specs/design.md` → the relevant `specs/features/F-xxx.md`

### Spec frontmatter

Every `specs/features/F-xxx.md` starts with YAML frontmatter. Keep the prose status paragraph (the reasoning); the frontmatter is the machine-readable summary.

```yaml
---
id: F-290                    # same as the filename
title: 설정 대화상자 왼쪽 탭    # the H1 with "F-290 " stripped
milestone: M1 | M2 | M3
status: draft | pending | approved | done | deferred | superseded | overview
created: 2026-09-21
approved: 2026-09-21         # date human approval was given. Omit the line entirely if not approved
implemented: cd23dbb         # implementation commit. Omit the line if none
depends: [F-232, F-281]      # prerequisite specs. Omit the line if none
---
```

- `status`: `draft` rough / `pending` awaiting human approval / `approved` approved, not yet implemented / `done` implementation committed / `deferred` approved, start date undecided / `superseded` replaced by another spec / `overview` design overview (not an implementation unit)
- **Never copy the file-ownership table into the frontmatter.** The chapter 1 table is the original and `npm run review` reads it
- Query with `npm run specs`. `npm run specs -- --check` catches format errors, `done` without `implemented`, and `depends` pointing at a nonexistent spec

## Tech stack

| Layer | Choice | Status |
| --- | --- | --- |
| Frontend | React 19, Vite 7, TypeScript 6.0 (`typescript-eslint`) | In use. `e2e/` and `scripts/` stay JS |
| Editor | CodeMirror 6 + `@codemirror/lang-markdown` | In use |
| PWA | `vite-plugin-pwa` (Workbox) | In use |
| Static + API | Cloudflare Workers (static assets + `worker/`), custom domain `rawdoc.app` (workers.dev disabled) | In use (F-204). Structure in `specs/architecture.md` ch. 6 |
| Metadata DB / files | D1 `md-editor-db` / R2 `md-editor-attachments` | In use (F-205~) |
| Auth | `better-auth` 1.7.5 (Google·GitHub OAuth, D1 sessions) + `worker/apiTokens.ts` for CLI | F-2033 (replaces Access, F-205). Not deployed yet — deploy steps in `specs/features/F-2033.md` ch. 11 |
| CRDT / editor binding | `yjs` + `y-codemirror.next` (local `Y.Doc` per editor, no network) + `y-protocols` (awareness, F-307) | In use (F-302) |
| Live sync | Durable Object + y-partyserver | In use (server F-304 `worker/docRoom.ts`, client F-305 `src/app/useLiveDoc.ts`). Deployed 2026-09-24 (F-305~F-308). Edit locks (F-213) stay as fallback until F-309 |
| E2E tests | Playwright (`@playwright/test`), installed Chrome channel | In use (F-150) |
| 3D map | `three` + `d3-force-3d` (plus `@types/three` and a local `src/types/d3-force-3d.d.ts`) | In use (F-292 revision). Only F-2001 and F-2002 install them; no other spec may add a 3D dependency. Never use `3d-force-graph` |
| Landing animation | gsap 3.15.0 (ScrollTrigger only), exact pin | In use (F-2049). Only `src/welcome/` may import it; the app, `worker/`, `site/`, `cli/` never do (`tests/src/welcome/gsapBoundary.test.ts`). Standard "No Charge" license, not open source |
| CLI | Node 22+, zero runtime dependencies, npm `rawdoc` | In use (F-2021) |
| Rate limiting | Workers Rate Limiting binding `WRITE_LIMITER` | In use (F-2026) |

Do not add a dependency marked "not adopted" until its spec exists.

## Commands

```
npm run dev          # web app dev server
npm run build        # web app build
npm run lint         # ESLint (whole repo)
npm test             # Vitest single run (tests/{src,worker,site,cli}/**/*.test.{js,jsx,ts,tsx})
npm run typecheck    # tsc --noEmit (app)
npm run typecheck:worker   # tsc -p worker
npm run build:cli    # vite build --config cli/vite.config.ts → cli/dist/rawdoc.js (F-2021)
npm run typecheck:cli   # tsc -p cli --noEmit
npm run dev:worker   # build, then wrangler dev (8790, local D1/R2). .dev.vars needs BETTER_AUTH_URL=http://localhost:8790 and BETTER_AUTH_SECRET; DEV_AUTH_EMAIL=…@example.com bypasses login (F-2033)
npm run cf:types     # wrangler.jsonc bindings → worker/worker-configuration.d.ts
npm run deploy       # build, then wrangler deploy (needs login). Normal deploys push the deploy branch — see "Deployment"
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright E2E — build, then e2e/*.spec.js against preview (4317)
npm run verify       # lint/unit/build summary (verify:full adds e2e, -- --repeat 2)
npm run e2e:one -- "F-152 A8a" --repeat 3   # repeat a subset of e2e; skips the build if it is current
npm run e2e:one -- e2e/site.spec.js "F-274 A9" --workers 2   # several targets at once; unknown flags pass through to playwright; prints the raw tail on failure
npm run e2e:before -- "F-246 A6" --ref 2f4099a --repeat 3   # run the same test at an earlier commit, to tell "my change broke it" from "it was already broken"
npm run measure -- --doc long:300 --select ".cm-line" --style line-height   # on-screen measurement JSON (4400, dist-measure)
npm run review -- F-xxx   # check for out-of-ownership files and forbidden patterns
npm run specs -- --todo   # remaining specs (--status pending, --milestone M3, --check, --json)
node scripts/admin-usage.mjs [--top N] [--local]   # view remote D1 usage (F-2029). block/unblock/warn/recount only write with --yes
node --test "tests/scripts/lib/*.test.mjs"   # admin script tests (F-2029)
npm run clean        # delete dist-* e2e slots, test-results/, playwright-report/ (--all also drops dist/, --force ignores the 10-minute in-use guard)
E2E_PORT=4501 E2E_DIST=dist-a npx playwright test   # parallel e2e slot
npm run dev:spike    # for checking spikes
```

Unit tests live under `tests/`, mirroring the source path: `tests/{source path}/{name}.test.ts` (`src/app/foo.ts` → `tests/src/app/foo.test.ts`, `scripts/lib/a.mjs` → `tests/scripts/lib/a.test.mjs`). Import the target by relative path and `vitest` explicitly (`specs/features/F-101.md` 5.3).

## Rules for main (the orchestrator)

- **Commit granularity follows "Commit granularity" below.** Launch the next subagent only after committing. Run specs in parallel only when their files do not overlap
- **Specs are written by the `spec-writer` agent** (Opus). Do not pass a separate `model`
- **Implementation goes to `feature-implementer`** (Sonnet, medium effort) by default
- **3D map rework is split per sub-spec by the `누가` column of `specs/features/F-292.md` ch. 9**: main implements F-2002~F-2004 itself; F-2006 goes to `complex-implementer`; the rest are ordinary handoffs
- **`complex-implementer` (Opus)** is for a spec whose acceptance criteria are clear but whose route is not — graphics and 3D, CM6 internals, a frame or bundle budget, a refactor across several ownership tables, an external API nobody has run yet. It researches and measures before building, decides the gaps inside a criterion itself, and reports build and precache deltas. Main names it explicitly; the default stays `feature-implementer`
- **Go through the skill instead of launching an agent directly.** Stress-testing an idea is `grill`, spec writing is `write-spec`, implementation is `ship-feature`, a no-spec design or interaction fix is `tweak`, a guide article is `write-guide`. Use `grill`, not the generic `grilling` skill — every open decision goes to the user through `AskUserQuestion`
- **Implementation prompts carry only the spec number and the `E2E_PORT` / `E2E_DIST` slots.** Judge with `npm run review -- F-xxx` then the related e2e. Use the tools in `scripts/` instead of ad-hoc scripts; propose a new tool when you see a repeat they do not cover
- **A spec that leaves no real fork goes straight to implementation.** When every open question has a sound default, commit the spec, say so, and launch `ship-feature` in the same turn. What counts as a fork is in the `write-spec` skill, ch. 5
- `e2e:one` search terms can be OR'd with `|`, e.g. `"F-225|F-212"`. Slots are `--port`/`--dist` or `E2E_PORT`/`E2E_DIST`

## Commit granularity

**One commit = one unit:**

| Unit | What it contains | Example subject |
| --- | --- | --- |
| One spec written | a single `specs/features/F-xxx.md` (+ any upstream spec edits that spec listed under "갱신 대상") | `F-285 검색 입력 명세` |
| One spec implemented | the files in that spec's ownership table + tests + `specs/human-checks.md` + the frontmatter update | `문서 가져오기 (F-282)` |
| One change outside any spec | one bug fix, one docs/rules change, or one tool addition | `HTML 내보내기에서 CSS 가 평문으로 쏟아지던 버그` |
| One tweak | the changed code + its `specs/tweaks.md` line (+ the `design.md` / `ia.md` line it changed) | `사이드바 행 간격 줄임 (tweak)` |
| One guide article | `content/guides/{slug}.md` + its help section in `helpDoc.ts` + the number-check test rows + `specs/human-checks.md` rows; fact basis in the body | `검색 사용법 글 (guide)` |

- **A spec and its implementation are separate commits**, even when you implement right after writing the spec
- **Never put several F-numbers in one commit.** Scope explicitly: `git add -- <path>` then `git commit … -- <path>`. Never `git add -A` or a pathless `git commit`
- **Never split one F across several commits.** The single exception is stopping before verification is done; then put `검증 미완` in the subject
- **Commit as soon as a unit is done**
- Implementation subjects read `{feature summary} (F-xxx)`; spec subjects read `F-xxx {title} 명세`. Body format is in the `ship-feature` skill, ch. 5
- After committing, set that spec's frontmatter to `status: done` and `implemented: {hash}` in a follow-up commit (an `--amend` changes the hash)
- **`.claude/settings.json` never rides along in another commit.** The only shared setting is the `PostToolUse` hook that opens a newly written spec in VS Code; change it on its own commit and say so in the subject

## Deployment

The full procedure — changelog rules, verify:full known failures, D1 migrations, local-deploy fallback, `.env` token, CLI publish — is in the **`deploy` skill** (`.claude/skills/deploy/SKILL.md`). Load it before any deploy or before judging a verify:full failure. Always:

- Pushing `main` runs CI only. Deploying means `git push --force origin <sha>:refs/heads/deploy` with a SHA that passed `npm run verify:full`. **Tell the user before and after**
- Never push to `deploy` without the day's `content/changelog.md` entry in the range (`.githooks/pre-push` enforces it; `--no-verify` only when nothing user-visible shipped)
- **Remote D1 migrations go before the code that reads them**
- **Login redesign deploy (F-2033 ch. 11) is forward-only:** delete the Access app `md-editor-api` (step 5) *before* applying remote migrations (step 6), then push. Never reorder

## Invariants

Breaking one of these is a design violation, not a bug. To change one, fix the spec first and get human approval.

- **Decorations never change document content.** They change presentation only
- **The one source of truth for an open document is a single `Y.Text`.** With a remote link attached, it is the `Y.Text` of that link's shared `Y.Doc`; the editor `Y.Doc` is a replica behind the IME gate that follows it only through Yjs updates. Without a link, the editor `Y.Doc` is the source. `EditorState` is a projection of the editor `Y.Text` via `y-codemirror.next`. Keep no other copy of the body text synced by hand. D1 `docs.content` and the IndexedDB cached body are **one-way derivations** of `Y.Text`; never write them back into an open `Y.Doc` (F-301 2.1, F-302). D1 `doc_comments` is likewise a one-way derivation of the `comments` `Y.Map`; D1 → `Y.Doc` happens only once, when the DO seeds an empty room together with the body (F-500 3.4, F-502)
- **A view-role connection never writes through Yjs.** DocRoom does not apply sync step 2 or update messages from a view connection; its comments arrive only as command messages the server validates (F-500 ch. 9, F-503)
- **`src/` never imports from `spike/`.** Copy what you need; never bring verification scaffolding like `imeLog`
- **Deferred recomputation during IME composition must be caught up when composition ends** (`.workflow/tasks/T-004/verify.md` 6.5, ch. 7)
- **Never apply remote updates during IME composition.** Queue remote Yjs updates that arrive during composition (including a table-cell sub-editor) and apply them at the same point as the `forceRecalc` on `compositionend` (F-301 2.1). A composition whose view has lost focus, or that the browser reports as not composing, counts as ended (F-303 5.4)
- **The product name is `rawdoc` (styled `Rawdoc`); the primary color is undecided.** Define both only in the root `brand.config.ts`; never write the name string or a color hex directly in code, CSS, HTML, UI text, or the manifest. Derive colors with `color-mix()` (`specs/design.md` 3.2)
  - Exception: the official Google and GitHub sign-in logo SVGs keep their original colors and live only in `worker/providerLogos.ts`; never copy those color values anywhere else (F-2032 3.3.1)
  - Exception: the contact address `contact@rawdoc.app` in `content/legal/*.md`; never copy the name string anywhere else
- **Storage identifiers never contain the product name** — not in the IndexedDB database name, localStorage keys, or service worker cache names

Known pitfalls when porting the editor are in `.workflow/architecture.md` ch. 3 and `.workflow/tasks/T-004/verify.md` ch. 4–5 (`view.composing` timing, arrow-key assistance for block widgets colliding with `lineWrapping`, and so on).

## Rules for the implementing subagent

A subagent implements one small spec at a time.

- Work only within the acceptance criteria and the file list of the `F-xxx.md` you were given
- **Write the tests first.** Turn the spec's behavioral acceptance criteria into tests, confirm unit tests fail, then implement (see "How we work")
- Never edit spec files (`specs/**`) or this file. If a spec is wrong or incomplete, stop and report
- Install only the dependencies the spec names
- When done, run and report verbatim: eslint on changed files, the related unit tests, and one e2e pass for that spec (`-g "F-xxx" --workers=2`). **Stop there** — no full e2e, no other specs' e2e, no `--repeat`, no `e2e:before`, and new e2e are not run red first
- **Never run `git stash` or `git checkout -- <path>`.** Several agents share one working tree. To see what the code did before your change, use `npm run e2e:before -- "<test>" --ref <sha>` (a throwaway `git worktree`). Remove it only with `npm run e2e:before -- --ref <sha> --remove x`, never `git worktree remove`
- For measurements and partial e2e, use the tools in `scripts/` (measure, e2e-one, e2e-before, verify, review-diff) instead of temporary scripts
- A spec's **behavioral** acceptance criteria that need a browser become Playwright tests named `e2e/F-xxx` (at most 3 per spec, see "How we work"), judged automatically — never substitute manual claude-in-chrome operation. Criteria a pure function can decide stay unit-only. Visual criteria get smoke coverage only
- Criteria that cannot be automated (real Korean IME, OS windows, color and feel) do not become tests; report them as "사람 확인 필요". Main adds them to `specs/human-checks.md`
- Report: files changed, pass/fail per acceptance criterion, and anything you could not verify. Never record a check you did not run as passing
- Do not commit
