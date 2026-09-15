import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { frontmatterExtension } from './frontmatter'
import { computeImagePlacement, isBlockedPosition } from './imageInsert'

function apply(doc: string, from: number, insert: string): string {
  return doc.slice(0, from) + insert + doc.slice(from)
}

describe('computeImagePlacement', () => {
  it('글자 줄 가운데(둘째 줄) — 위아래 모두 빈 줄 넣고 다음 줄 시작에 커서 (F-156.md A2)', () => {
    const doc = 'line1\nline2\nline3'
    const pos = doc.indexOf('line2') + 2 // 둘째 줄 가운데
    const block = ['<div align="center">', '  <img src="attachments/x.png">', '</div>'].join('\n')
    const { from, insert, cursor } = computeImagePlacement(doc, pos, [block])
    const result = apply(doc, from, insert)
    expect(result).toBe('line1\nline2\n\n' + block + '\n\nline3')
    expect(cursor).toBe(result.indexOf('line3'))
  })

  it('빈 줄에 놓으면 그 줄에 바로 들어간다(위아래 글자 줄이면 빈 줄 패딩)', () => {
    const doc = 'above\n\nbelow'
    const pos = doc.indexOf('\n\n') + 1 // 빈 줄
    const block = 'BLOCK'
    const { from, insert, cursor } = computeImagePlacement(doc, pos, [block])
    const result = apply(doc, from, insert)
    expect(result).toBe('above\n\nBLOCK\n\nbelow')
    expect(cursor).toBe(result.indexOf('below'))
  })

  it('문서 맨 처음(빈 문서)에 넣으면 위아래 패딩이 없다', () => {
    const doc = ''
    const { from, insert, cursor } = computeImagePlacement(doc, 0, ['BLOCK'])
    const result = apply(doc, from, insert)
    expect(result).toBe('BLOCK\n')
    expect(cursor).toBe(result.length)
  })

  it('문서 끝(마지막 글자 줄)에 넣으면 아래 패딩 없이 새 줄에 커서', () => {
    const doc = '본문 끝'
    const { from, insert, cursor } = computeImagePlacement(doc, doc.length, ['BLOCK'])
    const result = apply(doc, from, insert)
    expect(result).toBe('본문 끝\n\nBLOCK\n')
    expect(cursor).toBe(result.length)
  })

  it('위 줄이 없으면(문서 맨 앞 빈 줄) 앞에 빈 줄을 추가하지 않는다', () => {
    const doc = '\nline2'
    const pos = 0 // 첫 줄(빈 줄), 위로는 아무 줄도 없다
    const { from, insert } = computeImagePlacement(doc, pos, ['BLOCK'])
    const result = apply(doc, from, insert)
    // 아래 줄(line2)은 비어 있지 않으므로 뒤에는 빈 줄이 붙는다
    expect(result).toBe('BLOCK\n\nline2')
  })

  it('아래 줄이 비어 있으면 뒤에 빈 줄을 추가하지 않는다', () => {
    const doc = 'line1\n'
    const pos = 2 // 첫(유일한 글자) 줄 가운데, 다음 줄은 빈 줄(문서 끝)
    const { from, insert } = computeImagePlacement(doc, pos, ['BLOCK'])
    const result = apply(doc, from, insert)
    // 다음 줄이 있고 비어 있으므로 trailing blank 없음, leading blank 있음(윗 줄이 글자 줄)
    expect(result).toBe('line1\n\nBLOCK\n')
  })

  it('여러 장은 빈 줄 하나를 사이에 두고 이어 넣는다 (F-156.md A3)', () => {
    const doc = '시작\n'
    const { insert } = computeImagePlacement(doc, doc.length, ['A블록', 'B블록'])
    expect(insert).toContain('A블록\n\nB블록')
  })
})

function makeState(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

describe('isBlockedPosition', () => {
  it('펜스 코드블록 원문 안은 막는다', () => {
    const doc = '```\n여기\n```'
    const pos = doc.indexOf('여기')
    expect(isBlockedPosition(makeState(doc), pos)).toBe(true)
  })

  it('표 칸 범위 안은 막는다', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const pos = doc.indexOf('1')
    expect(isBlockedPosition(makeState(doc), pos)).toBe(true)
  })

  it('프론트매터 범위 안은 막는다', () => {
    const doc = '---\ntitle: 문서\n---\n본문'
    const pos = doc.indexOf('title')
    expect(isBlockedPosition(makeState(doc), pos)).toBe(true)
  })

  it('평범한 문단·목록·인용 줄은 막지 않는다', () => {
    const doc = '문단\n\n- 목록\n\n> 인용'
    expect(isBlockedPosition(makeState(doc), doc.indexOf('문단'))).toBe(false)
    expect(isBlockedPosition(makeState(doc), doc.indexOf('목록'))).toBe(false)
    expect(isBlockedPosition(makeState(doc), doc.indexOf('인용'))).toBe(false)
  })
})
