// WebGL2 판정 — three 를 끌어오지 않게 MapScene 밖에 둔다. 한 번 재면 모듈 수준에 캐시한다 (F-2002 6.2)
let webgl2Cache: boolean | null = null

export function hasWebGL2(): boolean {
  if (webgl2Cache !== null) return webgl2Cache
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2')
    // 컨텍스트 슬롯(보통 16개)을 낭비하지 않게 바로 놓는다
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext()
    webgl2Cache = Boolean(gl)
  } catch {
    webgl2Cache = false
  }
  return webgl2Cache
}
