---
name: polish-korean
description: Polishes Korean prose in Rawdoc's user-facing text (content/changelog.md, content/guides/*.md, README) by removing AI-sounding patterns while keeping meaning, facts, code and UI strings intact, following the im-not-ai method. Use it for requests like "윤문해줘", "AI 말투 빼줘", "im not ai 참조해서 다듬어줘", and always when writing or editing a changelog entry.
---

# polish-korean

Korean copy: `.claude/ko/skills/polish-korean/SKILL.ko.md` (snapshot, for humans). This file is the source of truth.

Basis: im-not-ai (https://github.com/epoko77-ai/im-not-ai, `skills/humanize-korean/references/`). User instruction, 2026-10-05: "윤문 스킬 만들고 체인지로그는 항상 스킬 참조하도록 해줘".

## 1. When it applies

- **Every `content/changelog.md` entry, every time.** Write the entry, then run this pass over the lines you added before committing (`deploy` skill)
- On request: guides, README, `cli/README.md`, help text. Never `specs/**`, `CLAUDE*.md`, code comments, or test fixtures unless the user names them

## 2. Four rules

1. **Meaning does not move.** Facts, numbers, versions, proper nouns, causes and conditions stay as they are
2. **Surgical.** Touch only a sentence that hits a pattern in ch. 3. A clean sentence stays as it is
3. **Keep the register and the form.** Rawdoc's public text is 합니다체. Keep headings, bold labels, tables, list counts and order, and the `—` separator where the file already uses it as a format
4. **Do not over-polish.** Aim for 5–30% of lines changed per file. Over 30%, stop and check that each change answers a pattern; never make it literary

## 3. Patterns to fix

| Group | Look for | Fix |
| --- | --- | --- |
| Translationese | `~를 통해`, `~에 대해/관해`, `~에 있어서`, `~에 의해` passive, `~되어지다`, `-에서의/-에로의`, `~로부터` | `~로`, plain object marker, active voice, single passive, unpack into a clause |
| Inanimate subject + causative | "모드는 ~하게 합니다", "기능이 ~를 가능하게 합니다" | Make the person or the place the subject: "~에서는 ~할 수 있습니다" |
| Long modifier | 3+ words stacked before a noun | Split into two sentences |
| Run-on | 3+ clauses chained with commas or `~고 ~며` | Split; keep the item count the same |
| Nominalization | "저장을 시도합니다", "실행이 됩니다" | Verb: "저장하려고 합니다", "실행할 수 있습니다" |
| Formal nouns | `~것입니다`, `~할 필요가 있다`, `~점`, `~바` | Say it directly |
| Cleft | "핵심은 ~이다", "가장 쓸모 있는 쓰임은 ~이다" | Subject-verb: "~할 때 가장 쓸모 있습니다" |
| AI idioms | "결론적으로", "주목할 만하다", "시사하는 바", "단순한 A가 아닌 B", "A를 넘어", "순간" | Delete or state the concrete fact |
| Stacked hedging | "~할 수 있을 것으로 보입니다" | One hedge at the same strength |
| Intensifiers | "매우", "정말", "특히 자주", synonym pairs | Delete, or replace with the concrete reason |
| Plural `-들` | on inanimate or abstract nouns | Delete |
| Sentence-initial connectives | "또한/따라서/즉/나아가" in a row | Delete or merge |
| Ending monotony | the same ending 4+ sentences in a row | Vary a few |
| Decoration | bold, quotes or dashes used for emphasis, not as the file's format | Remove the emphasis |

## 4. Never change

- Frontmatter keys and values (a changelog `updated:` is set by the `deploy` skill, not here)
- Headings — they can be link anchors. In the changelog, the `## YYYY-MM-DD` groups
- Anything in backticks: commands, code, UI strings such as `가져오기`. Link targets, `[[위키링크]]` examples, code blocks, callout syntax
- Numbers, units, versions, table columns, the count and order of items and paragraphs

## 5. Changelog extras

- Each line says what a user can now do or what no longer goes wrong (`specs/features/F-273.md` ch. 3). Turn implementation talk into what the user sees — internal terms like "폴백", "자리를 먼저 잡아 두어" go — without changing the fact
- Keep one change per line. Splitting a run-on means more sentences on the same line, never more lines

## 6. Check before committing

- Code spans, numbers and headings unchanged: compare `` grep -o '`[^`]*`\|[0-9][0-9.,]*\|^#.*' `` sorted output of `git show HEAD:<file>` and the working file. A file where you added facts on purpose (e.g. a guide catching up to a release) is checked for headings and frontmatter only
- `npx vitest run tests/site` (plus `tests/src/lib/userCssGuide.test.ts tests/worker/guideLimits.test.ts` when guides changed)
- Report changed-sentence counts and two before/after examples per file
