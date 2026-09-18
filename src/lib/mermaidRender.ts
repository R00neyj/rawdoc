// Mermaid 렌더링 공용 로직 (specs/features/F-258.md 2.2) — 편집·보기 모드가 같은 모듈을 쓴다. DOM 은 직접 다루지 않는다
import mermaid from 'mermaid'

const DEFAULT_ERROR = 'Mermaid 다이어그램을 그릴 수 없습니다'

let initialized = false
function ensureInitialized(): void {
  if (initialized) return
  mermaid.initialize({ startOnLoad: false })
  initialized = true
}

let counter = 0

export type MermaidResult = { svg: string } | { error: string }

// source: mermaid 코드블록 본문. 성공하면 {svg}, 예외(문법 오류 등)를 던지면 {error}
export async function renderMermaid(source: string): Promise<MermaidResult> {
  ensureInitialized()
  const id = `md-mermaid-${counter++}`
  try {
    const { svg } = await mermaid.render(id, source)
    return { svg }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : DEFAULT_ERROR
    return { error: message }
  }
}
