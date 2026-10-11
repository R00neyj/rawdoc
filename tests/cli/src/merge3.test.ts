// 줄 단위 3-way 합치기 (small 2026-10-11 CLI merge)
import { describe, expect, it } from 'vitest'
import { merge3 } from '../../../cli/src/merge3'

const LABELS = { mine: '내 파일', theirs: '서버 판 7' }
const BASE = 'a\nb\nc\nd\ne\n'

describe('merge3', () => {
  it('겹치지 않는 양쪽 변경은 충돌 없이 둘 다 담는다', () => {
    const r = merge3(BASE, 'a\nB\nc\nd\ne\n', 'a\nb\nc\nD\ne\nf\n', LABELS)
    expect(r).toEqual({ text: 'a\nB\nc\nD\ne\nf\n', conflicts: 0 })
  })

  it('양쪽이 같게 고친 곳은 한 번만', () => {
    expect(merge3(BASE, 'a\nB\nc\nd\ne\n', 'a\nB\nc\nd\ne\n', LABELS)).toEqual({ text: 'a\nB\nc\nd\ne\n', conflicts: 0 })
  })

  it('한쪽만 고쳤으면 그쪽을 따른다 — 서버가 그대로면 내 파일', () => {
    expect(merge3(BASE, 'x\n', BASE, LABELS)).toEqual({ text: 'x\n', conflicts: 0 })
    expect(merge3(BASE, BASE, '', LABELS)).toEqual({ text: '', conflicts: 0 })
  })

  it('같은 줄을 다르게 고치면 git 모양 충돌 표시', () => {
    const r = merge3(BASE, 'a\nM\nc\nd\ne\n', 'a\nT\nc\nd\ne\n', LABELS)
    expect(r.conflicts).toBe(1)
    expect(r.text).toBe('a\n<<<<<<< 내 파일\nM\n=======\nT\n>>>>>>> 서버 판 7\nc\nd\ne\n')
  })

  it('맞붙은 줄을 양쪽이 각각 고치면 git 처럼 한 덩어리 충돌', () => {
    expect(merge3('a\nb\nc\n', 'a\nB\nc\n', 'a\nb\nC\n', LABELS).conflicts).toBe(1)
  })

  it('끝에 서로 다른 줄을 붙이면 충돌, 끝 줄바꿈이 없어도 표시는 제 줄에', () => {
    const r = merge3('a\n', 'a\nm', 'a\nt', LABELS)
    expect(r).toEqual({ text: 'a\n<<<<<<< 내 파일\nm\n=======\nt\n>>>>>>> 서버 판 7\n', conflicts: 1 })
  })

  it('CRLF 는 LF 로 맞춰 비교한다 — 줄바꿈만 다른 서버 판은 바뀐 것이 아니다', () => {
    expect(merge3('a\r\nb\r\n', 'a\nB\n', 'a\r\nb\r\n', LABELS)).toEqual({ text: 'a\nB\n', conflicts: 0 })
  })
})
