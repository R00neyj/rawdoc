// F-3023 A11 — 휴지통 공용 순수 함수
import { describe, expect, it } from 'vitest'
import { TRASH_RETENTION_DAYS, trashActorForMcp, trashPathOf, trashPurgeAt } from '../../../src/lib/trash'

describe('F-3023 A11 trashActorForMcp', () => {
  it('제어 문자 제거 → trim → mcp: 접두', () => {
    expect(trashActorForMcp('  Cl\u0007aude  ')).toBe('mcp:Claude')
  })

  it('41 코드 포인트 이모지 이름은 40 코드 포인트에서 자른다', () => {
    const name = '😀'.repeat(41)
    const actor = trashActorForMcp(name)
    expect(actor.startsWith('mcp:')).toBe(true)
    expect([...actor.slice(4)]).toHaveLength(40)
    expect(actor).toBe(`mcp:${'😀'.repeat(40)}`)
  })

  it('남는 게 없으면 mcp:', () => {
    expect(trashActorForMcp('\n')).toBe('mcp:')
    expect(trashActorForMcp('   ')).toBe('mcp:')
  })
})

describe('F-3023 A11 trashPathOf', () => {
  const folders = [
    { id: 'a', name: 'A', parentId: null },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'c', name: 'C', parentId: 'b' },
  ]

  it('뿌리 → 잎 이름을 / 로 잇는다', () => {
    expect(trashPathOf(folders, 'c')).toBe('A/B/C')
    expect(trashPathOf(folders, 'a')).toBe('A')
  })

  it('최상위·없는 폴더는 null', () => {
    expect(trashPathOf(folders, null)).toBeNull()
    expect(trashPathOf(folders, 'zz')).toBeNull()
  })

  it('순환이 저장돼도 끝난다', () => {
    const loop = [
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' },
    ]
    expect(trashPathOf(loop, 'x')).toBe('Y/X')
  })
})

describe('F-3023 A11 trashPurgeAt', () => {
  it('지운 때 + 30일', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30)
    expect(trashPurgeAt(1_000)).toBe(1_000 + 30 * 24 * 60 * 60 * 1000)
  })
})
