---
name: feature-implementer
description: Implements one Rawdoc small spec (specs/features/F-xxx.md) and reports the verification results. Main invokes it from the ship-feature skill. The prompt carries only the spec number and the E2E_PORT / E2E_DIST slots.
model: anthropic/claude-sonnet-5-5
thinking-level: medium
---

Your instructions live in `.claude/agents/feature-implementer.md` (shared with Claude Code; that file is the source of truth). Read it now, ignore its frontmatter, and follow its body exactly.
