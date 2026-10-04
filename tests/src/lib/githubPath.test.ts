// F-3015 A1~A3 저장소 경로 규칙 (specs/features/F-3015.md 2장)
import { describe, expect, it } from 'vitest'
import {
  githubBlobUrl,
  isBranchName,
  isRepoDir,
  isRepoFullName,
  isRepoMdPath,
  repoImagePaths,
  resolveRepoPath,
} from '../../../src/lib/githubPath'

const MD = 'docs/guide/a.md'

describe('F-3015 A1 resolveRepoPath', () => {
  it.each([
    ['./img/x.png', 'docs/guide/img/x.png'],
    ['../img/x.png', 'docs/img/x.png'],
    ['/assets/x.png', 'assets/x.png'],
    ['img/x%20y.png', 'docs/guide/img/x y.png'],
    ['x.png?raw=1#a', 'docs/guide/x.png'],
    ['%2e%2e/x.png', 'docs/x.png'],
  ])('%s -> %s', (url, expected) => {
    expect(resolveRepoPath(MD, url)).toBe(expected)
  })

  it.each([
    '../../../x.png',
    'https://a/x.png',
    '//a/x.png',
    'C:\\x.png',
    'a\\b.png',
    '%zz.png',
    '',
    'img/',
    'a//b.png',
    'a\u0001b.png',
  ])('null: %s', (url) => {
    expect(resolveRepoPath(MD, url)).toBeNull()
  })

  it('1,025자는 null, 1,024자는 통과', () => {
    expect(resolveRepoPath('README.md', `${'a'.repeat(1021)}.png`)).toBeNull()
    expect(resolveRepoPath('README.md', `${'a'.repeat(1020)}.png`)).not.toBeNull()
  })

  it('맨 위 문서 기준', () => {
    expect(resolveRepoPath('README.md', 'x.png')).toBe('x.png')
  })
})

describe('F-3015 A2 repoImagePaths', () => {
  it('마크다운·img 태그를 모으고 attachments·스킴·맨 위 넘김은 뺀다', () => {
    const body = [
      'text ![a](img/one.png) mid ![b](<img/two words.png> "t") end',
      '<img alt="x" src="img/three.png">',
      "<IMG SRC='img/four.png'>",
      '<img src=img/five.png width=3>',
      '![c](attachments/0123456789abcdef.png)',
      '![d](https://a/x.png)',
      '![e](../../../../x.png)',
      '![dup](img/one.png)',
    ].join('\n')
    const got = repoImagePaths(body, MD)
    expect([...got].sort()).toEqual(
      [
        'docs/guide/img/one.png',
        'docs/guide/img/two words.png',
        'docs/guide/img/three.png',
        'docs/guide/img/four.png',
        'docs/guide/img/five.png',
      ].sort(),
    )
  })
})

describe('F-3015 A3 판별·주소', () => {
  it('isRepoMdPath', () => {
    expect(isRepoMdPath('a/B.MD')).toBe(true)
    expect(isRepoMdPath('a/b.markdown')).toBe(true)
    for (const v of ['a/b.txt', '/a.md', 'a/../b.md', 3, null]) expect(isRepoMdPath(v)).toBe(false)
  })
  it('isRepoDir', () => {
    expect(isRepoDir('')).toBe(true)
    expect(isRepoDir('a/b')).toBe(true)
    expect(isRepoDir('a/')).toBe(false)
  })
  it('isRepoFullName', () => {
    expect(isRepoFullName('o/r.js')).toBe(true)
    for (const v of ['o/..', '-o/r', 'o/r/x', 'o/.', 'o']) expect(isRepoFullName(v)).toBe(false)
  })
  it('isBranchName', () => {
    expect(isBranchName('feature/x')).toBe(true)
    for (const v of ['a..b', 'x.lock', '/x', 'a b', 'a/', 'a@{b', 'a//b', '', 'a~b']) expect(isBranchName(v)).toBe(false)
  })
  it('githubBlobUrl', () => {
    expect(githubBlobUrl('o/r', 'feature/x', '문서/a b.md')).toBe('https://github.com/o/r/blob/feature/x/%EB%AC%B8%EC%84%9C/a%20b.md')
  })
})
