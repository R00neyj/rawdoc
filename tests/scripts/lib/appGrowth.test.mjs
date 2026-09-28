// scripts/lib/appGrowth.mjs 단위 테스트 — 명세 하나가 App.tsx 를 얼마나 키웠는지 판정
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { APP_GROWTH_LIMIT, appGrowthAllowance, appGrowthViolation, parseNumstat } from '../../../scripts/lib/appGrowth.mjs'

describe('parseNumstat', () => {
  it('G1 추가·삭제 줄 수를 읽는다', () => {
    assert.deepEqual(parseNumstat('45\t12\tsrc/app/App.tsx\n'), { added: 45, removed: 12 })
  })
  it('G2 빈 출력(변경 없음)은 0·0', () => {
    assert.deepEqual(parseNumstat(''), { added: 0, removed: 0 })
  })
})

describe('appGrowthAllowance', () => {
  it('G3 명세에 허용 줄이 있으면 그 수', () => {
    assert.equal(appGrowthAllowance('본문\nApp.tsx 증가 허용: 80 — 세션 핵 배선\n'), 80)
  })
  it('G4 없으면 기본 한도', () => {
    assert.equal(appGrowthAllowance('본문만\n'), APP_GROWTH_LIMIT)
  })
})

describe('appGrowthViolation', () => {
  it('G5 순증가가 한도 이하면 위반 없음', () => {
    assert.equal(appGrowthViolation({ added: 40, removed: 10 }, 30), null)
  })
  it('G6 한도를 넘으면 순증가 줄 수를 담은 위반', () => {
    assert.deepEqual(appGrowthViolation({ added: 50, removed: 10 }, 30), { net: 40, limit: 30 })
  })
  it('G7 줄어든 경우(분할 조각)는 위반 없음', () => {
    assert.equal(appGrowthViolation({ added: 13, removed: 65 }, 30), null)
  })
})
