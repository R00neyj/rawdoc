// 당기기 원격 해독·문구·크기 판정 (specs/features/F-2129.md 3.2·7장)
import { describe, expect, it } from 'vitest'
import { lineEndingNote, mergedTooLarge, pullFailureMessage, PULL_OFFLINE_MESSAGE, readPulled, sameNotice, type PulledText } from '../../../src/app/githubPull'

const b64 = (bytes: Uint8Array | number[]) => btoa(String.fromCharCode(...bytes))
const utf8 = (s: string) => new TextEncoder().encode(s)
const base64Lines = (bytes: Uint8Array) => b64(bytes).replace(/(.{60})/g, '$1\n')
const remote = (p: Partial<PulledText>): PulledText => ({ text: 'a\nb', hadBom: false, lineEnding: 'lf', mixed: false, hasBreak: true, ...p })

describe('F-2129 A2 readPulled', () => {
  it('60자마다 \\n 인 base64 + BOM + CRLF → LF text, hadBom, crlf', () => {
    const body = '# 제목\r\n'.repeat(20) + '끝'
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(body)])
    const content = base64Lines(bytes)
    expect(content).toContain('\n')
    expect(readPulled(content)).toEqual({ text: '# 제목\n'.repeat(20) + '끝', hadBom: true, lineEnding: 'crlf', mixed: false, hasBreak: true })
  })

  it('줄바꿈 없는 한 줄 → hasBreak 거짓', () => {
    const r = readPulled(b64(utf8('한 줄')))
    expect(r).toMatchObject({ text: '한 줄', hadBom: false, hasBreak: false })
  })

  it('섞인 줄바꿈 → mixed', () => {
    expect(readPulled(b64(utf8('a\r\nb\nc')))).toMatchObject({ text: 'a\nb\nc', mixed: true })
  })

  it('잘못된 base64 → unreadable, 0xff → not-utf8', () => {
    expect(readPulled('%%%')).toEqual({ error: 'unreadable' })
    expect(readPulled(b64([0x61, 0xff]))).toEqual({ error: 'not-utf8' })
  })
})

describe('F-2129 A2 lineEndingNote·sameNotice', () => {
  it('한 줄 파일 null, 같음 null', () => {
    expect(lineEndingNote(remote({ hasBreak: false, lineEnding: 'crlf' }), 'lf')).toBeNull()
    expect(lineEndingNote(remote({ lineEnding: 'lf' }), 'lf')).toBeNull()
    expect(lineEndingNote(remote({ lineEnding: 'crlf' }), 'crlf')).toBeNull()
  })

  it('CRLF↔LF·섞임 글자 그대로', () => {
    expect(lineEndingNote(remote({ lineEnding: 'crlf' }), 'lf')).toBe('줄바꿈이 다릅니다 (GitHub CRLF, 이 문서 LF). 푸시하면 이 문서 형식으로 올라갑니다')
    expect(lineEndingNote(remote({ lineEnding: 'lf' }), 'crlf')).toBe('줄바꿈이 다릅니다 (GitHub LF, 이 문서 CRLF). 푸시하면 이 문서 형식으로 올라갑니다')
    expect(lineEndingNote(remote({ lineEnding: 'crlf', mixed: true }), 'crlf')).toBe('줄바꿈이 다릅니다 (GitHub 섞임, 이 문서 CRLF). 푸시하면 이 문서 형식으로 올라갑니다')
  })

  it('sameNotice 두 꼴', () => {
    expect(sameNotice(null)).toBe('GitHub 파일과 같습니다')
    expect(sameNotice(lineEndingNote(remote({ lineEnding: 'crlf' }), 'lf'))).toBe(
      'GitHub 파일과 같습니다. 줄바꿈만 다릅니다 (GitHub CRLF, 이 문서 LF). 푸시하면 이 문서 형식으로 올라갑니다',
    )
  })

  it('오프라인 문구', () => {
    expect(PULL_OFFLINE_MESSAGE).toBe('온라인일 때 당길 수 있습니다')
  })
})

describe('F-2129 A2 pullFailureMessage', () => {
  it('404 github_not_found + remoteSha null → 아직 파일 없음', () => {
    expect(pullFailureMessage({ status: 404, error: 'github_not_found', body: null }, { remoteSha: null })).toBe('GitHub에 아직 파일이 없습니다. 첫 푸시가 만듭니다')
  })
  it('404 + sha 있음 → githubErrorMessage', () => {
    expect(pullFailureMessage({ status: 404, error: 'github_not_found', body: null }, { remoteSha: 'S1' })).toBe('GitHub에서 찾지 못했습니다. 저장소·브랜치·경로를 확인해 주세요')
  })
  it('503 github_disabled', () => {
    expect(pullFailureMessage({ status: 503, error: 'github_disabled', body: null }, { remoteSha: null })).toBe('지금은 GitHub 기능을 쓸 수 없습니다')
  })
})

describe('F-2129 A2 mergedTooLarge', () => {
  it('1,000,000 바이트는 통과, 1,000,001 은 넘음', () => {
    expect(mergedTooLarge('a'.repeat(1_000_000), 'lf')).toBe(false)
    expect(mergedTooLarge('a'.repeat(1_000_001), 'lf')).toBe(true)
  })
  it('UTF-8 바이트로 센다', () => {
    expect(mergedTooLarge('가'.repeat(333_334), 'lf')).toBe(true)
    expect(mergedTooLarge('가'.repeat(333_333), 'lf')).toBe(false)
  })
  it('CRLF 로 늘어나 넘는 경우', () => {
    const text = 'a'.repeat(999_990) + '\n'.repeat(10)
    expect(mergedTooLarge(text, 'lf')).toBe(false)
    expect(mergedTooLarge(text, 'crlf')).toBe(true)
  })
})
