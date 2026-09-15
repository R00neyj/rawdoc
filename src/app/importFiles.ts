// .md 가져오기 (specs/features/F-114.md 2.2). F-119 가 재사용할 수 있게 파일 목록을 받는다
import { decodeMarkdown } from '../lib/decodeMarkdown'
import type { Doc, LineEnding } from '../types'

type ImportNotice = { type: 'info' | 'error'; message: string }
type ImportStore = {
  create(input: { title: string; content: string; lineEnding: LineEnding }): Promise<Doc>
}

function titleFromFileName(name: string | undefined | null): string {
  const stripped = String(name ?? '').replace(/\.md$/i, '')
  return stripped === '' ? '제목 없는 문서' : stripped
}

// files: 가져올 파일들
// onCreated: 문서마다 호출. 마지막 파일이면 isLast:true — 호출부가 그 문서를 연다(해시 추가)
export async function importFiles(
  files: FileList | File[] | null | undefined,
  {
    store,
    onCreated,
    notify,
  }: {
    store: ImportStore
    onCreated?: (doc: Doc, info: { isLast: boolean }) => void
    notify?: (notice: ImportNotice | null) => void
  },
): Promise<void> {
  const fileArray = Array.from(files ?? [])
  let lastSuccessNotice: ImportNotice | null = null
  let lastErrorNotice: ImportNotice | null = null

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i]
    const isLast = i === fileArray.length - 1

    try {
      const buffer = await file.arrayBuffer()

      let decoded
      try {
        decoded = decodeMarkdown(new Uint8Array(buffer))
      } catch (err) {
        if (err instanceof Error && err.message === 'not-utf8') {
          lastErrorNotice = {
            type: 'error',
            message: `"${file.name}" 을(를) 가져오지 못했습니다. UTF-8 텍스트 파일이 아닙니다.`,
          }
          continue
        }
        throw err
      }

      const doc = await store.create({
        title: titleFromFileName(file.name),
        content: decoded.text,
        lineEnding: decoded.lineEnding,
      })

      let message = `"${file.name}" 을(를) 가져왔습니다.`
      if (decoded.mixed) message += ' 줄바꿈 형식이 섞여 있어 CRLF 로 통일했습니다.'
      if (decoded.hadBom) message += ' 파일 맨 앞의 BOM 을 제거했습니다.'
      lastSuccessNotice = { type: 'info', message }

      onCreated?.(doc, { isLast })
    } catch {
      lastErrorNotice = { type: 'error', message: `"${file.name}" 을(를) 읽지 못했습니다.` }
    }
  }

  notify?.(lastErrorNotice ?? lastSuccessNotice ?? null)
}
