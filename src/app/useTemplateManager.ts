// 템플릿 관리 대화상자 열기·새 템플릿·편집·삭제 (small 2026-10-10)
import { useState, type Dispatch, type SetStateAction } from 'react'
import { templateRootFolder } from '../lib/templates'
import type { CreateDocInput } from './useDocNavigation'
import type { NoticeWithAction } from './NoticeBar'
import type { Folder, Store } from '../types'

export type UseTemplateManagerOptions = {
  store: Store
  folders: Folder[]
  setFolders: Dispatch<SetStateAction<Folder[]>>
  createDoc: (input: CreateDocInput) => Promise<boolean>
  selectDoc: (id: string) => Promise<void>
  requestDeleteDoc: (doc: { id: string; title: string }) => void
  closeSettings: () => void
  showNotice: (input: NoticeWithAction) => number
}

export type UseTemplateManagerResult = {
  templatesOpen: boolean
  openTemplates: () => void
  closeTemplates: () => void
  createTemplate: () => Promise<void>
  editTemplate: (docId: string) => Promise<void>
  deleteTemplate: (docId: string, title: string) => void
}

export function useTemplateManager(options: UseTemplateManagerOptions): UseTemplateManagerResult {
  const { store, folders, setFolders, createDoc, selectDoc, requestDeleteDoc, closeSettings, showNotice } = options
  const [templatesOpen, setTemplatesOpen] = useState(false)

  // 편집기로 가는 길이라 설정(이 창을 연 곳일 수 있다)도 함께 닫는다
  function leaveDialogs() {
    setTemplatesOpen(false)
    closeSettings()
  }

  // 최상위 템플릿 폴더가 없으면 '템플릿' 을 만들고, 빈 문서를 만들어 제목부터 쓰게 한다
  async function createTemplate() {
    let root = templateRootFolder(folders)
    if (!root) {
      try {
        root = await store.createFolder({ name: '템플릿', parentId: null })
      } catch {
        showNotice({ type: 'error', message: '템플릿 폴더를 만들지 못했습니다. 다시 시도하세요.' })
        return
      }
      const created = root
      setFolders((prev) => [...prev, created])
    }
    leaveDialogs()
    await createDoc({ folderId: root.id, title: '제목 없는 템플릿', focus: 'title', content: async () => ({ content: '', failed: false }) })
  }

  async function editTemplate(docId: string) {
    leaveDialogs()
    await selectDoc(docId)
  }

  return {
    templatesOpen,
    openTemplates: () => setTemplatesOpen(true),
    closeTemplates: () => setTemplatesOpen(false),
    createTemplate,
    editTemplate,
    deleteTemplate: (docId, title) => requestDeleteDoc({ id: docId, title }),
  }
}
