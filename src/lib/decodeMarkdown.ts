// 가져온 파일 바이트 → 원문 해독 (specs/features/F-114.md 2.1)
import { detectLineEnding, toEditorText, fromEditorText, type LineEnding } from './lineEnding'

const BOM_BYTES = [0xef, 0xbb, 0xbf]

function hasBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === BOM_BYTES[0] && bytes[1] === BOM_BYTES[1] && bytes[2] === BOM_BYTES[2]
}

export type DecodedMarkdown = {
  text: string
  lineEnding: LineEnding
  mixed: boolean
  hadBom: boolean
}

// UTF-8 로 해독할 수 없으면 message 가 'not-utf8' 인 Error 를 던진다
export function decodeMarkdown(bytes: Uint8Array): DecodedMarkdown {
  const hadBom = hasBom(bytes)
  const data = hadBom ? bytes.subarray(3) : bytes

  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data)
  } catch {
    throw new Error('not-utf8')
  }

  const { lineEnding, mixed } = detectLineEnding(raw)
  const text = fromEditorText(toEditorText(raw), lineEnding)

  return { text, lineEnding, mixed, hadBom }
}
