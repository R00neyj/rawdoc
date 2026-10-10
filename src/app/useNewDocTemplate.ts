// 템플릿 목록·원문 읽기·새 문서 본문 — App.tsx 에서 옮김 (F-2078, F-2022, F-2037)
import { useMemo, type RefObject } from 'react'
import { listTemplates, resolveNewDocTemplate, newDocContentFromTemplate, NEW_DOC_TEMPLATE_NONE, type TemplateEntry } from '../lib/templates'
import { getPref } from './prefs'
import { withTemplateReadTimeout } from './newDocTemplate'
import type { DocMeta } from './docMeta'
import type { EditorHandle } from '../editor/Editor'
import type { Folder, Store } from '../types'

export type UseNewDocTemplateOptions = {
  store: Store
  docs: DocMeta[]
  folders: Folder[]
  currentDocIdRef: RefObject<string | null>
  editorRef: RefObject<EditorHandle | null>
}

export type TemplateContentVars = { title: string; emptyTitle?: 'fallback' | 'keep-empty'; now?: Date }

export type UseNewDocTemplateResult = {
  templateEntries: TemplateEntry[]
  readTemplateDocText: (docId: string) => Promise<string | null>
  buildNewDocContent: (vars: TemplateContentVars) => Promise<{ content: string; failed: boolean }>
  buildContentFromTemplate: (templateId: string, vars: TemplateContentVars) => Promise<{ content: string; failed: boolean }>
}

export function useNewDocTemplate(options: UseNewDocTemplateOptions): UseNewDocTemplateResult {
  const { store, docs, folders, currentDocIdRef, editorRef } = options
  // 최상위 '템플릿'·'templates' 폴더 하위 문서 + 내장 4개 (F-2022.md 4.2)
  const templateEntries: TemplateEntry[] = useMemo(
    () => listTemplates({ folders, docs: docs.map((d) => ({ id: d.id, title: d.title, folderId: d.folderId ?? null, role: d.role, e2ee: d.e2ee })) }),
    [folders, docs],
  )

  // 사용자 템플릿(문서) 원문 읽기 — 명령 팔레트 insertTemplate 과 새 문서 만들기가 함께 쓴다 (F-2037.md 4.2)
  async function readTemplateDocText(docId: string): Promise<string | null> {
    try {
      if (docId === currentDocIdRef.current && editorRef.current) {
        return editorRef.current.getText('lf')
      }
      const doc = await store.get(docId)
      return doc?.content ?? null
    } catch {
      return null
    }
  }

  // 템플릿 id → 새 문서 본문. 'none'·목록에 없는 id 는 빈 문서, 읽기 실패는 failed (F-2037.md 4.2·4.3)
  async function buildContentFromTemplate(templateId: string, vars: TemplateContentVars): Promise<{ content: string; failed: boolean }> {
    const resolution = resolveNewDocTemplate(templateId, templateEntries)
    if (resolution.kind !== 'found') return { content: '', failed: false }

    const fullVars = { ...vars, now: vars.now ?? new Date() }
    if (resolution.entry.source.kind === 'builtin') {
      return { content: newDocContentFromTemplate(resolution.entry.source.body, fullVars, 'crlf'), failed: false }
    }

    const rawText = await withTemplateReadTimeout(readTemplateDocText(resolution.entry.source.docId))
    if (rawText === null) return { content: '', failed: true }
    return { content: newDocContentFromTemplate(rawText, fullVars, 'crlf'), failed: false }
  }

  // 새 문서 본문 만들기 — createNewDoc·openWikiLinkTarget 공용 (F-2037.md 4.2·4.3)
  function buildNewDocContent(vars: TemplateContentVars) {
    return buildContentFromTemplate(getPref('md.newDocTemplate', NEW_DOC_TEMPLATE_NONE), vars)
  }

  return { templateEntries, readTemplateDocText, buildNewDocContent, buildContentFromTemplate }
}
