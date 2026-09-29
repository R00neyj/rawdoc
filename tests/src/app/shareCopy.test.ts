import { describe, expect, it } from 'vitest'
import { copyShareLink, copyShareMarkdown, WARN_LINK_LENGTH, type ShareCopyDeps } from '../../../src/app/shareCopy'
import { decodeShare } from '../../../src/lib/shareCodec'
import type { Notice } from '../../../src/app/notice'

const BASE_URL = 'https://x.test/'

function makeDeps(content: string, opts: { fail?: boolean } = {}): { deps: ShareCopyDeps; notices: Notice[]; copied: string[] } {
  const notices: Notice[] = []
  const copied: string[] = []
  const deps: ShareCopyDeps = {
    getShareDoc: () => ({ title: '문서', content, lineEnding: 'lf' }),
    onNotice: (n) => notices.push(n),
    writeText: async (text) => {
      if (opts.fail) throw new Error('clipboard 권한 없음')
      copied.push(text)
    },
    baseUrl: BASE_URL,
  }
  return { deps, notices, copied }
}

describe('copyShareMarkdown — U10 (F-2054 6.2)', () => {
  it('① 성공 — writeText 인자가 문서 원문, 알림 마크다운을 복사했습니다', async () => {
    const { deps, notices, copied } = makeDeps('본문 원문')
    await copyShareMarkdown(deps)
    expect(copied).toEqual(['본문 원문'])
    expect(notices).toEqual([{ type: 'info', message: '마크다운을 복사했습니다.' }])
  })

  it('② writeText 가 던지면 error 알림', async () => {
    const { deps, notices } = makeDeps('본문', { fail: true })
    await copyShareMarkdown(deps)
    expect(notices).toEqual([{ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' }])
  })
})

describe('copyShareLink — U10 (F-2054 6.2)', () => {
  it('③ 주석을 뗀 뒤 링크로 담는다 — 주소 머리, 주석 없음, 알림', async () => {
    const { deps, copied, notices } = makeDeps('a %%주석%% b')
    await copyShareLink(deps)
    expect(copied).toHaveLength(1)
    const link = copied[0]
    expect(link.startsWith(`${BASE_URL}#/s/`)).toBe(true)
    const fragment = link.slice(`${BASE_URL}#/s/`.length)
    const decoded = await decodeShare(fragment)
    expect(decoded.content).not.toContain('주석')
    expect(notices).toEqual([{ type: 'info', message: '공유 링크를 복사했습니다. 문서 내용이 링크 주소에 담깁니다.' }])
  })

  it('④ 첨부 이미지 참조가 있으면 이미지는 링크에 담기지 않는다는 알림', async () => {
    const { deps, notices } = makeDeps(
      '<div align="left">\n<img src="attachments/0123456789abcdef.png" />\n</div>\n',
    )
    await copyShareLink(deps)
    expect(notices).toEqual([{ type: 'info', message: '공유 링크를 복사했습니다. 이미지는 링크에 담기지 않습니다.' }])
  })

  it('⑤ 길이가 경고 선을 넘으면 warn 알림', async () => {
    const long = Array.from({ length: WARN_LINK_LENGTH }, () => Math.random().toString(36)).join('')
    const { deps, notices } = makeDeps(long)
    await copyShareLink(deps)
    expect(notices).toHaveLength(1)
    expect(notices[0].type).toBe('warn')
    expect(notices[0].message).toMatch(/^링크가 깁니다\(약 \d+KB\)/)
  })
})
