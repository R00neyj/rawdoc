// F-2132 A6
import { describe, expect, it } from 'vitest'
import { buildPutPreview, lineEndingNotice, wouldConflict, type PreviewServerDoc } from '../../../cli/src/putPreview'

const server = (content: string, lineEnding: 'crlf' | 'lf' = 'lf', version = 5): PreviewServerDoc => ({
  id: 'd1',
  title: 't',
  content,
  version,
  lineEnding,
})

describe('F-2132 A6 putPreview', () => {
  it('서버 CRLF + 파일 LF → 내용 같음, 줄 0/0, 안내 있음', () => {
    const p = buildPutPreview({ server: server('a\r\nb', 'crlf'), file: { text: 'a\nb', lineEnding: 'lf' }, title: undefined })
    expect(p).toMatchObject({ contentChanged: false, linesAdded: 0, linesRemoved: 0, fileLineEnding: 'lf', firstChangedLine: null })
    expect(lineEndingNotice('a.md', p.fileLineEnding, p.lineEnding, true)).toBe(
      '"a.md" 줄바꿈(LF)이 서버 문서(CRLF)와 달라 서버 문서에 맞춰 저장됩니다.\n',
    )
    expect(lineEndingNotice('a.md', p.fileLineEnding, p.lineEnding, false)).toContain('저장했습니다.')
  })
  it('한 줄 파일 → fileLineEnding null, 안내 없음', () => {
    const p = buildPutPreview({ server: server('a', 'crlf'), file: { text: 'b', lineEnding: 'crlf' }, title: undefined })
    expect(p.fileLineEnding).toBeNull()
    expect(lineEndingNotice('a.md', p.fileLineEnding, p.lineEnding, true)).toBeNull()
  })
  it('3번째 줄만 바꾸면 1/1, firstChangedLine 3', () => {
    const p = buildPutPreview({ server: server('a\nb\nc\nd'), file: { text: 'a\nb\nX\nd', lineEnding: 'lf' }, title: undefined })
    expect(p).toMatchObject({ linesAdded: 1, linesRemoved: 1, firstChangedLine: 3, contentChanged: true })
  })
  it('줄 순서만 바꾸면 0/0 이지만 contentChanged', () => {
    const p = buildPutPreview({ server: server('a\nb'), file: { text: 'b\na', lineEnding: 'lf' }, title: undefined })
    expect(p).toMatchObject({ linesAdded: 0, linesRemoved: 0, contentChanged: true })
  })
  it('원문 없이 제목만', () => {
    const p = buildPutPreview({ server: server('a'), file: null, title: 'new' })
    expect(p).toMatchObject({ titleChanged: true, contentChanged: false, fileLineEnding: null, firstChangedLine: null })
  })
  it('충돌: 판 다름+변경 있음만', () => {
    const changed = buildPutPreview({ server: server('a'), file: { text: 'b', lineEnding: 'lf' }, title: undefined })
    const same = buildPutPreview({ server: server('a'), file: { text: 'a', lineEnding: 'lf' }, title: undefined })
    expect(wouldConflict(3, changed)).toBe(true)
    expect(wouldConflict(3, same)).toBe(false)
    expect(wouldConflict(5, changed)).toBe(false)
    expect(wouldConflict(null, changed)).toBe(false)
  })
})
