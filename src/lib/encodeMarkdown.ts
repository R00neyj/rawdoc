// 원문 → 파일 바이트, decodeMarkdown 의 짝 (specs/features/F-2155.md 1장, F-2154 3장)
const BOM_BYTES = [0xef, 0xbb, 0xbf]

// text 는 파일 줄바꿈 그대로(getText(lineEnding)) — 여기서는 줄바꿈을 건드리지 않는다
export function encodeMarkdown(text: string, opts: { hadBom: boolean }): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(text)
  if (!opts.hadBom) return body
  const out = new Uint8Array(BOM_BYTES.length + body.length)
  out.set(BOM_BYTES)
  out.set(body, BOM_BYTES.length)
  return out
}
