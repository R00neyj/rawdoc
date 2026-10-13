import { describe, expect, it } from 'vitest'
import {
  branchChoices, decideGithubResume, decodeGithubContent, githubConnectErrorMessage, githubConnectUrl, githubDocRole, githubDocTitle,
  githubErrorMessage, githubFirstCommitMessage, githubLinkAction, githubTopBarKind, linkTargetPath, parseGithubStatus, readGithubReturn, resumeMarker,
  urlWithoutGithubParams,
} from '../../../src/app/githubUi'
import type { GithubLink } from '../../../src/lib/githubContract'
import { ACCOUNT_BLOCKED_MESSAGE } from '../../../src/lib/usageLimits'

describe('F-2128 A1', () => {
  it('parseGithubStatus', () => {
    const ok = { enabled: true, connected: true, login: 'o', reconnect: false, month: { used: 1, limit: null } }
    expect(parseGithubStatus(ok)).toEqual(ok)
    expect(parseGithubStatus({ enabled: 'yes', connected: false, month: { used: 0, limit: null } })).toBeNull()
    expect(parseGithubStatus({ enabled: true, connected: false })).toBeNull()
    expect(parseGithubStatus('<html>')).toBeNull()
    expect(parseGithubStatus(null)).toBeNull()
  })
  it('githubDocRole', () => {
    expect(githubDocRole({})).toBe('owner')
    expect(githubDocRole({ role: 'owner' })).toBe('owner')
    expect(githubDocRole({ role: 'edit' })).toBe('editor')
    expect(githubDocRole({ role: 'view' })).toBeNull()
    expect(githubDocRole({ e2ee: {} })).toBeNull()
    expect(githubDocRole(null)).toBeNull()
  })
})

describe('F-2128 A2', () => {
  it('urlWithoutGithubParams', () => {
    expect(urlWithoutGithubParams('/', '?app=1&github=connected', '#/d/x')).toBe('/?app=1#/d/x')
    expect(urlWithoutGithubParams('/', '?github_error=denied', '#/')).toBe('/#/')
    expect(urlWithoutGithubParams('/', '?a=1&github=connected&b=2', '')).toBe('/?a=1&b=2')
  })
  it('readGithubReturn', () => {
    expect(readGithubReturn('?github=connected')).toEqual({ kind: 'connected' })
    expect(readGithubReturn('?github_error=denied')).toEqual({ kind: 'error', code: 'denied' })
    expect(readGithubReturn('?app=1')).toBeNull()
  })
  it('decideGithubResume', () => {
    const now = 10_000_000
    const m = resumeMarker({ kind: 'link', docId: 'd1' }, 'u', now)
    expect(decideGithubResume(m, 'u', now + 29 * 60_000)).toEqual({ kind: 'link', docId: 'd1' })
    expect(decideGithubResume(m, 'u', now + 30 * 60_000)).toBeNull()
    expect(decideGithubResume(m, 'other', now)).toBeNull()
    expect(decideGithubResume('{oops', 'u', now)).toBeNull()
    expect(decideGithubResume(resumeMarker({ kind: 'import' }, 'u', now), 'u', now)).toEqual({ kind: 'import' })
  })
  it('githubConnectUrl', () => {
    expect(githubConnectUrl('#/d/x')).toBe('/api/github/connect?return=%23%2Fd%2Fx')
    expect(githubConnectUrl('')).toBe('/api/github/connect?return=%23%2F')
  })
})

describe('F-2128 A3', () => {
  it('error messages', () => {
    const e = (error: string | null, body: unknown = null, status = 400) => githubErrorMessage({ status, error, body })
    expect(e('github_quota', { limit: 3, resetAt: Date.UTC(2026, 10, 1) })).toBe('이번 달 GitHub 사용 3회를 모두 썼습니다. 11월 1일에 다시 쓸 수 있습니다')
    expect(e('github_disabled')).toBe('지금은 GitHub 기능을 쓸 수 없습니다')
    expect(e('github_reconnect')).toBe('GitHub 연결이 만료됐습니다. 다시 연결해 주세요')
    expect(e('github_rate_limited')).toBe('GitHub 요청이 많아 잠시 뒤에 다시 해 주세요')
    expect(e('too_large')).toBe('GitHub 파일이 너무 큽니다 (최대 1MB)')
    expect(e('github_forbidden')).toBe('GitHub에서 이 저장소에 쓸 수 없습니다')
    expect(e('github_not_found')).toBe('GitHub에서 찾지 못했습니다. 저장소·브랜치·경로를 확인해 주세요')
    expect(e('github_target_taken')).toBe('이 GitHub 파일은 이미 다른 문서에 연결돼 있습니다')
    expect(e('account_blocked')).toBe(ACCOUNT_BLOCKED_MESSAGE)
    expect(e('rate_limited')).toBe('요청이 많아 잠시 뒤에 다시 해 주세요')
    expect(e(null, null, 0)).toBe('GitHub에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요')
  })
  it('connect error messages', () => {
    expect(githubConnectErrorMessage('denied')).toBe('GitHub 연결을 취소했습니다')
    expect(githubConnectErrorMessage('state')).toBe('GitHub 연결이 중간에 끊겼습니다. 다시 해 주세요')
    expect(githubConnectErrorMessage('github_taken')).toBe('이 GitHub 계정은 이미 다른 계정에 연결돼 있습니다')
    expect(githubConnectErrorMessage('disabled')).toBe('지금은 GitHub 기능을 쓸 수 없습니다')
    expect(githubConnectErrorMessage('exchange_failed')).toBe('GitHub에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요')
  })
})

describe('F-2128 A4', () => {
  it('githubDocTitle', () => {
    expect(githubDocTitle('docs/a.markdown')).toBe('a')
    expect(githubDocTitle('A.MD')).toBe('A')
    expect(githubDocTitle('x/.md')).toBe('제목 없는 문서')
  })
  it('decodeGithubContent', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# 제목\n본문\n'.repeat(20))])
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/(.{60})/g, '$1\n')
    expect(Array.from(decodeGithubContent(b64))).toEqual(Array.from(bytes))
    expect(() => decodeGithubContent('***')).toThrow()
  })
  it('branchChoices', () => {
    expect(branchChoices(['a', 'main'], 'main')).toEqual(['a', 'main'])
    expect(branchChoices(['a'], 'main')).toEqual(['main', 'a'])
  })
  it('linkTargetPath', () => {
    expect(linkTargetPath('', 'a.md')).toBe('a.md')
    expect(linkTargetPath('d', 'a/b.md')).toBeNull()
    expect(linkTargetPath('d', 'a.txt')).toBeNull()
    expect(linkTargetPath('d', '  a.md ')).toBe('d/a.md')
    expect(linkTargetPath('d', '  ')).toBeNull()
  })
})

describe('GitHub 새 파일 흐름 (small 2026-10-13)', () => {
  const LINK = { repo: 'o/r', branch: 'main', path: 'a.md' } as GithubLink
  it('githubTopBarKind — 연결된 문서는 linked, 주인의 연결 안 된 문서는 unlinked, 확인 중·편집자·금고는 없음', () => {
    expect(githubTopBarKind('owner', LINK)).toBe('linked')
    expect(githubTopBarKind('editor', LINK)).toBe('linked')
    expect(githubTopBarKind('owner', null)).toBe('unlinked')
    expect(githubTopBarKind('editor', null)).toBeNull()
    expect(githubTopBarKind('owner', undefined)).toBeNull()
    expect(githubTopBarKind(null, null)).toBeNull()
  })
  it('githubFirstCommitMessage', () => {
    expect(githubFirstCommitMessage(' 메모.md ')).toBe('메모.md 추가')
  })
  it('decideGithubResume — create 표지', () => {
    expect(decideGithubResume(resumeMarker({ kind: 'create' }, 'u1', 1000), 'u1', 2000)).toEqual({ kind: 'create' })
  })
  it('githubLinkAction', () => {
    const base = { create: false, canPush: true, targetPath: 'a.md', dirClash: false, existed: false, message: 'a.md 추가' }
    expect(githubLinkAction(base)).toEqual({ kind: 'linkPush', note: null })
    expect(githubLinkAction({ ...base, existed: true })).toEqual({ kind: 'link', note: null })
    expect(githubLinkAction({ ...base, canPush: false })).toEqual({ kind: 'link', note: null })
    expect(githubLinkAction({ ...base, message: '  ' })).toEqual({ kind: 'blocked', note: '커밋 메시지를 적어 주세요' })
    expect(githubLinkAction({ ...base, targetPath: null }).kind).toBe('blocked')
    expect(githubLinkAction({ ...base, targetPath: null }).note).toMatch(/\.md 또는 \.markdown/)
    expect(githubLinkAction({ ...base, dirClash: true })).toEqual({ kind: 'blocked', note: '같은 이름의 폴더가 있습니다' })
    expect(githubLinkAction({ ...base, create: true })).toEqual({ kind: 'linkPush', note: null })
    expect(githubLinkAction({ ...base, create: true, canPush: false })).toEqual({ kind: 'linkPush', note: null })
    expect(githubLinkAction({ ...base, create: true, existed: true })).toEqual({
      kind: 'blocked', note: '이 폴더에 같은 이름의 파일이 있습니다. 그 파일은 GitHub에서 가져오기로 여세요',
    })
  })
})
