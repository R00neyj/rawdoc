// 위키링크 미리보기 순수 모듈 단위 테스트 (specs/features/F-2044.md 10.1 U1~U4)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  slicePreviewText,
  placeWikiPreview,
  previewEligibility,
  createHoverIntent,
  WIKI_PREVIEW_OPEN_DELAY_MS,
  WIKI_PREVIEW_CLOSE_GRACE_MS,
} from './wikiPreview'

describe('slicePreviewText (U1)', () => {
  it('20,000자 이하는 전체를 그대로 돌려주고 truncated 는 false', () => {
    const text19999 = 'a'.repeat(19_999)
    expect(slicePreviewText(text19999)).toEqual({ text: text19999, truncated: false })
    const text20000 = 'a'.repeat(20_000)
    expect(slicePreviewText(text20000)).toEqual({ text: text20000, truncated: false })
  })

  it('20,001자는 잘리고 truncated 는 true', () => {
    const text = 'a'.repeat(20_001)
    const result = slicePreviewText(text)
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBeLessThan(text.length)
  })

  it('CRLF 본문은 LF 로 맞춘 뒤 길이를 잰다', () => {
    const body = 'a\r\nb\r\nc'
    expect(slicePreviewText(body, 100)).toEqual({ text: 'a\nb\nc', truncated: false })
  })

  it('빈 줄 자리가 limit/2 뒤(정확히 limit 이하)면 그 앞에서 자른다', () => {
    // limit=20, 빈 줄이 index 12 (>= half=10) 에서 시작
    const before = 'a'.repeat(12)
    const text = `${before}\n\n${'b'.repeat(20)}`
    const result = slicePreviewText(text, 20)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe(before)
  })

  it('빈 줄 자리가 limit/2 보다 앞이면 빈 줄 대신 마지막 줄바꿈 앞에서 자른다', () => {
    // limit=20, half=10. 빈 줄이 index 3 (< 10) 이라 못 쓰고, 대신 index 15 의 단일 \n 을 쓴다
    const text = `abc\n\n${'d'.repeat(11)}\n${'e'.repeat(10)}`
    const result = slicePreviewText(text, 20)
    expect(result.truncated).toBe(true)
    const lastNl = text.lastIndexOf('\n', 20)
    expect(lastNl).toBeGreaterThanOrEqual(10)
    expect(result.text).toBe(text.slice(0, lastNl))
  })

  it('빈 줄 없고 단일 줄바꿈만 있으면 마지막 줄바꿈 앞에서 자른다', () => {
    const text = `${'a'.repeat(12)}\n${'b'.repeat(20)}`
    const result = slicePreviewText(text, 20)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe('a'.repeat(12))
  })

  it('줄바꿈이 전혀 없으면 limit 에서 그대로 자른다', () => {
    const text = 'a'.repeat(30)
    const result = slicePreviewText(text, 20)
    expect(result).toEqual({ text: 'a'.repeat(20), truncated: true })
  })

  it('자른 자리가 서로게이트 쌍 가운데면 한 칸 앞으로 물린다', () => {
    const pair = '\u{1F600}' // 서로게이트 쌍 하나(2 코드 유닛)
    const text = `${'a'.repeat(19)}${pair}${'b'.repeat(10)}`
    // limit=20 이면 잘림 지점이 정확히 쌍 가운데(index 20)에 온다
    const result = slicePreviewText(text, 20)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe('a'.repeat(19))
  })
})

describe('placeWikiPreview (U2)', () => {
  const viewport = { width: 1280, height: 800 }
  const size = { width: 400, height: 400 }

  it('링크가 위쪽(아래 자리 넉넉)이면 아래로, top = bottom + 4', () => {
    const anchor = { left: 100, top: 50, right: 200, bottom: 70 }
    const result = placeWikiPreview(anchor, size, viewport)
    expect(result.side).toBe('below')
    expect(result).toMatchObject({ top: 74, width: 400, maxHeight: 400 })
  })

  it('링크가 아래쪽(위 자리 넉넉)이면 위로, bottom = 800 - (top - 4)', () => {
    const anchor = { left: 100, top: 750, right: 200, bottom: 770 }
    const result = placeWikiPreview(anchor, size, viewport)
    expect(result.side).toBe('above')
    expect(result).toMatchObject({ bottom: 800 - (750 - 4), width: 400, maxHeight: 400 })
  })

  it('창 높이 500 에 가운데(둘 다 모자람)면 더 넓은 쪽, maxHeight 는 그 자리 값', () => {
    const shortViewport = { width: 1280, height: 500 }
    const anchor = { left: 100, top: 250, right: 200, bottom: 260 }
    const below = 500 - 8 - (260 + 4) // 228
    const above = 250 - 4 - 8 // 238
    const result = placeWikiPreview(anchor, size, shortViewport)
    expect(result.side).toBe('above')
    expect(result.maxHeight).toBe(above)
    expect(below).toBeLessThan(size.height)
    expect(above).toBeLessThan(size.height)
  })

  it('오른쪽 끝에 있으면 left 가 뷰포트 안으로 당겨진다', () => {
    const anchor = { left: 1270, top: 50, right: 1279, bottom: 70 }
    const result = placeWikiPreview(anchor, size, viewport)
    expect(result.left).toBe(1280 - 8 - 400)
  })

  it('왼쪽 끝에 있으면 left = 8', () => {
    const anchor = { left: 0, top: 50, right: 10, bottom: 70 }
    const result = placeWikiPreview(anchor, size, viewport)
    expect(result.left).toBe(8)
  })

  it('창 폭 360 이면 width 가 344 로 줄어든다', () => {
    const narrowViewport = { width: 360, height: 800 }
    const anchor = { left: 100, top: 50, right: 200, bottom: 70 }
    const result = placeWikiPreview(anchor, size, narrowViewport)
    expect(result.width).toBe(344)
  })
})

describe('previewEligibility (U3)', () => {
  it('null 은 missing', () => {
    expect(previewEligibility(null, 'doc-1')).toBe('missing')
  })

  it('지금 문서면 self — 공유받은 문서라도 self 가 우선', () => {
    expect(previewEligibility({ id: 'doc-1', role: 'view' }, 'doc-1')).toBe('self')
  })

  it('role view·edit 는 shared', () => {
    expect(previewEligibility({ id: 'doc-2', role: 'view' }, 'doc-1')).toBe('shared')
    expect(previewEligibility({ id: 'doc-2', role: 'edit' }, 'doc-1')).toBe('shared')
  })

  it('role owner 는 ok', () => {
    expect(previewEligibility({ id: 'doc-2', role: 'owner' }, 'doc-1')).toBe('ok')
  })

  it('e2ee locked 는 locked, open 은 ok', () => {
    expect(previewEligibility({ id: 'doc-2', e2ee: 'locked' }, 'doc-1')).toBe('locked')
    expect(previewEligibility({ id: 'doc-2', e2ee: 'open' }, 'doc-1')).toBe('ok')
  })

  it('필드가 없으면 ok', () => {
    expect(previewEligibility({ id: 'doc-2' }, 'doc-1')).toBe('ok')
  })
})

describe('createHoverIntent (U4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('링크 위로 들어오면 499ms 안 열림, 500ms 에 open(key) 1회', () => {
    const open = vi.fn()
    const close = vi.fn()
    const intent = createHoverIntent({ open, close })
    intent.pointerOnLink('a')
    vi.advanceTimersByTime(499)
    expect(open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('a')
  })

  it('대기 중 다른 링크로 옮기면 새 key 로 500ms 뒤 열림', () => {
    const open = vi.fn()
    const close = vi.fn()
    const intent = createHoverIntent({ open, close })
    intent.pointerOnLink('a')
    vi.advanceTimersByTime(300)
    intent.pointerOnLink('b')
    vi.advanceTimersByTime(300)
    expect(open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('b')
  })

  it('열린 뒤 링크·미리보기를 둘 다 벗어나면 299ms 열린 채, 300ms 에 close', () => {
    const open = vi.fn()
    const close = vi.fn()
    const intent = createHoverIntent({ open, close })
    intent.pointerOnLink('a')
    vi.advanceTimersByTime(WIKI_PREVIEW_OPEN_DELAY_MS)
    expect(open).toHaveBeenCalledTimes(1)

    intent.pointerOnLink(null)
    vi.advanceTimersByTime(WIKI_PREVIEW_CLOSE_GRACE_MS - 1)
    expect(close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('유예 중 링크나 미리보기로 돌아오면 닫히지 않는다', () => {
    const open = vi.fn()
    const close = vi.fn()
    const intent = createHoverIntent({ open, close })
    intent.pointerOnLink('a')
    vi.advanceTimersByTime(WIKI_PREVIEW_OPEN_DELAY_MS)
    intent.pointerOnLink(null)
    vi.advanceTimersByTime(100)
    intent.pointerOnLink('a')
    vi.advanceTimersByTime(WIKI_PREVIEW_CLOSE_GRACE_MS + 100)
    expect(close).not.toHaveBeenCalled()

    // 미리보기로 돌아오는 경우도 같다
    intent.pointerOnLink(null)
    vi.advanceTimersByTime(100)
    intent.pointerInPreview(true)
    vi.advanceTimersByTime(WIKI_PREVIEW_CLOSE_GRACE_MS + 100)
    expect(close).not.toHaveBeenCalled()
  })

  it('dismiss 뒤 같은 key 에 머물러도 안 열리고, null 을 한 번 거친 뒤 같은 key 면 다시 500ms 뒤 열린다', () => {
    const open = vi.fn()
    const close = vi.fn()
    const intent = createHoverIntent({ open, close })
    intent.pointerOnLink('a')
    vi.advanceTimersByTime(WIKI_PREVIEW_OPEN_DELAY_MS)
    expect(open).toHaveBeenCalledTimes(1)

    intent.dismiss()
    expect(close).toHaveBeenCalledTimes(1)

    // 포인터가 그대로 'a' 위에 있어도(같은 key 로 다시 호출해도) 다시 열리지 않는다
    intent.pointerOnLink('a')
    vi.advanceTimersByTime(2000)
    expect(open).toHaveBeenCalledTimes(1)

    // null 을 한 번 거친 뒤 같은 key 로 돌아오면 다시 500ms 뒤 열린다
    intent.pointerOnLink(null)
    intent.pointerOnLink('a')
    vi.advanceTimersByTime(WIKI_PREVIEW_OPEN_DELAY_MS)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('dispose 뒤에는 아무 콜백도 오지 않는다', () => {
    const open = vi.fn()
    const close = vi.fn()
    const intent = createHoverIntent({ open, close })
    intent.pointerOnLink('a')
    intent.dispose()
    vi.advanceTimersByTime(10_000)
    expect(open).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
