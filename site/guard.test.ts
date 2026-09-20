// 사이트 글에 쓸 수 없는 문법 빌드 가드 (specs/features/F-272.md 9장, A7)
import { describe, expect, it } from 'vitest'
import { checkContentFile } from './guard'

describe('F-272 A7 checkContentFile', () => {
  it('G1: 프론트매터가 없으면 실패한다', () => {
    expect(() => checkContentFile('changelog.md', '본문만 있음')).toThrow(/changelog\.md/)
  })

  it('G1: title 이 없으면 실패한다', () => {
    const md = '---\nsummary: 요약\n---\n본문'
    expect(() => checkContentFile('changelog.md', md)).toThrow(/changelog\.md/)
  })

  it('G2: 매핑 없는 경로면 실패한다', () => {
    const md = '---\ntitle: 제목\n---\n본문'
    expect(() => checkContentFile('random.md', md)).toThrow(/random\.md/)
  })

  it('G3: ```mermaid 펜스가 있으면 실패한다', () => {
    const md = '---\ntitle: 제목\n---\n```mermaid\ngraph TD\n```'
    expect(() => checkContentFile('changelog.md', md)).toThrow(/changelog\.md/)
  })

  it('G4: 이미지 문법이 있으면 실패한다 (코드블록 안이어도 원문 검사)', () => {
    const md = '---\ntitle: 제목\n---\n```\n![a](b)\n```'
    expect(() => checkContentFile('changelog.md', md)).toThrow(/changelog\.md/)
  })

  it('G5: {{…}} 자리표시가 남아 있으면 실패한다', () => {
    const md = '---\ntitle: 제목\n---\n{{운영자}}'
    expect(() => checkContentFile('changelog.md', md)).toThrow(/changelog\.md/)
  })

  it('통과하는 글은 던지지 않는다', () => {
    const md = '---\ntitle: 제목\n---\n# 제목\n\n본문 `[[제목]]` 예시'
    expect(() => checkContentFile('changelog.md', md)).not.toThrow()
  })
})
