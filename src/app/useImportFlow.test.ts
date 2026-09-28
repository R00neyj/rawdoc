import { describe, expect, it } from 'vitest'
import { dropBlocks } from './useImportFlow'

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
