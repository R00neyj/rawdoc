import { describe, expect, it } from 'vitest'
import { dropBlocks, shouldLeaveForMatchedDoc } from '../../../src/app/useImportFlow'

describe('shouldLeaveForMatchedDoc (F-2076 D1)', () => {
  const base = { matchedId: 'A', currentDocId: 'A', sharedOpen: false, sharesOpen: false, helpOpen: false, mapOpen: false }

  it('같은 문서 화면이면 떠나지 않는다', () => {
    expect(shouldLeaveForMatchedDoc(base)).toBe(false)
  })

  it('다른 문서면 떠난다', () => {
    expect(shouldLeaveForMatchedDoc({ ...base, currentDocId: 'B' })).toBe(true)
  })

  it.each(['sharedOpen', 'sharesOpen', 'helpOpen', 'mapOpen'] as const)('같은 문서라도 %s 이면 떠난다', (key) => {
    expect(shouldLeaveForMatchedDoc({ ...base, [key]: true })).toBe(true)
  })
})

describe('dropBlocks (F-2059 D11)', () => {
  it('가져오기 대화상자가 떠 있으면 md·이미지 끌어놓기를 모두 막는다', () => {
    expect(dropBlocks(false, false, true)).toEqual({ md: true, image: true })
  })

  it('가져오기 대화상자가 없으면 앱 차단 값을 그대로 따른다', () => {
    expect(dropBlocks(false, false, false)).toEqual({ md: false, image: false })
    expect(dropBlocks(true, false, false)).toEqual({ md: true, image: false })
    expect(dropBlocks(true, true, false)).toEqual({ md: true, image: true })
  })
})
