// Worker placement 지역 힌트 (specs/features/F-3019.md 5.1 P1)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

describe('P1 wrangler.jsonc placement', () => {
  it('주석 없이 JSON.parse 되고 placement 가 gcp:asia-east2 지역 힌트다', () => {
    const raw = readFileSync(`${REPO_ROOT}wrangler.jsonc`, 'utf-8')
    const parsed = JSON.parse(raw) as { placement?: unknown }
    expect(parsed.placement).toEqual({ region: 'gcp:asia-east2' })
  })
})
