// F-2065 7.1 U1~U12 내보내기·인쇄 배선 팩토리
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createExportActions, type ExportActionsDeps } from '../../../src/app/exportActions'
import { exportDoc, exportDocAsText, exportDocAsHtml, copyDocAsRichText } from '../../../src/app/exportDoc'
import { downloadWorkspaceExport } from '../../../src/app/exportWorkspace'
import { downloadVaultExport } from '../../../src/app/exportVault'
import { printDoc } from '../../../src/app/printDoc'
import { renderMarkdown } from '../../../src/viewer/renderMarkdown'
import type { EditorHandle } from '../../../src/editor/Editor'
import type { E2eeStatus } from '../../../src/e2ee/keyring'
import type { Store } from '../../../src/types'
import type { DocMeta } from '../../../src/app/docMeta'

vi.mock('../../../src/app/exportDoc', () => ({
  exportDoc: vi.fn(async () => {}),
  exportDocAsText: vi.fn(async () => {}),
  exportDocAsHtml: vi.fn(async () => {}),
  copyDocAsRichText: vi.fn(async () => {}),
}))
vi.mock('../../../src/app/exportWorkspace', () => ({ downloadWorkspaceExport: vi.fn(async () => {}) }))
vi.mock('../../../src/app/exportVault', () => ({ downloadVaultExport: vi.fn(async () => {}) }))
vi.mock('../../../src/app/printDoc', () => ({ printDoc: vi.fn(async () => {}) }))
vi.mock('../../../src/viewer/renderMarkdown', () => ({ renderMarkdown: vi.fn(() => '<p>렌더</p>') }))

type AnyFn = (...args: never[]) => unknown
const argOf = (fn: AnyFn, call = 0) => vi.mocked(fn).mock.calls[call][0] as unknown as Record<string, unknown>
const flush = () => new Promise((r) => setTimeout(r, 0))

const docFns = [
  ['handleExportDoc', exportDoc],
  ['handleExportDocAsText', exportDocAsText],
  ['handleExportDocAsHtml', exportDocAsHtml],
  ['handleCopyDocAsRichText', copyDocAsRichText],
] as const

function makeDeps(over: Partial<ExportActionsDeps> = {}): ExportActionsDeps {
  const handle = { getText: vi.fn(() => '# a') } as unknown as EditorHandle
  return {
    store: { kind: 'server', getAttachment: vi.fn(async () => null) } as unknown as Store,
    syncState: { pending: 0, online: true, signedOut: false },
    currentDoc: { id: 'd1', title: '문서' } as DocMeta,
    openDoc: { id: 'd1', content: '# a', lineEnding: 'crlf' },
    currentDocId: 'd1',
    editorRef: { current: handle },
    docSaverFlushRef: { current: vi.fn(async () => true) },
    printRootRef: { current: null },
    foldersRef: { current: [] },
    e2eeRef: { current: null },
    showNotice: vi.fn(() => 1),
    resolveWikiHref: vi.fn(() => null),
    resolveAttachment: vi.fn(async () => null),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('한 문서 내보내기 (U1~U5)', () => {
  const guards: [string, Partial<ExportActionsDeps>][] = [
    ['currentDoc 없음', { currentDoc: null }],
    ['openDoc 없음', { openDoc: null }],
    ['openDoc.id ≠ currentDocId', { openDoc: { id: 'other', content: '', lineEnding: 'lf' } }],
  ]

  it.each(guards)('U1 %s — 네 함수 모두 호출 0회', (_, over) => {
    const actions = createExportActions(makeDeps(over))
    for (const [name, fn] of docFns) {
      actions[name]()
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('U2 맞는 문서 — 각 1회, handle·doc·lineEnding·onNotice', () => {
    const deps = makeDeps()
    const actions = createExportActions(deps)
    for (const [name, fn] of docFns) {
      actions[name]()
      expect(fn).toHaveBeenCalledTimes(1)
      const arg = argOf(fn)
      expect(arg.handle).toBe(deps.editorRef.current)
      expect(arg.doc).toBe(deps.currentDoc)
      expect(arg.lineEnding).toBe('crlf')
      if (fn === exportDocAsText) {
        expect(arg).not.toHaveProperty('store')
        expect(arg).not.toHaveProperty('onNotice')
      } else {
        expect(arg.onNotice).toBe(deps.showNotice)
      }
    }
  })

  it('U2 handle 은 호출 시점의 editorRef.current', () => {
    const deps = makeDeps({ editorRef: { current: null } })
    const actions = createExportActions(deps)
    const later = { getText: () => '' } as unknown as EditorHandle
    deps.editorRef.current = later
    actions.handleExportDoc()
    expect(argOf(exportDoc).handle).toBe(later)
  })

  it('U3 saver.flush 는 호출 때 docSaverFlushRef.current 를 읽는다', async () => {
    const deps = makeDeps()
    const actions = createExportActions(deps)
    const next = vi.fn(async () => true)
    deps.docSaverFlushRef.current = next
    for (const [name, fn] of docFns) {
      actions[name]()
      const saver = argOf(fn).saver as { flush(): unknown }
      await saver.flush()
    }
    expect(next).toHaveBeenCalledTimes(4)
  })

  const vaultRecord = { id: 'a1', ext: 'webp', e2ee: { v: 1 } }
  it.each([
    [undefined, null],
    ['locked', null],
    ['open', vaultRecord],
  ] as const)('U4 금고 첨부 + 문서 e2ee=%s → %o', async (e2ee, expected) => {
    const store = { kind: 'idb', getAttachment: vi.fn(async () => vaultRecord) } as unknown as Store
    const deps = makeDeps({ store, currentDoc: { id: 'd1', title: '문서', e2ee } as DocMeta })
    createExportActions(deps).handleExportDoc()
    const scoped = argOf(exportDoc).store as { getAttachment(id: string): Promise<unknown> }
    expect(await scoped.getAttachment('a1')).toBe(expected)
  })

  const plainRecord = { id: 'a2', ext: 'webp' }
  it.each([
    ['금고 아닌 레코드', plainRecord, plainRecord],
    ['레코드 없음', null, null],
  ] as const)('U5 %s — 금고 여부와 무관', async (_, record, expected) => {
    for (const e2ee of [undefined, 'locked', 'open'] as const) {
      vi.clearAllMocks()
      const store = { kind: 'idb', getAttachment: vi.fn(async () => record) } as unknown as Store
      createExportActions(makeDeps({ store, currentDoc: { id: 'd1', title: '문서', e2ee } as DocMeta })).handleExportDoc()
      const scoped = argOf(exportDoc).store as { getAttachment(id: string): Promise<unknown> }
      expect(await scoped.getAttachment('a2')).toBe(expected)
    }
  })
})

describe('인쇄 (U6·U7)', () => {
  it.each([
    ['currentDoc 없음', { currentDoc: null }],
    ['openDoc 없음', { openDoc: null }],
    ['openDoc.id ≠ currentDocId', { openDoc: { id: 'other', content: '', lineEnding: 'lf' as const } }],
    ['editorRef.current 없음', { editorRef: { current: null } }],
  ] as [string, Partial<ExportActionsDeps>][])('U6 %s — 아무것도 안 부른다', (_, over) => {
    const deps = makeDeps(over)
    createExportActions(deps).handlePrintDoc()
    expect(printDoc).not.toHaveBeenCalled()
    expect(renderMarkdown).not.toHaveBeenCalled()
    expect(deps.docSaverFlushRef.current).not.toHaveBeenCalled()
  })

  it('U7 flush 1회, lf 원문 렌더, printDoc 인자', () => {
    const root = {} as HTMLDivElement
    const deps = makeDeps({ printRootRef: { current: root } })
    createExportActions(deps).handlePrintDoc()
    expect(deps.docSaverFlushRef.current).toHaveBeenCalledTimes(1)
    expect(deps.editorRef.current!.getText).toHaveBeenCalledWith('lf')
    expect(renderMarkdown).toHaveBeenCalledWith('# a', { resolveWikiLink: deps.resolveWikiHref })
    expect(printDoc).toHaveBeenCalledWith({
      root,
      html: '<p>렌더</p>',
      title: '문서',
      resolveAttachment: deps.resolveAttachment,
    })
  })
})

describe('exportOffline (U8)', () => {
  it.each([
    ['server', { pending: 0, online: false, signedOut: false }, true],
    ['server', { pending: 0, online: true, signedOut: false }, false],
    ['server', undefined, false],
    ['idb', { pending: 0, online: false, signedOut: false }, false],
  ] as const)('store %s + syncState %o → %s', (kind, syncState, expected) => {
    const store = { kind, getAttachment: vi.fn() } as unknown as Store
    expect(createExportActions(makeDeps({ store, syncState })).exportOffline).toBe(expected)
  })
})

describe('전체·볼트 내보내기 (U9)', () => {
  it.each([
    ['handleExportAll', downloadWorkspaceExport],
    ['handleExportVault', downloadVaultExport],
  ] as const)('U9 %s — flush 끝난 뒤 내려받기, 인자, 진행 알림', async (name, fn) => {
    const order: string[] = []
    let release!: () => void
    const deps = makeDeps({
      docSaverFlushRef: {
        current: vi.fn(async () => {
          order.push('flush 시작')
          await new Promise<void>((r) => (release = r))
          order.push('flush 끝')
          return true
        }),
      },
    })
    vi.mocked(fn).mockImplementationOnce(async () => {
      order.push('내려받기')
    })
    const done = createExportActions(deps)[name]()
    await flush()
    expect(fn).not.toHaveBeenCalled()
    release()
    await done
    expect(order).toEqual(['flush 시작', 'flush 끝', '내려받기'])
    expect(fn).toHaveBeenCalledTimes(1)
    const arg = argOf(fn)
    expect(arg.scope).toEqual({ kind: 'all' })
    expect(arg.store).toBe(deps.store)
    expect(arg.onNotice).toBe(deps.showNotice)
    ;(arg.onProgress as (p: { done: number; total: number }) => void)({ done: 2, total: 5 })
    expect(deps.showNotice).toHaveBeenCalledWith({ type: 'info', message: '내보내는 중… 2/5' })
  })
})

describe('폴더 내보내기 (U10~U12)', () => {
  const folderFns = [
    ['handleExportFolder', downloadWorkspaceExport],
    ['handleExportFolderVault', downloadVaultExport],
  ] as const

  it.each(folderFns)('U10 %s 오프라인 — error 알림만', async (name, fn) => {
    const store = { kind: 'server', getAttachment: vi.fn() } as unknown as Store
    const deps = makeDeps({ store, syncState: { pending: 0, online: false, signedOut: false } })
    createExportActions(deps)[name]('f1')
    await flush()
    expect(deps.showNotice).toHaveBeenCalledTimes(1)
    expect(deps.showNotice).toHaveBeenCalledWith({ type: 'error', message: '온라인일 때 내보낼 수 있습니다.' })
    expect(deps.docSaverFlushRef.current).not.toHaveBeenCalled()
    expect(fn).not.toHaveBeenCalled()
  })

  it.each(folderFns)('U11 %s 온라인·금고 아닌 폴더 — 열기 요청 없이 flush 뒤 내려받기', async (name, fn) => {
    const order: string[] = []
    const requestOpen = vi.fn(async () => true)
    const deps = makeDeps({
      foldersRef: { current: [{ id: 'f1' }] },
      e2eeRef: { current: { keyring: { getStatus: () => 'locked' }, requestOpen } },
      docSaverFlushRef: {
        current: vi.fn(async () => {
          order.push('flush')
          return true
        }),
      },
    })
    vi.mocked(fn).mockImplementationOnce(async () => {
      order.push('내려받기')
    })
    createExportActions(deps)[name]('f1')
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['flush', '내려받기'])
    expect(requestOpen).not.toHaveBeenCalled()
    expect(argOf(fn).scope).toEqual({ kind: 'folder', folderId: 'f1' })
  })

  type Case = {
    label: string
    ring: 'none' | E2eeStatus
    opens?: boolean
    after?: E2eeStatus
    downloads: boolean
    asks: boolean
  }
  const cases: Case[] = [
    { label: '(a) 금고 훅 없음', ring: 'none', downloads: true, asks: false },
    { label: '(b) 이미 open', ring: 'open', downloads: true, asks: false },
    { label: '(c) locked → 열림', ring: 'locked', opens: true, after: 'open', downloads: true, asks: true },
    { label: '(d) locked → 닫음, 그대로 locked', ring: 'locked', opens: false, after: 'locked', downloads: false, asks: true },
    { label: '(e) 닫음, 그 뒤 unavailable', ring: 'locked', opens: false, after: 'unavailable', downloads: true, asks: true },
  ]

  for (const [name, fn] of folderFns) {
    it.each(cases)(`U12 ${name} 금고 폴더 $label`, async ({ ring, opens, after, downloads, asks }) => {
      let status: E2eeStatus = ring === 'none' ? 'none' : ring
      const requestOpen = vi.fn(async () => {
        if (after) status = after
        return opens ?? false
      })
      const deps = makeDeps({
        foldersRef: { current: [] },
        e2eeRef: { current: ring === 'none' ? null : { keyring: { getStatus: () => status }, requestOpen } },
      })
      const actions = createExportActions(deps)
      deps.foldersRef.current = [{ id: 'vault', e2ee: true }]
      actions[name]('vault')
      await flush()
      await flush()
      expect(fn).toHaveBeenCalledTimes(downloads ? 1 : 0)
      expect(deps.docSaverFlushRef.current).toHaveBeenCalledTimes(downloads ? 1 : 0)
      expect(requestOpen).toHaveBeenCalledTimes(asks ? 1 : 0)
    })
  }
})
