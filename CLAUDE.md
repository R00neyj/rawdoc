# Rawdoc

A source-preserving Markdown collaboration tool. Typing `##` does not make the marks disappear, and exporting to `.md` gives back the exact bytes the user typed.

> Korean translation: `CLAUDE.ko.md` (snapshot as of 2026-09-21, for humans to read).
> **This file is the source of truth.** Edit rules here; the Korean copy does not follow automatically.
> UI strings, user quotes, and test selectors stay in Korean everywhere — they are product text, not prose.

- Product background, competitors, rationale for tech choices: `docs/research.html`
- Screen and feature prototype: `docs/prototype.html` (textarea + overlay approach. Reference for behavior only; do not follow its structure)

## Direction

1. **Web app first.** Finish it for desktop browsers. PWA (install, offline) counts as part of finishing the web app
2. Android (Capacitor) comes after the web app is done and there is room. Until then, no Android-only work
3. Order is spec → small spec → implementation. **If it is not in a spec, do not build it** — except a **tweak**: a small visual or interaction fix to something that already exists (color, spacing, copy, moving a button, menu order, hover/focus). Those skip the spec, go through the `tweak` skill, and leave one line in `specs/tweaks.md` as evidence. **Guide articles** (`content/guides/*.md` plus their help section) also skip the spec and go through the `write-guide` skill (user instruction, 2026-09-27: "명세 없이 바로 쓰는 걸로 바꿔"). Data, storage, server, new screens/commands/shortcuts, new dependencies and invariants still need a spec (user instruction, 2026-09-23)

## How we work (2026-09-18)

Logic gets TDD; design gets a fast human-review loop.

- **Logic is TDD.** Write the acceptance criteria as failing tests first (unit `*.test.ts`, browser behavior in `e2e/F-xxx`), confirm red (unit tests only — e2e are written first but their first run is after implementing, 2026-09-26), then implement. Write only as much as it takes to pass
- If a test could not come first (unknown shape of an external response, bug fixes, etc.), check whether the test you added afterward **fails against the pre-fix code**, decide whether it works as a regression test, and say so in your report
- **Design does not get TDD.** Smoke e2e only covers whether interactive elements — buttons, menus, dialogs — open, close, and respond. Do not pin visual values (color, spacing, alignment, typeface) in e2e: every value change would force a test change, and subpixel rendering makes them flaky (see F-146, F-166, F-225 in the `deploy` skill)
- **Build design fast and let the user look at it.** Keep the loop short: implement → `npm run dev` / deploy → user checks → fix. Hand visual judgment to `specs/human-checks.md` instead of having an agent sit on it

## Document layout

| Location | Contents | Edited |
| --- | --- | --- |
| `docs/` | Research and prototype originals | Never |
| `specs/product.md` | Full feature spec (scope, milestones, exclusions) | After human approval |
| `specs/ia.md` | Screen structure, user flows, states, UI strings | After human approval |
| `specs/design.md` | Typography, color tokens, shape and motion | After human approval |
| `specs/architecture.md` | `src/` layout, storage interfaces, state flow, setting keys | After human approval |
| `specs/features/F-xxx.md` | Small specs. One spec = one implementation unit. **Numbers run in hundreds per milestone** — M1 is `F-1NN`, M2 and M1 follow-ups are `F-2NN`, M3 (live collaboration) is `F-3NN` (user instruction, 2026-09-20). **When a milestone's hundred block fills up, it widens to four digits keeping the same leading digit** — M2 continues at `F-2001` onward, not `F-4NN` (user instruction, 2026-09-21; `F-2NN` ran out with only 298/299 left). The leading digit always says which milestone. `npm run specs` sorts numerically, so `F-201` still comes before `F-2001`. **YAML frontmatter at the top** (below) | After human approval |
| `specs/human-checks.md` | Items no automated test can judge, plus their status | By main, as each spec lands |
| `specs/tweaks.md` | One line per tweak (no-spec design/interaction fix): date, what, why (user's words), related spec | By main, in the tweak's commit |
| `specs/notes.md` | Discussion notes from before anything becomes a spec (direction, rationale, what is still open). Moved into `product.md` or an `F-xxx.md` once it settles, and deleted from here | Freely, no approval needed |
| `content/` | Public-site article sources, `.md` (F-272). `site/` reads them | Per spec |
| `site/` | Public-site build — articles → HTML, 404, sitemap, robots (F-272). `src/` never imports from here | Per spec |
| `e2e/` | Playwright E2E tests (F-150) | Per spec |
| `.workflow/` | Closed CM6 spike records (2026-09-07~08). Not used for new work | Never |
| `spike/` | Spike code. Reference only when porting the editor | Never |
| `src/` | The web app itself | Per spec |
| `cli/` | npm-published CLI (F-2021). `src/`·`worker/` never import from here | Per spec |
| `.claude/agents/`, `.claude/skills/` | Agent and skill definitions. **English is the source of truth** | As rules change |
| `.claude/ko/` | Korean snapshots of the above (2026-09-21). Not scanned as agents or skills, so they never register twice | Never auto-synced |

Reading order before starting work: this file → `specs/product.md` → `specs/ia.md` → `specs/design.md` → the relevant `specs/features/F-xxx.md`

### Spec frontmatter (user proposal, 2026-09-21)

Every `specs/features/F-xxx.md` starts with YAML frontmatter. Keep the prose status paragraph as it is — that is where the reasoning lives — and treat the frontmatter as the **machine-readable summary**. All 151 specs were backfilled.

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

- `status` meanings: `draft` rough / `pending` awaiting human approval / `approved` approved, not yet implemented / `done` implementation committed / `deferred` approved but start date undecided / `superseded` replaced by another spec / `overview` design overview (not an implementation unit)
- **Do not duplicate the file-ownership table into the frontmatter.** The chapter 1 table is the original and `npm run review` reads it. Two copies drift apart
- Query with `npm run specs`. Format errors, `done` without `implemented`, and `depends` pointing at a nonexistent spec are caught by `npm run specs -- --check`

## Tech stack

| Layer | Choice | Status |
| --- | --- | --- |
| Frontend | React 19, Vite 7, TypeScript 6.0 (`typescript-eslint`) | In use. JS → TS migration since 2026-09-15 (F-201~F-203). `e2e/` and `scripts/` stay JS |
| Editor | CodeMirror 6 + `@codemirror/lang-markdown` | In use |
| PWA | `vite-plugin-pwa` (Workbox) | In use |
| Static + API | Cloudflare Workers (static assets + `worker/`), custom domain `rawdoc.app` (workers.dev disabled) | In use (F-204). Structure in `specs/architecture.md` ch. 6 |
| Metadata DB / files | D1 `md-editor-db` / R2 `md-editor-attachments` | In use (F-205~) |
| Auth | `better-auth` 1.7.5 (Google·GitHub OAuth, D1 sessions) + `worker/apiTokens.ts` for CLI | F-2033 (replaces Access, F-205). Not deployed yet — deploy steps in `specs/features/F-2033.md` ch. 11 |
| CRDT / editor binding | `yjs` + `y-codemirror.next` (local `Y.Doc` per editor, no network) + `y-protocols` (awareness, F-307, 2026-09-24) | In use (F-302) |
| Live sync | Durable Object + y-partyserver | In use (server F-304 `worker/docRoom.ts`, client F-305 `src/app/useLiveDoc.ts`). Not deployed until F-306 lands |
| E2E tests | Playwright (`@playwright/test`), installed Chrome channel | Adopted in F-150 |
| 3D map | `three` + `d3-force-3d` (plus `@types/three` and a local `src/types/d3-force-3d.d.ts`) | Adopted in the F-292 revision (M2). F-2001 and F-2002 install them; no other spec may add a 3D dependency. `3d-force-graph` was measured and rejected — it statically pulls in `WebGPURenderer` |
| CLI | Node 22+, zero runtime dependencies, npm `rawdoc` | In use (F-2021) |
| Rate limiting | Workers Rate Limiting binding `WRITE_LIMITER` | In use (F-2026) |

For anything marked "not adopted", do not add the dependency until its spec exists.

## Commands

```
npm run dev          # web app dev server
npm run build        # web app build
npm run lint         # ESLint (whole repo)
npm test             # Vitest single run (src/**/*.test.{js,jsx,ts,tsx}, worker/**/*.test.ts)
npm run typecheck    # tsc --noEmit (app)
npm run typecheck:worker   # tsc -p worker
npm run build:cli    # vite build --config cli/vite.config.ts → cli/dist/rawdoc.js (F-2021)
npm run typecheck:cli   # tsc -p cli --noEmit
npm run dev:worker   # build, then wrangler dev (8790, local D1/R2). .dev.vars needs BETTER_AUTH_URL=http://localhost:8790 and BETTER_AUTH_SECRET; DEV_AUTH_EMAIL=…@example.com bypasses login (F-2033)
npm run cf:types     # wrangler.jsonc bindings → worker/worker-configuration.d.ts
npm run deploy       # build, then wrangler deploy (needs login). Normal deploys push the deploy branch — see "Deployment"
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright E2E — build, then e2e/*.spec.js against preview (4317) (F-150 onward)
npm run verify       # lint/unit/build summary (verify:full adds e2e, -- --repeat 2)
npm run e2e:one -- "F-152 A8a" --repeat 3   # repeat a subset of e2e; skips the build if it is current
npm run e2e:one -- e2e/site.spec.js "F-274 A9" --workers 2   # several targets at once; unknown flags pass through to playwright; prints the raw tail on failure
npm run e2e:before -- "F-246 A6" --ref 2f4099a --repeat 3   # run the same test at an earlier commit, to tell "my change broke it" from "it was already broken"
npm run measure -- --doc long:300 --select ".cm-line" --style line-height   # on-screen measurement JSON (4400, dist-measure)
npm run review -- F-xxx   # check for out-of-ownership files and forbidden patterns
npm run specs -- --todo   # remaining specs (--status pending, --milestone M3, --check, --json)
node scripts/admin-usage.mjs [--top N] [--local]   # view remote D1 usage (F-2029). block/unblock/warn/recount only write with --yes
node --test "scripts/lib/*.test.mjs"   # admin script tests (F-2029)
npm run clean        # delete dist-* e2e slots, test-results/, playwright-report/ (--all also drops dist/, --force ignores the 10-minute in-use guard)
E2E_PORT=4501 E2E_DIST=dist-a npx playwright test   # parallel e2e slot
npm run dev:spike    # for checking spikes
```

Put tests next to their target as `{name}.test.js` and import them explicitly in `vitest` (`specs/features/F-101.md` 5.3).

## Rules for main (the orchestrator)

There are two work machines (laptop and desktop), so this lives here instead of in local user memory.

- **Commit granularity follows the "Commit granularity" section below.** Launch the next subagent only after committing. Run specs in parallel only when their files do not overlap
- **Specs are written by the `spec-writer` agent** (`.claude/agents/spec-writer.md`, defined with Opus — user instruction 2026-09-20: "명세 작성을 sonnet 말고 opus로"). Do not pass a separate `model`. Implementation goes to `feature-implementer` (Sonnet) by default. **The 3D map rework is split per sub-spec — the `누가` column of `specs/features/F-292.md` ch. 9 is the decision** (user, 2026-09-21): main implements F-2002~F-2004 itself because renderer, camera and node appearance have to be fixed while looking at the screen; F-2006 goes to `complex-implementer`; the rest are ordinary handoffs
- **`complex-implementer` (Opus) is the third agent**, for a spec whose acceptance criteria are clear but whose route to them is not — graphics and 3D, CM6 internals, a frame or bundle budget, a refactor across several ownership tables, an external API nobody has run yet. It differs from `feature-implementer` by researching and measuring before building, deciding the gaps inside a criterion itself, and reporting build and precache deltas. The default stays `feature-implementer`; main names this one explicitly (user instruction, 2026-09-21: "복잡한 작업용 별도 에이전트 만들어두는것도 좋을듯")
- **Repeated prompts live in skills. Go through the skill instead of launching an agent directly** (user instruction, 2026-09-21). Stress-testing an idea before it becomes a spec is `grill`, spec writing is `write-spec`, implementation is `ship-feature`, a no-spec design or interaction fix is `tweak`, a guide article is `write-guide`. **`grill` replaces the generic `grilling` skill** — it puts every open decision to the user through `AskUserQuestion` instead of prose, because typed answers came back partial (2026-09-21). The prompt skeleton, the quality-raising instructions, and the report-review order are inside them
- **Implementation is the `ship-feature` skill + the `feature-implementer` agent.** The prompt carries only the spec number and the `E2E_PORT` / `E2E_DIST` slots. Judge with `npm run review -- F-xxx` then the related e2e. Use the tools in `scripts/` instead of ad-hoc scripts; if you see a repeat the tools do not cover, propose adding one
- **A spec that leaves no real fork goes straight to implementation.** Do not stop for approval when the only open questions have sound defaults — commit the spec, say so, and launch `ship-feature` in the same turn (user instruction, 2026-09-21: "명세 작성 후 사용자가 검토할 결정이 없으면 바로 구현까지 진행"). What still counts as a fork is listed in the `write-spec` skill, ch. 5
- `e2e:one` search terms can be OR'd with `|`, e.g. `"F-225|F-212"`. Slots are `--port`/`--dist` or `E2E_PORT`/`E2E_DIST`

## Commit granularity (user instruction, 2026-09-21)

**One commit = one unit.** A unit is one of three:

| Unit | What it contains | Example subject |
| --- | --- | --- |
| One spec written | a single `specs/features/F-xxx.md` (+ any upstream spec edits that spec listed under "갱신 대상") | `F-285 검색 입력 명세` |
| One spec implemented | the files in that spec's ownership table + tests + `specs/human-checks.md` + the frontmatter update | `문서 가져오기 (F-282)` |
| One change outside any spec | one bug fix, one docs/rules change, or one tool addition | `HTML 내보내기에서 CSS 가 평문으로 쏟아지던 버그` |
| One tweak | the changed code + its `specs/tweaks.md` line (+ the `design.md` / `ia.md` line it changed) | `사이드바 행 간격 줄임 (tweak)` |
| One guide article | `content/guides/{slug}.md` + its help section in `helpDoc.ts` + the number-check test rows + `specs/human-checks.md` rows; fact basis in the body | `검색 사용법 글 (guide)` |

How to hold to it:

- **A spec and its implementation are separate commits.** Split them even when you implement right after writing the spec — approval and implementation happen at different times, and they get reverted separately
- **Never put several F-numbers in one commit.** When working in parallel, scope explicitly: `git add -- <path>` then `git commit … -- <path>`. `git add -A` or a pathless `git commit` sweeps in whatever another agent staged (on 2026-09-15 the F-204 commit swallowed an F-201 rename)
- **Never split one F across several commits.** The single exception is stopping before verification is done; in that case put `검증 미완` in the subject
- **Commit as soon as a unit is done.** Uncommitted changes left to pile up bleed into the next task (that is exactly how specs got tangled on 2026-09-14)
- Implementation subjects read `{feature summary} (F-xxx)`; spec subjects read `F-xxx {title} 명세`. Body format is in the `ship-feature` skill, ch. 5
- After committing, update that spec's frontmatter to `status: done` and `implemented: {hash}`. The hash only exists after the commit, so `--amend` or carry it in the next commit
- **`.claude/settings.json` never rides along in another commit.** Permission and plugin entries churn per machine, so they stay out. The exception is a deliberate shared setting that has to reach both machines — currently the `PostToolUse` hook that opens a newly written spec in VS Code (user instruction, 2026-09-21). Change that on its own commit and say so in the subject

## Deployment (2026-09-15)

The full procedure — changelog rules, verify:full known failures, D1 migrations, local-deploy fallback, `.env` token, CLI publish — lives in the **`deploy` skill** (`.claude/skills/deploy/SKILL.md`). Load it before any deploy or before judging a verify:full failure. What must hold even without it:

- Pushing `main` runs CI only; it does not deploy. Deploying means `git push --force origin <sha>:refs/heads/deploy` with a SHA that passed `npm run verify:full`. **Tell the user before and after** (user: "다음 배포때 말만해줘")
- Never push to `deploy` without the day's `content/changelog.md` entry in the range (`.githooks/pre-push` enforces it; `--no-verify` only when nothing user-visible shipped)
- **Login redesign deploy (F-2033 ch. 11) is forward-only:** delete the Access app `md-editor-api` (step 5) *before* applying remote migrations (step 6), then push. Never reorder

## Invariants

Breaking one of these is a design violation, not a bug. To change one, fix the spec first and get human approval.

- **Decorations never change document content.** They change presentation only
- **The one source of truth for an open document is a single `Y.Text`.** When a remote link is attached, it is the `Y.Text` of the shared `Y.Doc` that link uses; the editor `Y.Doc` is a replica behind the IME gate that follows it only through Yjs updates. Without a link, the editor `Y.Doc` is the source. `EditorState` is a projection of the editor `Y.Text`, and `y-codemirror.next` connects the two. Do not keep any other copy of the body text and sync it by hand. D1 `docs.content` and the IndexedDB cached body are **one-way derivations** of `Y.Text`; never write those values back into an open `Y.Doc` (F-301 2.1, F-302). D1 `doc_comments` is likewise a one-way derivation of the `comments` `Y.Map`; D1 → `Y.Doc` happens only once, when the DO seeds an empty room together with the body (F-500 3.4, F-502, user approval 2026-09-26)
- **A view-role connection never writes through Yjs.** DocRoom does not apply sync step 2 or update messages from a view connection; comments from it arrive only as command messages the server validates (F-500 ch. 9, F-503, user approval 2026-09-26)
- **`src/` never imports from `spike/`.** Copy over what you need, and do not bring verification scaffolding like `imeLog`
- **If you defer recomputation during IME composition, you must catch up on the deferred work when composition ends.** Rationale: `.workflow/tasks/T-004/verify.md` 6.5 and ch. 7
- **Never apply remote updates during IME composition.** Remote Yjs updates that arrive during composition (including composition in a table-cell sub-editor) are queued and applied together at the same point as the `forceRecalc` on `compositionend`. Yjs merges regardless of order, so delayed application does not break consistency (F-301 2.1). A composition whose view has lost focus, or that the browser reports as not composing, counts as ended (F-303 5.4)
- **The product name is `rawdoc` (styled `Rawdoc`), settled 2026-09-17. The primary color is still undecided.** Even so, define it only in the root `brand.config.ts`; never write the name string or a color hex directly in code, CSS, HTML, UI text, or the manifest — the point is to keep values from scattering even after they are settled. Derive colors with `color-mix()` (`specs/design.md` 3.2)
- **One exception: third-party sign-in provider logos** (user decision, 2026-09-24). The official Google and GitHub logo SVGs keep their original colors and live only in `worker/providerLogos.ts`; never copy those color values anywhere else. The providers' brand rules forbid recoloring them (F-2032 3.3.1)
- **One more exception: the contact address `contact@rawdoc.app` in `content/legal/*.md`** (user decision, 2026-09-24: the domain is bought and will not change). It is a mailbox, not branding; do not copy the name string anywhere else
- **Storage identifiers stay fixed regardless of the product name.** Do not put the product name in the IndexedDB database name, localStorage keys, or service worker cache names. A rename must not lose the user's documents

Known pitfalls when porting the editor are in `.workflow/architecture.md` ch. 3 and `.workflow/tasks/T-004/verify.md` ch. 4–5 (`view.composing` timing, arrow-key assistance for block widgets colliding with `lineWrapping`, and so on).

## Rules for the implementing subagent

A Sonnet subagent implements one small spec at a time.

- Work only within the acceptance criteria and the file list of the `F-xxx.md` you were given
- **Write the tests first.** Turn that spec's behavioral acceptance criteria into tests, confirm they fail, then implement (see "How we work")
- Do not edit spec files (`specs/**`) or this file. If a spec is wrong or incomplete, stop and report
- Install only the dependencies the spec names
- When done, run lint and smoke tests only, and report the results verbatim: eslint on changed files, the related unit tests, and one e2e pass for that spec (`-g "F-xxx" --workers=2`). Full e2e only on user request or right before a deploy (user, 2026-09-15: "프로토타입인데 너무 엄격"). **Stop there**: no other specs' e2e for regression, no `--repeat`, no `e2e:before`, and new e2e are not run red first — red confirmation is for unit tests only; `verify:full` before a deploy catches regressions (user, 2026-09-26: "테스트 코드가 너무 많은것같아 … 병목")
- **Never run `git stash` (or `git checkout -- <path>`) to check what the code did before your change.** Several agents share one working tree, so a stash sweeps up everyone else's uncommitted work — it nearly cost an agent its files on 2026-09-15. Use `npm run e2e:before -- "<test>" --ref <sha>`, which builds a throwaway `git worktree` and never touches the working tree
- For measurements and partial e2e, use the tools in `scripts/` (measure, e2e-one, e2e-before, verify, review-diff) instead of temporary scripts. Work proceeds through the `ship-feature` skill + `feature-implementer` agent (F-160)
- A spec's **behavioral** acceptance criteria become Playwright tests named `e2e/F-xxx`, judged automatically (F-150 onward; do not substitute manual claude-in-chrome operation). Visual criteria get smoke coverage only — see "How we work"
- Criteria that cannot be automated (real Korean IME, OS windows, color and feel) do not become tests; report them as "사람 확인 필요". Main adds them to `specs/human-checks.md`
- Include in your report: files changed, pass/fail per acceptance criterion, and anything you could not verify. Never record a check you did not run as passing
- Do not commit
