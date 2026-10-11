// get -o 가 파일 옆에 남기는 기록 — 받은 문서 id·판 번호·받은 원문(merge 의 base). put --base-version auto 와 merge 가 읽는다
import brand from '../../brand.config'

export type Sidecar = { id: string; version: number; base: string }

export const SIDECAR_SUFFIX = `.${brand.cliName}`

export function sidecarPathOf(file: string): string {
  return `${file}${SIDECAR_SUFFIX}`
}

export function serializeSidecar(sidecar: Sidecar): string {
  return `${JSON.stringify({ id: sidecar.id, version: sidecar.version, base: sidecar.base })}\n`
}

// 모양이 어긋나면 null — 손으로 고친 파일을 믿지 않는다
export function parseSidecar(text: string): Sidecar | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { id, version, base } = value as Record<string, unknown>
  if (typeof id !== 'string' || id === '' || typeof base !== 'string') return null
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return null
  return { id, version, base }
}
