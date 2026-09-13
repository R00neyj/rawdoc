// buildInline 단위 테스트 (specs/features/F-104.md 3장 A1, specs/features/F-129.md 4장 A1)
// EditorState + ensureSyntaxTree 로 계산 함수를 직접 부른다. DOM 은 쓰지 않는다
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { Decoration } from '@codemirror/view'
import { buildInline, mapDecorationsOnHold } from './inline.js'

function makeState(doc, anchor = 0, head = anchor) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

// buildInline 은 F-129 부터 숨김(HIDE) 범위와 표시용 mark(md-link) 범위를 함께 돌려준다.
// 기존 F-104 테스트는 "숨김 개수·길이" 만 재므로 mark 는 제외하고 센다
function hideRanges(state) {
  return buildInline(state, [{ from: 0, to: state.doc.length }]).filter((r) => r.value.spec?.class !== 'md-link')
}

function hiddenLength(state) {
  return hideRanges(state).reduce((sum, r) => sum + (r.to - r.from), 0)
}

function hiddenCount(state) {
  return hideRanges(state).length
}

describe('buildInline', () => {
  it('커서가 다른 줄에 있으면 **굵게** 기호 4개(글자 수)를 숨긴다', () => {
    const state = makeState('**bold**\nx', 9) // 커서: 두 번째 줄
    expect(hiddenCount(state)).toBe(2)
    expect(hiddenLength(state)).toBe(4)
  })

  it('커서가 같은 줄에 있으면 숨기지 않는다', () => {
    const state = makeState('**bold**\nx', 0) // 커서: 첫 번째 줄
    expect(hiddenCount(state)).toBe(0)
  })

  it('맨 URL(autolink) 은 부모가 Link 가 아니므로 숨기지 않는다', () => {
    const state = makeState('https://a.com\nx', 14) // 커서: 두 번째 줄
    expect(hiddenCount(state)).toBe(0)
  })

  it('<https://a.com> 도 부모가 Autolink 라 숨기지 않는다', () => {
    const state = makeState('<https://a.com>\nx', 16)
    expect(hiddenCount(state)).toBe(0)
  })

  it('[t](https://a.com) 은 [ ]( url ) 을 숨기고 t 만 남긴다', () => {
    const doc = '[t](https://a.com)\nx'
    const state = makeState(doc, 19) // 커서: 두 번째 줄('x')
    const ranges = hideRanges(state) // md-link mark(F-129)는 표시만 바꿀 뿐 글자를 지우지 않는다
    const visible = [...doc.slice(0, 18)]
    for (const r of ranges) {
      for (let i = r.from; i < r.to; i++) visible[i] = ''
    }
    expect(visible.join('')).toBe('t')
  })

  it('![a](b.png) 는 Image 안의 LinkMark·URL 을 숨기지 않는다', () => {
    const state = makeState('![a](b.png)\nx', 12)
    expect(hiddenCount(state)).toBe(0)
  })

  it('펜스 코드블록 울타리는 숨기지 않는다', () => {
    const state = makeState('```js\ncode\n```\nx', 15)
    expect(hiddenCount(state)).toBe(0)
  })

  it('여러 줄 선택은 걸친 줄 전부에서 숨기지 않는다', () => {
    const doc = '**a**\n**b**\nc'
    // 1~2줄 전체를 선택 (0 ~ 11)
    const state = makeState(doc, 0, 11)
    expect(hiddenCount(state)).toBe(0)
  })

  it('인라인 코드 CodeMark 는 InlineCode 부모일 때 숨긴다', () => {
    const state = makeState('`code`\nx', 7)
    expect(hiddenCount(state)).toBe(2)
    expect(hiddenLength(state)).toBe(2)
  })

  it('취소선 StrikethroughMark 는 항상 숨긴다', () => {
    const state = makeState('~~s~~\nx', 6)
    expect(hiddenCount(state)).toBe(2)
    expect(hiddenLength(state)).toBe(4)
  })

  it('표 안으로는 들어가지 않는다', () => {
    const state = makeState('a | *b*\n-|-\n1|2\nx', 17)
    expect(hiddenCount(state)).toBe(0)
  })
})

/** md-link mark(class='md-link')만 뽑아 {from, to, title} 로 돌려준다 */
function linkMarksOf(state) {
  return buildInline(state, [{ from: 0, to: state.doc.length }])
    .filter((r) => r.value.spec?.class === 'md-link')
    .map((r) => ({ from: r.from, to: r.to, title: r.value.spec.attributes.title }))
}

describe('buildInline — F-129 링크 활성 단위(범위)', () => {
  it('커서가 링크와 같은 줄이지만 링크 밖이면 숨긴다 (F-104 는 줄 단위라 숨기지 않았을 자리)', () => {
    const doc = '[t](https://a.com) x'
    const state = makeState(doc, doc.length) // 커서: 링크 뒤 같은 줄
    // LinkMark '[' ']' '(' ')' 4개 + URL 1개 = 5개 숨김
    expect(hiddenCount(state)).toBe(5)
    expect(hiddenLength(state)).toBe(1 + 1 + 1 + 'https://a.com'.length + 1)
  })

  it('커서가 링크 안(URL 글자 안)이면 드러난다', () => {
    const doc = '[t](https://a.com)'
    const state = makeState(doc, 5) // https 부분
    expect(hiddenCount(state)).toBe(0)
  })

  it('커서가 [ 바로 앞이면 드러난다 (끝 위치 포함)', () => {
    const doc = '[t](https://a.com)'
    const state = makeState(doc, 0)
    expect(hiddenCount(state)).toBe(0)
  })

  it('커서가 ) 바로 뒤이면 드러난다 (끝 위치 포함)', () => {
    const doc = '[t](https://a.com)'
    const state = makeState(doc, doc.length)
    expect(hiddenCount(state)).toBe(0)
  })

  it('같은 줄의 **굵게** 는 링크와 별개로 줄 단위 그대로다 — 커서가 줄에 있으면 굵게도 링크도 드러난다', () => {
    const doc = '**b** [t](https://a.com)'
    const state = makeState(doc, doc.length) // 커서: 링크 끝(링크에 닿음, 굵게와 같은 줄)
    expect(hiddenCount(state)).toBe(0)
  })

  it('같은 줄이라도 커서가 링크 밖이면 링크만 숨고 굵게는 줄 단위라 그대로 드러난다', () => {
    const doc = '**b** [t](https://a.com)'
    const state = makeState(doc, 0) // 커서: 줄 시작(굵게 쪽, 링크 밖)
    // 링크 마크 5개만 숨는다. 굵게 마크는 커서가 같은 줄이라 숨기지 않는다
    expect(hiddenCount(state)).toBe(5)
  })

  it('URL 없는 [a][ref] 는 열 대상이 아니고 md-link mark 도 붙지 않는다', () => {
    const doc = '[a][ref]\nx'
    const state = makeState(doc, 9) // 커서: 다른 줄
    expect(linkMarksOf(state)).toEqual([])
  })
})

describe('buildInline — F-129 md-link 표시용 mark', () => {
  it('접힌 링크 글자에 md-link mark 를 붙인다', () => {
    const doc = '[t](https://a.com)\nx'
    const state = makeState(doc, 19) // 커서: 다음 줄('x') — 링크는 접힘
    expect(linkMarksOf(state)).toEqual([{ from: 1, to: 2, title: 'https://a.com' }])
  })

  it('드러난 링크에는 md-link mark 를 붙이지 않는다', () => {
    const doc = '[t](https://a.com)'
    const state = makeState(doc, 5) // 커서: 링크 안
    expect(linkMarksOf(state)).toEqual([])
  })

  it('맨 URL 에는 숨김 여부와 무관하게 항상 md-link mark 를 붙인다', () => {
    const doc = 'https://a.com\nx'
    const state = makeState(doc, 14) // 커서: 다른 줄(맨 URL 은 애초에 숨김이 없다)
    expect(linkMarksOf(state)).toEqual([{ from: 0, to: 13, title: 'https://a.com' }])
  })

  it('<https://a.com> 안 글자에는 <> 를 뺀 md-link mark 를 붙인다', () => {
    const doc = '<https://a.com>\nx'
    const state = makeState(doc, 16)
    expect(linkMarksOf(state)).toEqual([{ from: 1, to: 14, title: 'https://a.com' }])
  })

  it('![a](b.png) 는 Image 안이라 md-link mark 를 붙이지 않는다', () => {
    const doc = '![a](b.png)\nx'
    const state = makeState(doc, 12)
    expect(linkMarksOf(state)).toEqual([])
  })
})

describe('buildInline — F-134 3.7: 줄바꿈을 덮는 숨김 방지', () => {
  it('여러 줄 LinkTitle([a](u "첫줄\\n둘째줄"))은 숨김(replace) 범위를 만들지 않는다', () => {
    const doc = '[a](u "첫줄\n둘째줄")\nx'
    const state = makeState(doc, doc.length) // 커서: 다음 줄 — 링크는 접힘 대상
    const ranges = hideRanges(state)
    for (const r of ranges) {
      expect(state.doc.sliceString(r.from, r.to)).not.toContain('\n')
    }
  })
})

describe('buildInline — F-128 4.1: 콜아웃 머리는 링크 기호 숨김에서 뺀다', () => {
  it('> [!tip] 제목 의 [ ] 를 숨기지 않는다', () => {
    const doc = '> [!tip] 제목\nx'
    const state = makeState(doc, doc.length) // 커서: 다음 줄 — 보통 Link 라면 숨겨질 상태
    expect(hiddenCount(state)).toBe(0)
  })

  it('공백 없는 >[!tip] 도 숨기지 않는다', () => {
    const doc = '>[!tip] 제목\nx'
    const state = makeState(doc, doc.length)
    expect(hiddenCount(state)).toBe(0)
  })

  it('md-link mark 도 붙지 않는다 (URL 없음)', () => {
    const doc = '> [!tip] 제목\nx'
    const state = makeState(doc, doc.length)
    expect(linkMarksOf(state)).toEqual([])
  })

  it('중첩 인용(> > [!tip])은 바깥 판정이라 숨김 대상에서 빠지지 않는다', () => {
    const doc = '> > [!tip] 중첩\nx'
    const state = makeState(doc, doc.length)
    // 바깥은 콜아웃이 아니고(머리 텍스트가 [ 로 시작하지 않음), 이 파일은 lines.js 와
    // 같은 "가장 바깥만" 규칙을 쓰므로 안쪽 Link 의 [ ] 는 일반 규칙대로 숨는다
    expect(hiddenCount(state)).toBeGreaterThan(0)
  })

  it('보통 인용의 일반 [텍스트](url) 링크는 여전히 숨긴다', () => {
    const doc = '> [글](https://a.com)\nx'
    const state = makeState(doc, doc.length)
    expect(hiddenCount(state)).toBeGreaterThan(0)
  })
})

describe('mapDecorationsOnHold — F-134 3.1: 조합 중 보류 + 문서 변경', () => {
  it('맵 결과는 새 문서 범위 안이고 줄바꿈을 덮지 않는다', () => {
    const state = makeState('**bold**\nx', 9) // 커서: 두 번째 줄 — **bold** 기호 숨김
    const before = Decoration.set(buildInline(state, [{ from: 0, to: state.doc.length }]), true)

    // 조합 중 두 번째 줄('x') 앞에 줄바꿈이 든 글자가 들어오는 상황을 흉내낸다
    const tr = state.update({ changes: { from: 9, insert: '\n연' } })
    const mapped = mapDecorationsOnHold(before, tr.changes)

    const newDoc = tr.state.doc
    let count = 0
    mapped.between(0, newDoc.length, (from, to) => {
      count++
      expect(to).toBeLessThanOrEqual(newDoc.length)
      expect(newDoc.sliceString(from, to)).not.toContain('\n')
    })
    expect(count).toBeGreaterThan(0) // 실제로 옮겨진 decoration 이 있어야 검증 의미가 있다
  })
})
