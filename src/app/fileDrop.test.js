import { describe, it, expect } from 'vitest'
import { isExternalFileDrag, pickMarkdownFiles } from './fileDrop.js'

function file(name) {
  return { name }
}

describe('isExternalFileDrag', () => {
  it('types 에 Files 가 있으면 true', () => {
    expect(isExternalFileDrag({ types: ['Files'] })).toBe(true)
  })

  it('types 에 Files 가 없으면 false (사이드바 문서·폴더 끌기는 text/plain 만 쓴다)', () => {
    expect(isExternalFileDrag({ types: ['text/plain'] })).toBe(false)
  })

  it('dataTransfer 가 없으면 false', () => {
    expect(isExternalFileDrag(null)).toBe(false)
    expect(isExternalFileDrag(undefined)).toBe(false)
  })

  it('types 가 없으면 false', () => {
    expect(isExternalFileDrag({})).toBe(false)
  })
})

describe('pickMarkdownFiles', () => {
  it('.md 확장자만 골라낸다', () => {
    const result = pickMarkdownFiles([file('a.md')])
    expect(result.mdFiles.map((f) => f.name)).toEqual(['a.md'])
    expect(result.allNonMd).toBe(false)
  })

  it('.MD 대문자도 골라낸다', () => {
    const result = pickMarkdownFiles([file('A.MD')])
    expect(result.mdFiles.map((f) => f.name)).toEqual(['A.MD'])
    expect(result.allNonMd).toBe(false)
  })

  it('섞인 목록은 .md 만 남기고 allNonMd 는 false', () => {
    const result = pickMarkdownFiles([file('a.md'), file('b.md'), file('c.txt')])
    expect(result.mdFiles.map((f) => f.name)).toEqual(['a.md', 'b.md'])
    expect(result.allNonMd).toBe(false)
  })

  it('전부 비 .md 면 allNonMd 는 true, mdFiles 는 빈 배열', () => {
    const result = pickMarkdownFiles([file('c.txt'), file('d.png')])
    expect(result.mdFiles).toEqual([])
    expect(result.allNonMd).toBe(true)
  })

  it('빈 목록이면 allNonMd 는 false', () => {
    const result = pickMarkdownFiles([])
    expect(result.mdFiles).toEqual([])
    expect(result.allNonMd).toBe(false)
  })

  it('null·undefined 는 빈 목록으로 처리', () => {
    expect(pickMarkdownFiles(null).mdFiles).toEqual([])
    expect(pickMarkdownFiles(undefined).mdFiles).toEqual([])
  })
})
