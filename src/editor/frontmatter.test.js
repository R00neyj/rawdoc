// specs/features/F-133.md 4장 A2
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { frontmatterExtension } from './frontmatter.js'

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
