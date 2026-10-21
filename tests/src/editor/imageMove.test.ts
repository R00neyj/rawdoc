import { describe, it, expect } from 'vitest'
import { ChangeSet, EditorState, Text } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { frontmatterExtension } from '../../../src/editor/frontmatter'
import { imageMoveChanges, moveBlockedRanges } from '../../../src/editor/imageMove'

const IMG = '![그림](attachments/0123456789abcdef.png)'

// 실제 편집기와 같은 길(ChangeSet)로 적용한다 — 원래 문서 좌표 두 변경이 겹치지 않는지도 함께 본다
function move(doc: string, target: number, blocked: { from: number; to: number }[] = []): string | null {
  const from = doc.indexOf(IMG)
  const changes = imageMoveChanges(doc, { from, to: from + IMG.length }, target, blocked)
  if (!changes) return null
  return ChangeSet.of(changes, doc.length).apply(Text.of(doc.split('\n'))).toString()
}

function makeState(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

describe('imageMoveChanges', () => {
  it('두 문단 아래로 — 빈 줄 구분을 지키며 옮긴다', () => {
    const doc = `${IMG}\n\n가\n\n나\n`
    expect(move(doc, doc.length)).toBe(`가\n\n나\n\n${IMG}\n`)
  })

  it('문단 사이로 위로 옮긴다', () => {
    const doc = `가\n\n나\n\n${IMG}\n\n다`
    expect(move(doc, doc.indexOf('나'))).toBe(`가\n\n${IMG}\n\n나\n\n다`)
  })

  it('문서 처음으로 — 앞에 빈 줄을 만들지 않는다', () => {
    const doc = `가\n\n${IMG}\n\n나`
    expect(move(doc, 0)).toBe(`${IMG}\n\n가\n\n나`)
  })

  it('줄바꿈 없이 끝나는 문서 끝으로', () => {
    const doc = `${IMG}\n\n가\n\n나`
    expect(move(doc, doc.length)).toBe(`가\n\n나\n\n${IMG}`)
  })

  it('빈 줄 없이 붙은 줄 사이에 넣으면 앞뒤에 빈 줄을 만든다', () => {
    const doc = `가\n나\n\n${IMG}`
    expect(move(doc, doc.indexOf('나'))).toBe(`가\n\n${IMG}\n\n나`)
  })

  it('빠진 자리의 빈 줄이 겹치지 않게 하나만 남긴다', () => {
    const doc = `가\n\n${IMG}\n\n나\n\n다`
    expect(move(doc, doc.indexOf('다'))).toBe(`가\n\n나\n\n${IMG}\n\n다`)
  })

  it('문단 첫 줄 그림은 그 줄만 옮기고 아래 줄은 남는다', () => {
    const doc = `${IMG}\n설명\n\n가`
    expect(move(doc, doc.length)).toBe(`설명\n\n가\n\n${IMG}`)
  })

  it('제자리(바로 위·아래 틈, 빈 줄 건너 틈)는 변화 없음', () => {
    const doc = `가\n\n${IMG}\n\n나`
    for (const target of [doc.indexOf(IMG), doc.indexOf(IMG) + IMG.length + 1, doc.indexOf(IMG) - 1, doc.indexOf('나')]) {
      expect(move(doc, target)).toBeNull()
    }
  })

  it('줄 시작이 아닌 자리는 받지 않는다', () => {
    const doc = `가나\n\n${IMG}`
    expect(move(doc, 1)).toBeNull()
  })

  it('막힌 범위 안 틈은 거부하고 범위 앞뒤 경계는 받는다', () => {
    const doc = `${IMG}\n\n\`\`\`\n코드\n\`\`\`\n\n끝`
    const code = { from: doc.indexOf('```'), to: doc.lastIndexOf('```') + 3 }
    expect(move(doc, doc.indexOf('코드'), [code])).toBeNull()
    expect(move(doc, doc.indexOf('끝'), [code])).toBe(`\`\`\`\n코드\n\`\`\`\n\n${IMG}\n\n끝`)
  })
})

describe('moveBlockedRanges', () => {
  it('표·코드블록 안 틈을 막는다', () => {
    const doc = `${IMG}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n\`\`\`\n코드\n\`\`\`\n`
    const blocked = moveBlockedRanges(makeState(doc))
    expect(move(doc, doc.indexOf('| - |'), blocked)).toBeNull()
    expect(move(doc, doc.indexOf('| 1 |'), blocked)).toBeNull()
    expect(move(doc, doc.indexOf('코드'), blocked)).toBeNull()
    expect(move(doc, doc.length, blocked)).not.toBeNull()
  })

  it('프론트매터 안과 그 앞(문서 처음)을 막는다', () => {
    const doc = `---\ntitle: 가\n---\n\n본문\n\n${IMG}`
    const blocked = moveBlockedRanges(makeState(doc))
    expect(move(doc, 0, blocked)).toBeNull()
    expect(move(doc, doc.indexOf('title'), blocked)).toBeNull()
    expect(move(doc, doc.indexOf('본문'), blocked)).toBe(`---\ntitle: 가\n---\n\n${IMG}\n\n본문`)
  })
})
