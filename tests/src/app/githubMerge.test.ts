// 당기기 합치기 덩어리 계산 — 줄 단위 override (specs/features/F-2129.md 3.1·7장)
import { Change, Chunk } from '@codemirror/merge'
import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { MERGE_COLLAPSE, MERGE_DIFF_CONFIG, mergeChanges, mergeLineDiff } from '../../../src/app/githubMerge'

function applyDiff(a: string, b: string, changes: readonly Change[]): string {
  let out = a
  for (const c of [...changes].sort((x, y) => y.fromA - x.fromA)) out = out.slice(0, c.fromA) + b.slice(c.fromB, c.toB) + out.slice(c.toA)
  return out
}

function lines(n: number, f: (i: number) => string): string {
  return Array.from({ length: n }, (_, i) => f(i)).join('\n')
}

const CASES: [string, string, string][] = [
  ['가운데 줄', 'a\nb\nc', 'a\nB\nc'],
  ['끝 줄 더하기', 'a\nb', 'a\nb\nc'],
  ['끝 줄 빼기', 'a\nb\nc', 'a\nb'],
  ['빈 글자 → x', '', 'x'],
  ['x → 빈 글자', 'x', ''],
  ['끝 줄바꿈 더하기', 'a\nb', 'a\nb\n'],
  ['끝 줄바꿈 빼기', 'a\nb\n', 'a\nb'],
  ['빈 줄 둘 → 하나', '\n\n', '\n'],
  ['같음', '같은\n본문\n', '같은\n본문\n'],
  ['한 줄 한글, 단어 하나만', '오늘은 맑은 날씨입니다', '오늘은 흐린 날씨입니다'],
]

describe('F-2129 A1 mergeLineDiff', () => {
  it.each(CASES)('%s — 원본에 적용하면 결과와 같고 Change 인스턴스다', (_name, a, b) => {
    const changes = mergeLineDiff(a, b)
    expect(applyDiff(a, b, changes)).toBe(b)
    for (const c of changes) expect(c).toBeInstanceOf(Change)
  })

  it('같으면 빈 배열', () => {
    expect(mergeLineDiff('a\nb', 'a\nb')).toEqual([])
  })

  it('한 줄 한글은 바뀐 단어만 덮는다', () => {
    const a = '오늘은 맑은 날씨입니다'
    const b = '오늘은 흐린 날씨입니다'
    const changes = mergeLineDiff(a, b)
    const covered = changes.reduce((n, c) => n + (c.toA - c.fromA), 0)
    expect(covered).toBeLessThanOrEqual(2)
    expect(applyDiff(a, b, changes)).toBe(b)
  })

  it('양쪽 1,000자를 넘는 바뀐 묶음은 다시 쪼개지 않고 Change 하나', () => {
    const a = `머리\n${'가'.repeat(1_200)}\n꼬리`
    const b = `머리\n${'가'.repeat(600)}나${'가'.repeat(599)}\n꼬리`
    const changes = mergeLineDiff(a, b)
    expect(changes).toHaveLength(1)
    expect(applyDiff(a, b, changes)).toBe(b)
  })

  it('2,000줄 중 20곳 → Chunk.build 덩어리 20', () => {
    const a = lines(2_000, (i) => `줄 ${i} 본문 내용`)
    const b = lines(2_000, (i) => (i % 100 === 50 ? `줄 ${i} 고친 내용` : `줄 ${i} 본문 내용`))
    const chunks = Chunk.build(Text.of(a.split('\n')), Text.of(b.split('\n')), MERGE_DIFF_CONFIG)
    expect(chunks).toHaveLength(20)
    expect(applyDiff(a, b, mergeLineDiff(a, b))).toBe(b)
  })

  it('서로 다른 줄 70,000개 → Change 1개, 적용하면 결과와 같다', () => {
    const a = lines(70_000, (i) => `a${i}`)
    const b = lines(70_000, (i) => (i === 35_000 ? 'x' : `a${i}`))
    const changes = mergeLineDiff(a, b)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toBeInstanceOf(Change)
    expect(applyDiff(a, b, changes)).toBe(b)
  })

  it('접기 설정', () => {
    expect(MERGE_COLLAPSE).toEqual({ margin: 3, minSize: 4 })
  })
})

describe('F-2129 A1 mergeChanges', () => {
  it('같음 → []', () => {
    expect(mergeChanges('a\nb\n', 'a\nb\n')).toEqual([])
  })

  it('원본 위치 기준 { from, to, insert } — 앞에서부터 순서, 적용하면 결과', () => {
    const base = '하나\n둘\n셋\n넷\n'
    const result = '하나\n둘!\n셋\n넷 넷\n'
    const changes = mergeChanges(base, result)
    expect(changes.length).toBeGreaterThan(0)
    for (let i = 1; i < changes.length; i++) expect(changes[i].from).toBeGreaterThanOrEqual(changes[i - 1].to)
    let out = base
    for (const c of [...changes].reverse()) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
    expect(out).toBe(result)
  })
})
