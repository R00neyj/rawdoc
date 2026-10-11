// get -o 옆 판 번호 기록 (small 2026-10-11 CLI 사이드카)
import { describe, expect, it } from 'vitest'
import brand from '../../../brand.config'
import { parseSidecar, serializeSidecar, sidecarPathOf } from '../../../cli/src/sidecar'

describe('sidecar', () => {
  it('경로는 파일 이름 뒤에 .{cliName}', () => {
    expect(sidecarPathOf('notes/a.md')).toBe(`notes/a.md.${brand.cliName}`)
  })

  it('JSON 한 줄로 쓰고 그대로 읽는다', () => {
    const text = serializeSidecar({ id: 'd1', version: 3, base: '줄1\r\n줄2' })
    expect(text).toBe('{"id":"d1","version":3,"base":"줄1\\r\\n줄2"}\n')
    expect(parseSidecar(text)).toEqual({ id: 'd1', version: 3, base: '줄1\r\n줄2' })
  })

  it('모양이 어긋나면 null', () => {
    for (const bad of ['', '{', 'null', '[]', '{"id":"","version":1,"base":""}', '{"id":"d","version":-1,"base":""}', '{"id":"d","version":1.5,"base":""}', '{"id":"d","version":1}']) {
      expect(parseSidecar(bad), bad).toBeNull()
    }
  })
})
