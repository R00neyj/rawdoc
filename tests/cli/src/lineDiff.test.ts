// 줄 diff·unified diff (small 2026-10-11 CLI diff)
import { describe, expect, it } from 'vitest'
import { diffLines, splitLines, unifiedDiff } from '../../../cli/src/lineDiff'

const L = { old: 'old', new: 'new' }

describe('splitLines', () => {
  it('줄마다 \\n 을 품고, 끝 줄바꿈이 없으면 마지막 줄에 없다. CRLF·CR 은 LF 로', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a\nb\n')).toEqual(['a\n', 'b\n'])
    expect(splitLines('a\r\nb')).toEqual(['a\n', 'b'])
    expect(splitLines('a\rb\r')).toEqual(['a\n', 'b\n'])
  })
})

describe('unifiedDiff', () => {
  it('같으면 빈 문자열', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n', L)).toEqual({ text: '', added: 0, removed: 0 })
  })

  it('줄 넣기', () => {
    expect(unifiedDiff('a\nb\nc\n', 'a\nb\nX\nc\n', L).text).toBe('--- old\n+++ new\n@@ -1,3 +1,4 @@\n a\n b\n+X\n c\n')
  })

  it('줄 지우기', () => {
    expect(unifiedDiff('a\nb\nc\n', 'a\nc\n', L).text).toBe('--- old\n+++ new\n@@ -1,3 +1,2 @@\n a\n-b\n c\n')
  })

  it('줄 바꾸기 — 앞뒤 3줄만 문맥', () => {
    const old = '1\n2\n3\n4\n5\n6\n7\n8\n9\n'
    const d = unifiedDiff(old, old.replace('5\n', 'F\n'), L)
    expect(d.text).toBe('--- old\n+++ new\n@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+F\n 6\n 7\n 8\n')
    expect([d.added, d.removed]).toEqual([1, 1])
  })

  it('멀리 떨어진 변경은 두 덩어리', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `${i + 1}\n`).join('')
    const d = unifiedDiff(lines, lines.replace('2\n', 'B\n').replace('19\n', 'S\n'), L)
    expect(d.text.match(/^@@ /gm)).toHaveLength(2)
    expect(d.text).toContain('@@ -1,5 +1,5 @@\n')
    expect(d.text).toContain('@@ -16,5 +16,5 @@\n')
  })

  it('빈 글에 넣기는 -0,0', () => {
    expect(unifiedDiff('', 'a\n', L).text).toBe('--- old\n+++ new\n@@ -0,0 +1 @@\n+a\n')
  })

  it('CRLF 와 LF 는 같은 글로 보고, 끝 줄바꿈 차이는 표시한다', () => {
    expect(unifiedDiff('a\r\nb\r\n', 'a\nb\n', L).text).toBe('')
    expect(unifiedDiff('a\r\nb', 'a\nc', L).text).toBe(
      '--- old\n+++ new\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n',
    )
    expect(unifiedDiff('a\n', 'a', L).text).toBe('--- old\n+++ new\n@@ -1 +1 @@\n-a\n+a\n\\ No newline at end of file\n')
  })
})

describe('diffLines — 무작위 대조', () => {
  function lcsLength(a: string[], b: string[]): number {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
    return dp[a.length][b.length]
  }

  it('양쪽을 되살리고 같은 줄 수가 최장 공통 부분열과 같다', () => {
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: rand(12) }, () => 'abcd'[rand(4)])
      const b = Array.from({ length: rand(12) }, () => 'abcd'[rand(4)])
      const ops = diffLines(a, b)
      expect(ops.filter((o) => o.kind !== 'insert').map((o) => o.line)).toEqual(a)
      expect(ops.filter((o) => o.kind !== 'delete').map((o) => o.line)).toEqual(b)
      expect(ops.filter((o) => o.kind === 'equal')).toHaveLength(lcsLength(a, b))
    }
  })
})
