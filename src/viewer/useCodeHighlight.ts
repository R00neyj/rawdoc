// 보기·인쇄·내보내기 html 의 코드블록 구문 색 (specs/features/F-2126.md 3장)
import { useEffect, useMemo, useState } from 'react'
import { codeLangIdsInHtml, type CodeLangId } from '../lib/codeLang'

export const HIGHLIGHT_WAIT_MS = 3000

type Highlight = typeof import('../lib/codeHighlight')
type Parsers = typeof import('../lib/codeParsers')

type Engine = { highlight: Highlight; parsers: Parsers }
let engine: Engine | null = null
let engineLoad: Promise<Engine | null> | null = null

// 엔진은 메인 청크에 넣지 않으려 동적 import — 실패하면 그 탭에서 다시 부르지 않는다
function loadEngine(): Promise<Engine | null> {
  engineLoad ??= Promise.all([import('../lib/codeHighlight'), import('../lib/codeParsers')]).then(
    ([highlight, parsers]) => (engine = { highlight, parsers }),
    () => null,
  )
  return engineLoad
}

function paint(html: string): string {
  if (!engine) return html
  const { highlight, parsers } = engine
  try {
    return highlight.highlightHtmlCodeBlocks(html, (id) => parsers.loadedCodeGrammar(id)?.parser ?? null)
  } catch {
    return html
  }
}

async function loadAll(ids: CodeLangId[]): Promise<void> {
  const e = await loadEngine()
  if (e) await Promise.all(ids.map((id) => e.parsers.loadCodeGrammar(id).catch(() => null)))
}

export async function highlightHtmlWhenReady(html: string, waitMs: number = HIGHLIGHT_WAIT_MS): Promise<string> {
  const ids = codeLangIdsInHtml(html)
  if (ids.length === 0) return html
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs)
  })
  await Promise.race([loadAll(ids).catch(() => undefined), timeout])
  clearTimeout(timer)
  return paint(html)
}

function loadedCount(ids: CodeLangId[]): number {
  return engine ? ids.filter((id) => engine!.parsers.loadedCodeGrammar(id) !== null).length : 0
}

function allLoaded(ids: CodeLangId[]): boolean {
  return !!engine && ids.every((id) => engine!.parsers.loadedCodeGrammar(id) !== null)
}

export function useCodeHighlight(html: string): string {
  const [version, setVersion] = useState(0)
  // 갱신 번호는 문법이 새로 불러와졌을 때만 올라 다시 계산하게 하는 의존이다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (codeLangIdsInHtml(html).length === 0 ? html : paint(html)), [html, version])

  useEffect(() => {
    const ids = codeLangIdsInHtml(html)
    if (ids.length === 0 || allLoaded(ids)) return
    let cancelled = false
    const before = loadedCount(ids)
    void loadAll(ids).then(() => {
      if (!cancelled && loadedCount(ids) > before) setVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [html])

  return shown
}
