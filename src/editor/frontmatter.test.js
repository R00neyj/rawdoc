// specs/features/F-133.md 4장 A2, specs/features/F-155.md 3장 A1·A3
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { frontmatterExtension, frontmatterWidgetExtension, frontmatterWidgetInfo } from './frontmatter.js'

function makeState(doc) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

function nodeNames(state) {
  const names = []
  syntaxTree(state).iterate({ enter: (n) => void names.push(n.name) })
  return names
}

describe('frontmatterExtension — 블록 파서 (A2)', () => {
  it('---\\na: 1\\n---\\n# 제목 에서 Frontmatter 노드 1개, HorizontalRule·SetextHeading2 없음', () => {
    const state = makeState('---\na: 1\n---\n# 제목')
    const names = nodeNames(state)
    expect(names.filter((n) => n === 'Frontmatter')).toHaveLength(1)
    expect(names).not.toContain('HorizontalRule')
    expect(names).not.toContain('SetextHeading2')
    expect(names).toContain('ATXHeading1')
  })

  it('Frontmatter 는 여는·닫는 FrontmatterMark 를 자식으로 가진다', () => {
    const state = makeState('---\na: 1\n---\n본문')
    const tree = syntaxTree(state)
    let frontmatter = null
    tree.iterate({
      enter: (n) => {
        if (n.name === 'Frontmatter') frontmatter = n.node
      },
    })
    expect(frontmatter).not.toBeNull()
    const marks = []
    for (let c = frontmatter.firstChild; c; c = c.nextSibling) marks.push(c.name)
    expect(marks).toEqual(['FrontmatterMark', 'FrontmatterMark'])
  })

  it('닫는 줄이 없으면 Frontmatter 가 아니라 기존처럼 HorizontalRule 로 읽는다(회귀 없음)', () => {
    const state = makeState('---\na: 1\n본문')
    const names = nodeNames(state)
    expect(names).not.toContain('Frontmatter')
    expect(names).toContain('HorizontalRule')
  })

  it('문서 중간의 --- 는 프론트매터로 읽지 않는다(첫 줄이 아니므로)', () => {
    const state = makeState('# 제목\n\n---\n\n본문')
    const names = nodeNames(state)
    expect(names).not.toContain('Frontmatter')
    expect(names).toContain('HorizontalRule')
  })

  it('빈 프론트매터(---\\n---)만 있는 문서도 Frontmatter 노드가 된다', () => {
    const state = makeState('---\n---')
    expect(nodeNames(state)).toContain('Frontmatter')
  })
})

describe('frontmatterWidgetInfo — 위젯 조건 (F-155 2.1, A1)', () => {
  it('속성이 있고 닫는 줄 뒤에 줄이 있으면 정보를 돌려준다', () => {
    const state = makeState('---\na: 1\n---\n본문')
    const info = frontmatterWidgetInfo(state)
    expect(info).not.toBeNull()
    expect(info.props).toEqual([{ key: 'a', value: '1' }])
    expect(info.from).toBe(0)
    expect(info.correctedPos).toBe(state.doc.line(4).from)
  })

  it('해석할 수 없는 내용도 위젯 대상이다(props null, pre 로 그림)', () => {
    const info = frontmatterWidgetInfo(makeState('---\nparent:\n  child: 1\n---\n본문'))
    expect(info).not.toBeNull()
    expect(info.props).toBeNull()
    expect(info.content).toBe('parent:\n  child: 1\n')
  })

  it('빈 프론트매터는 null(예외 — 지금처럼 원문 상자)', () => {
    expect(frontmatterWidgetInfo(makeState('---\n---\n본문'))).toBeNull()
  })

  it('닫는 줄 뒤에 줄이 없으면 null(예외)', () => {
    expect(frontmatterWidgetInfo(makeState('---\na: 1\n---'))).toBeNull()
  })

  it('프론트매터가 없는 문서는 null', () => {
    expect(frontmatterWidgetInfo(makeState('# 제목'))).toBeNull()
  })
})

describe('frontmatterWidgetExtension — 커서 보정 (F-155 2.2, A3)', () => {
  function makeCorrectionState(doc) {
    return EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] }),
        frontmatterWidgetExtension(),
      ],
    })
  }

  it('빈 선택이 위젯 범위 시작(0)에 있으면 닫는 줄 다음 줄 시작으로 옮긴다', () => {
    const state = makeCorrectionState('---\na: 1\n---\n본문')
    const tr = state.update({ selection: { anchor: 0 } })
    expect(tr.state.selection.main.head).toBe(state.doc.line(4).from)
  })

  it('빈 선택이 위젯 범위 끝에 있어도 옮긴다', () => {
    const state = makeCorrectionState('---\na: 1\n---\n본문')
    const info = frontmatterWidgetInfo(state)
    const tr = state.update({ selection: { anchor: info.to } })
    expect(tr.state.selection.main.head).toBe(info.correctedPos)
  })

  it('범위 선택(Ctrl+A 등)은 막지 않는다', () => {
    const state = makeCorrectionState('---\na: 1\n---\n본문')
    const tr = state.update({ selection: { anchor: 0, head: state.doc.length } })
    expect(tr.state.selection.main.anchor).toBe(0)
    expect(tr.state.selection.main.head).toBe(state.doc.length)
  })

  it('위젯 범위 밖 선택은 손대지 않는다', () => {
    const state = makeCorrectionState('---\na: 1\n---\n본문')
    const pos = state.doc.line(4).from + 1
    const tr = state.update({ selection: { anchor: pos } })
    expect(tr.state.selection.main.head).toBe(pos)
  })

  it('위젯 조건이 아닌 문서(닫는 줄 뒤 줄 없음)는 손대지 않는다', () => {
    const state = makeCorrectionState('---\na: 1\n---')
    const tr = state.update({ selection: { anchor: 0 } })
    expect(tr.state.selection.main.head).toBe(0)
  })
})
