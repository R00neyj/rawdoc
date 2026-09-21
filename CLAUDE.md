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
3. Order is spec → small spec → implementation. **If it is not in a spec, do not build it**

## How we work (2026-09-18)

Logic gets TDD; design gets a fast human-review loop.

- **Logic is TDD.** Write the acceptance criteria as failing tests first (unit `*.test.ts`, browser behavior in `e2e/F-xxx`), confirm red, then implement. Write only as much as it takes to pass
- If a test could not come first (unknown shape of an external response, bug fixes, etc.), check whether the test you added afterward **fails against the pre-fix code**, decide whether it works as a regression test, and say so in your report
- **Design does not get TDD.** Smoke e2e only covers whether interactive elements — buttons, menus, dialogs — open, close, and respond. Do not pin visual values (color, spacing, alignment, typeface) in e2e: every value change would force a test change, and subpixel rendering makes them flaky (see F-146, F-166, F-225 under "Deployment")
- **Build design fast and let the user look at it.** Keep the loop short: implement → `npm run dev` / deploy → user checks → fix. Hand visual judgment to `specs/human-checks.md` instead of having an agent sit on it

## Document layout

| Location | Contents | Edited |
| --- | --- | --- |
| `docs/` | Research and prototype originals | Never |
| `specs/product.md` | Full feature spec (scope, milestones, exclusions) | After human approval |
| `specs/ia.md` | Screen structure, user flows, states, UI strings | After human approval |
| `specs/design.md` | Typography, color tokens, shape and motion | After human approval |
| `specs/architecture.md` | `src/` layout, storage interfaces, state flow, setting keys | After human approval |
| `specs/features/F-xxx.md` | Small specs. One spec = one implementation unit. **Numbers run in hundreds per milestone** — M1 is `F-1NN`, M2 and M1 follow-ups are `F-2NN`, M3 (live collaboration) is `F-3NN` (user instruction, 2026-09-20). **YAML frontmatter at the top** (below) | After human approval |
| `specs/human-checks.md` | Items no automated test can judge, plus their status | By main, as each spec lands |
| `content/` | Public-site article sources, `.md` (F-272). `site/` reads them | Per spec |
| `site/` | Public-site build — articles → HTML, 404, sitemap, robots (F-272). `src/` never imports from here | Per spec |
| `e2e/` | Playwright E2E tests (F-150) | Per spec |
| `.workflow/` | Closed CM6 spike records (2026-09-07~08). Not used for new work | Never |
| `spike/` | Spike code. Reference only when porting the editor | Never |
| `src/` | The web app itself | Per spec |
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
| Auth | Cloudflare Access one-time codes + Worker JWT verification | F-205 (Q5) |
| Live sync | Durable Object + y-partyserver, `y-codemirror.next` | Not adopted (M3) |
| E2E tests | Playwright (`@playwright/test`), installed Chrome channel | Adopted in F-150 |

For anything marked "not adopted", do not add the dependency until its spec exists.

## Commands

```
npm run dev          # web app dev server
npm run build        # web app build
npm run lint         # ESLint (whole repo)
npm test             # Vitest single run (src/**/*.test.{js,jsx,ts,tsx}, worker/**/*.test.ts)
npm run typecheck    # tsc --noEmit (app)
npm run typecheck:worker   # tsc -p worker
npm run dev:worker   # build, then wrangler dev (8790, local D1/R2). DEV_AUTH_EMAIL in .dev.vars bypasses login
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
npm run clean        # delete dist-* e2e slots, test-results/, playwright-report/ (--all also drops dist/, --force ignores the 10-minute in-use guard)
E2E_PORT=4501 E2E_DIST=dist-a npx playwright test   # parallel e2e slot
npm run dev:spike    # for checking spikes
```

Put tests next to their target as `{name}.test.js` and import them explicitly in `vitest` (`specs/features/F-101.md` 5.3).

## Rules for main (the orchestrator)

There are two work machines (laptop and desktop), so this lives here instead of in local user memory.

- **Commit granularity follows the "Commit granularity" section below.** Launch the next subagent only after committing. Run specs in parallel only when their files do not overlap
- **Specs are written by the `spec-writer` agent** (`.claude/agents/spec-writer.md`, defined with Opus — user instruction 2026-09-20: "명세 작성을 sonnet 말고 opus로"). Do not pass a separate `model`. Implementation uses `feature-implementer` (Sonnet)
- **Repeated prompts live in skills. Go through the skill instead of launching an agent directly** (user instruction, 2026-09-21). Spec writing is `write-spec`, implementation is `ship-feature`. The prompt skeleton, the quality-raising instructions, and the report-review order are inside them
- **Implementation is the `ship-feature` skill + the `feature-implementer` agent.** The prompt carries only the spec number and the `E2E_PORT` / `E2E_DIST` slots. Judge with `npm run review -- F-xxx` then the related e2e. Use the tools in `scripts/` instead of ad-hoc scripts; if you see a repeat the tools do not cover, propose adding one
- `e2e:one` search terms can be OR'd with `|`, e.g. `"F-225|F-212"`. Slots are `--port`/`--dist` or `E2E_PORT`/`E2E_DIST`

## Commit granularity (user instruction, 2026-09-21)

**One commit = one unit.** A unit is one of three:

| Unit | What it contains | Example subject |
| --- | --- | --- |
| One spec written | a single `specs/features/F-xxx.md` (+ any upstream spec edits that spec listed under "갱신 대상") | `F-285 검색 입력 명세` |
| One spec implemented | the files in that spec's ownership table + tests + `specs/human-checks.md` + the frontmatter update | `문서 가져오기 (F-282)` |
| One change outside any spec | one bug fix, one docs/rules change, or one tool addition | `HTML 내보내기에서 CSS 가 평문으로 쏟아지던 버그` |

How to hold to it:

- **A spec and its implementation are separate commits.** Split them even when you implement right after writing the spec — approval and implementation happen at different times, and they get reverted separately
- **Never put several F-numbers in one commit.** When working in parallel, scope explicitly: `git add -- <path>` then `git commit … -- <path>`. `git add -A` or a pathless `git commit` sweeps in whatever another agent staged (on 2026-09-15 the F-204 commit swallowed an F-201 rename)
- **Never split one F across several commits.** The single exception is stopping before verification is done; in that case put `검증 미완` in the subject
- **Commit as soon as a unit is done.** Uncommitted changes left to pile up bleed into the next task (that is exactly how specs got tangled on 2026-09-14)
- Implementation subjects read `{feature summary} (F-xxx)`; spec subjects read `F-xxx {title} 명세`. Body format is in the `ship-feature` skill, ch. 5
- After committing, update that spec's frontmatter to `status: done` and `implemented: {hash}`. The hash only exists after the commit, so `--amend` or carry it in the next commit
- `.claude/settings.json` goes into no commit, ever

## Deployment (2026-09-15)

- Pushing `main` runs GitHub Actions `ci.yml` (lint, types, unit, build) only. It does not deploy
- **Before deploying, add the day's changelog entry.** Put a `## YYYY-MM-DD` group at the top of `content/changelog.md` with one line per user-visible change since the last deploy — what a user can now do, not what changed in the code. Leave out specs, tests, tooling and refactors; the full rules are `specs/features/F-273.md` ch. 3. Set the frontmatter `updated:` to the same date, commit it on its own (subject `체인지로그 {날짜} 항목`), and deploy a SHA that includes it — an entry added after the push does not reach the site until the next deploy
- **`.githooks/pre-push` enforces that** (user instruction, 2026-09-21: "베포시 체인지로그 작성은 훅으로 고정"). It rejects a push to `deploy` when the range `origin/deploy`..`<pushed sha>` contains no `content/changelog.md` change. `npm install` installs it by setting `core.hooksPath` (`scripts/install-hooks.mjs`), so it is per-machine setup that happens on its own. If nothing user-visible shipped, push with `--no-verify`
- To deploy, push a `main` commit that passed `npm run verify:full` to the `deploy` branch: `git push --force origin <sha>:refs/heads/deploy` → Cloudflare Workers Builds (`md-editor-web`, branch control `deploy`) builds and deploys. **Tell the user before and after** (user: "다음 배포때 말만해줘")
- To confirm: the Cloudflare check run on that commit, and whether the `assets/index-*.js` name at `https://rawdoc.app/` matches the local build. First build confirmed 2026-09-15 on `c75c14f`: `Workers Builds: md-editor-web` succeeded and went live about a minute after the push
- Known failures in verify:full: F-146 A2 (failing from the start). F-146 A4, F-152 A5, F-156, F-158 A2, F-158 A8, F-208, F-213 A5, F-225 A1/A2, F-210 C1/C2, F-143 A16 are flaky under load and subpixel rendering — judge them by rerunning alone (F-146 A4 was found during F-232 on 2026-09-16, presumed a Dialog focus-return timing race, unrelated to F-232 — confirmed by 4 failures out of 5 solo runs on HEAD. F-225 A1 was reconfirmed during pre-deploy verification for F-234 on 2026-09-16 — a `git worktree` at the pre-session commit (`1b17c8b`) also failed 2 of 3 times, so it is unrelated to the session's changes; presumed subpixel, with the `.invite-submit` / `.invite-role-seg` row alignment drifting around the 2px threshold by roughly 0.5px)
- F-166 A1/A3 (x coordinate and hanging indent of the second visual line in a long ordered list) were also found during pre-deploy verification for F-238 on 2026-09-17 — they keep failing even alone, and a `git worktree` at the pre-F-238 commit (`49b5a20`) failed identically, so they are unrelated to that session. Cause not investigated; listed only
- F-247 A7 (subfolders and docs not restored after deleting everything) and F-209 A6 (pasted image surviving a reload) were found during pre-deploy verification for the share-link back-navigation fix on 2026-09-19 — 2 and 1 failures respectively out of 5 solo runs, and a `git worktree` before that commit (`ee0ce8d`) failed 2 and 1 times out of 5 as well, so they are unrelated to that session. Cause not investigated; listed only
- F-271 A6 (first visit — landing page only) was found during F-272 on 2026-09-21 — it **fails 5 out of 5 even when rerun alone**. A `git worktree` at the pre-F-272 commit (`a807be3`) failed 5 out of 5 identically, so it is unrelated to F-272. Presumed to be the timing of the landing demo mounting as a CM6 editor, which turns the accessibility tree's heading into a textbox. Cause not investigated
- F-246 A6 (create a folder, then press `새 폴더` again) was found during the checkbox strikethrough work on 2026-09-21 — 3 out of 3 solo failures (30s timeout clicking `새 폴더` in `.sidebar-btn`). A `git worktree` at the commit before that work (`2f4099a`) failed 3 out of 3 identically, so it is unrelated. Cause not investigated
- **These were broken, not flaky. Found during F-290 on 2026-09-21, traced and fixed the same day (`5dc3ac4`, plus a follow-up commit for the last two). All seven now pass 3 out of 3 alone**
  - `F-153 A4`, `F-246 A6` — broke at `0705550` (2026-09-20, "새문서·새폴더·가져오기를 아이콘 버튼으로"), which removed `.sidebar-btn` and `.sidebar-btn-label` without updating the e2e that used them. Both pass at `90ba61a`, the commit right before. **Fixed**, but F-153 A4's reference point (the `새 문서` button's *text*) no longer exists on screen, so the test now only checks that the rows line up with each other — **`specs/features/F-153.md` ch. 3 and A4 still need fixing, which needs human approval**
  - `F-281 A12`, `F-281 A13` — a closing menu lingers as `inert`, so `getByRole('menuitem')` matched two elements. Scoped to `.item-menu-list:not([inert])`. A12 also clicked an already-expanded folder and collapsed it. **Fixed** (same cause the F-282 agent hit independently)
  - `F-281 A15` — the app seeds a `사용법` document on first run, so the state was never empty. The test now presets `md.firstRunDone`, and closes the storage-protection warning first because that notice occupies the slot and hides the new one. **Fixed**
  - `F-281 A12/A14/A15` had never passed since the commit that introduced them (`6869f98`)
  - `F-281 A14` — the test was wrong, not the product. `fakeServer.setOffline(true)` only flips a flag that makes routes abort; the app's `syncState.online` goes false only when a request actually fails or the browser fires `offline` (`serverStore.ts`), and the test opened Settings without sending a request. It now dispatches the `offline` event. **Fixed** (2026-09-21)
  - `F-146 A8` — `window.open` was being called all along (verified by stubbing `window.open` in the page: it received `https://example.com`). The test waited a fixed 200ms for `popup`, which arrives around 1s. Replaced with `page.waitForEvent('popup')`. **Fixed** (2026-09-21)
- **2026-09-21 pre-deploy run (F-291/F-292/F-294/F-297 batch).** `F-156 A7` was a real regression, not a flake: `a565235` (Mermaid dark, F-260) made `App.tsx` call `setTheme` on mount, and that reconfigure restarts `blockPreview`'s StateField from `create`, where the new ViewPlugin has not filled `viewRef` yet — so focus reads false and a code block under the cursor collapses into a widget. Bisected with `e2e:before` (passes at `32616a9`, fails at `a565235`); fixed in `64c2024` by dispatching `forceRecalc` after the reconfigure. `F-291 A22` had been passing only because of that bug and was fixed in `985ccac`
- Everything else in that run was load contention under `verify:full` and passed when rerun alone: F-222 A4, F-224 A3, F-225 A5, F-209 A6, F-243 A8, F-227 A3, F-250 A4, F-271 A9, F-272 A12, F-274 A14, F-275 A10, F-276 A14. `e2e/docLock.spec.js` fails 2–3 tests under `--repeat 2` but passes 7/7 at `--workers 1` and `--workers 2` — the lock tests wait 10–20s and lose the race under load. The only constant failures left are **F-271 A6** and **F-146 A2**
- F-222 A4 (token revocation), F-224 A4 (dialog width in a narrow window), and F-225 A6 (focus after deleting an invite) were found during pre-deploy verification for F-261 on 2026-09-20 — rerunning the three together makes 1–2 of them fail at random each time (`workers` load), and a `git worktree` at the pre-F-261 commit (`f839ecc`) failed at the same rate with the same combination and repeat count, so they are unrelated to F-261. Cause not investigated; listed only
- Remote D1 migrations are not automated. If there is a new `migrations/000N`, run `npx wrangler d1 migrations apply md-editor-db --remote` before deploying
- If the build does not run, deploy locally: from a clean worktree `../rawdoc-deploy` (create it with `git worktree add ../rawdoc-deploy deploy` if missing), run `npm run deploy`
- If the root `.env` (never committed, separate per machine) has `CLOUDFLARE_API_TOKEN`, wrangler uses that token instead of browser login. The token was reissued on 2026-09-18 with Workers Scripts edit, D1 edit, and R2 edit permissions — local deploys and remote migrations both work straight from `.env`. `num_tables: 0` in `wrangler d1 list` is just Cloudflare's aggregation lagging, so read the schema with `d1 migrations list --remote`

## Invariants

Breaking one of these is a design violation, not a bug. To change one, fix the spec first and get human approval.

- **Decorations never change document content.** They change presentation only
- **There is exactly one source of truth for document state: the CM6 `EditorState`.** Do not keep a separate string copy in sync with it
- **`src/` never imports from `spike/`.** Copy over what you need, and do not bring verification scaffolding like `imeLog`
- **If you defer recomputation during IME composition, you must catch up on the deferred work when composition ends.** Rationale: `.workflow/tasks/T-004/verify.md` 6.5 and ch. 7
- **The product name is `rawdoc` (styled `Rawdoc`), settled 2026-09-17. The primary color is still undecided.** Even so, define it only in the root `brand.config.ts`; never write the name string or a color hex directly in code, CSS, HTML, UI text, or the manifest — the point is to keep values from scattering even after they are settled. Derive colors with `color-mix()` (`specs/design.md` 3.2)
- **Storage identifiers stay fixed regardless of the product name.** Do not put the product name in the IndexedDB database name, localStorage keys, or service worker cache names. A rename must not lose the user's documents

Known pitfalls when porting the editor are in `.workflow/architecture.md` ch. 3 and `.workflow/tasks/T-004/verify.md` ch. 4–5 (`view.composing` timing, arrow-key assistance for block widgets colliding with `lineWrapping`, and so on).

## Rules for the implementing subagent

A Sonnet subagent implements one small spec at a time.

- Work only within the acceptance criteria and the file list of the `F-xxx.md` you were given
- **Write the tests first.** Turn that spec's behavioral acceptance criteria into tests, confirm they fail, then implement (see "How we work")
- Do not edit spec files (`specs/**`) or this file. If a spec is wrong or incomplete, stop and report
- Install only the dependencies the spec names
- When done, run lint and smoke tests only, and report the results verbatim: eslint on changed files, the related unit tests, and one e2e pass for that spec (`-g "F-xxx" --workers=2`). Full e2e only on user request or right before a deploy (user, 2026-09-15: "프로토타입인데 너무 엄격")
- **Never run `git stash` (or `git checkout -- <path>`) to check what the code did before your change.** Several agents share one working tree, so a stash sweeps up everyone else's uncommitted work — it nearly cost an agent its files on 2026-09-15. Use `npm run e2e:before -- "<test>" --ref <sha>`, which builds a throwaway `git worktree` and never touches the working tree
- For measurements and partial e2e, use the tools in `scripts/` (measure, e2e-one, e2e-before, verify, review-diff) instead of temporary scripts. Work proceeds through the `ship-feature` skill + `feature-implementer` agent (F-160)
- A spec's **behavioral** acceptance criteria become Playwright tests named `e2e/F-xxx`, judged automatically (F-150 onward; do not substitute manual claude-in-chrome operation). Visual criteria get smoke coverage only — see "How we work"
- Criteria that cannot be automated (real Korean IME, OS windows, color and feel) do not become tests; report them as "사람 확인 필요". Main adds them to `specs/human-checks.md`
- Include in your report: files changed, pass/fail per acceptance criterion, and anything you could not verify. Never record a check you did not run as passing
- Do not commit
