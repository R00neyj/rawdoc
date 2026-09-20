// Mermaid 렌더링 공용 로직 (specs/features/F-258.md 2.2, F-260.md 2.1) — 편집·보기 모드가 같은 모듈을 쓴다. DOM 은 직접 다루지 않는다
import mermaid from 'mermaid'

const DEFAULT_ERROR = 'Mermaid 다이어그램을 그릴 수 없습니다'

type MermaidTheme = 'default' | 'dark'

// 앱 테마(white|sepia|dark) → mermaid 테마(F-260 2.1) — white·sepia·모르는 값은 mermaid 기본('default'), dark 일 때만 'dark'(세피아는 화이트와 동일 취급, 사용자 확인)
function mermaidThemeFor(appTheme: string): MermaidTheme {
  return appTheme === 'dark' ? 'dark' : 'default'
}

// 마지막으로 mermaid.initialize 에 넘긴 테마 — 바뀌지 않는 한 재호출하지 않는다(F-258 "1회만 호출" 취지를 "테마가 바뀌지 않는 한 1회만" 으로, F-260 2.1)
let currentMermaidTheme: MermaidTheme | undefined
function ensureTheme(theme: MermaidTheme): void {
  if (currentMermaidTheme === theme) return
  mermaid.initialize({ startOnLoad: false, theme })
  currentMermaidTheme = theme
}

let counter = 0

export type MermaidResult = { svg: string } | { error: string }

// source: mermaid 코드블록 본문. appTheme: 앱 테마(F-260 2.1, 모르는 값·생략은 'default' — exportDoc.ts·fillMarkdownAssets.ts 는 F-260 소유 범위 밖이라 아직 안 넘긴다). 성공하면 {svg}, 예외(문법 오류 등)를 던지면 {error}
export async function renderMermaid(source: string, appTheme = 'white'): Promise<MermaidResult> {
  ensureTheme(mermaidThemeFor(appTheme))
  const id = `md-mermaid-${counter++}`
  try {
    const { svg } = await mermaid.render(id, source)
    return { svg }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : DEFAULT_ERROR
    return { error: message }
  }
}
