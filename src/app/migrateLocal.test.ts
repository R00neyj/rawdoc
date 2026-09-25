import { describe, it, expect, vi } from 'vitest'
import {
  checkLocalE2eeMigration,
  migrateLocalIfNeeded,
  runLocalE2eeMigration,
  type LocalE2eeCheckDeps,
  type LocalE2eeRunDeps,
  type LocalSnapshot,
} from './migrateLocal'
import type { Attachment, Doc, Folder } from '../types'
import { GUIDE_DOC_TITLE, GUIDE_DOC_CONTENT_CRLF } from './guideDoc'
import type { LocalE2eeKeys } from '../e2ee/convert'
import { createDocKey, createKeyBundle, decryptDocField, encryptAttachment, encryptDocField, openDocKey, openWithPassword } from '../e2ee/crypto'

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return { id: 'f1', name: '폴더', parentId: null, createdAt: 1, updatedAt: 1, ...overrides }
}

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'd1',
    title: '제목',
    content: '내용',
    lineEnding: 'crlf',
    createdAt: 1,
    updatedAt: 2,
    folderId: null,
    pinnedAt: null,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<Parameters<typeof migrateLocalIfNeeded>[0]> = {}) {
  const prefs = new Map<string, string>()
  const calls: string[] = []
  const notice = vi.fn((n) => calls.push(`notice:${n.type}`))
  const importLocal = vi.fn(async (input: LocalSnapshot) => {
    calls.push('importLocal')
    return { importedCount: input.docs.length }
  })
  const afterImport = vi.fn(async () => {
    calls.push('afterImport')
  })
  return {
    calls,
    prefs,
    notice,
    importLocal,
    afterImport,
    deps: {
      userId: 'u1',
      getPref: (key: string, fallback: string) => prefs.get(key) ?? fallback,
      setPref: (key: string, value: string) => {
        calls.push('setPref')
        prefs.set(key, value)
      },
      readLocal: vi.fn(async (): Promise<LocalSnapshot> => ({ folders: [], docs: [] })),
      importLocal,
      notice,
      afterImport,
      ...overrides,
    },
  }
}

describe('migrateLocalIfNeeded', () => {
  it('빈 로컬이면 옮길 것 없이 기록만 한다', async () => {
    const { deps, prefs, importLocal, notice } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(prefs.get('md.localMigrated')).toBe('u1')
    expect(importLocal).not.toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
  })

  it('이미 옮겼으면(같은 사용자) 아무것도 읽지 않는다', async () => {
    const readLocal = vi.fn(async () => ({ folders: [], docs: [makeDoc()] }))
    const { deps, importLocal } = makeDeps({ readLocal })
    deps.getPref = () => 'u1'
    await migrateLocalIfNeeded(deps)
    expect(readLocal).not.toHaveBeenCalled()
    expect(importLocal).not.toHaveBeenCalled()
  })

  it('다른 계정으로 로그인하면 다시 옮긴다', async () => {
    const { deps, prefs, importLocal } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [makeDoc()] })),
    })
    prefs.set('md.localMigrated', 'other-user')
    await migrateLocalIfNeeded(deps)
    expect(importLocal).toHaveBeenCalledTimes(1)
    expect(prefs.get('md.localMigrated')).toBe('u1')
  })

  it('폴더 2단계·고정 문서를 id 그대로 넘긴다', async () => {
    const parent = makeFolder({ id: 'p', name: '상위', parentId: null })
    const child = makeFolder({ id: 'c', name: '하위', parentId: 'p' })
    const pinnedDoc = makeDoc({ id: 'd-pinned', folderId: 'c', pinnedAt: 999 })
    const { deps, importLocal } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [child, parent], docs: [pinnedDoc] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(importLocal).toHaveBeenCalledWith({ folders: [child, parent], docs: [pinnedDoc] })
    const [{ folders, docs }] = importLocal.mock.calls[0]
    expect(folders.map((f: Folder) => f.id)).toEqual(['c', 'p']) // 순서는 이 함수가 바꾸지 않는다(부모 먼저 정렬은 serverStore.importLocal 책임)
    expect(docs[0].id).toBe('d-pinned')
    expect(docs[0].pinnedAt).toBe(999)
  })

  it('손대지 않은 사용법 문서는 옮기지 않고, 고친 사용법 문서는 옮긴다', async () => {
    const untouched = makeDoc({ id: 'g1', title: GUIDE_DOC_TITLE, content: GUIDE_DOC_CONTENT_CRLF })
    const edited = makeDoc({ id: 'g2', title: GUIDE_DOC_TITLE, content: `${GUIDE_DOC_CONTENT_CRLF}메모` })
    const { deps, importLocal } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [untouched, edited, makeDoc()] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(importLocal.mock.calls[0][0].docs.map((d: Doc) => d.id)).toEqual(['g2', 'd1'])
  })

  it('손대지 않은 사용법 문서만 있으면 옮길 것 없이 기록만 한다', async () => {
    const { deps, prefs, importLocal, notice } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [makeDoc({ title: GUIDE_DOC_TITLE, content: GUIDE_DOC_CONTENT_CRLF })] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(prefs.get('md.localMigrated')).toBe('u1')
    expect(importLocal).not.toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
  })

  it('캐시 쓰기 실패면 기록하지 않고 오류 알림', async () => {
    const { deps, prefs, notice } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [makeDoc()] })),
      importLocal: vi.fn(async () => {
        throw new Error('idb 실패')
      }),
    })
    await migrateLocalIfNeeded(deps)
    expect(prefs.get('md.localMigrated')).toBeUndefined()
    expect(notice).toHaveBeenCalledWith({ type: 'error', message: '로컬 문서를 옮기지 못했습니다. 다시 시도하려면 새로고침하세요.' })
  })

  it('성공 순서: 진행 알림 → importLocal → 기록 → 새로고침 → 완료 알림', async () => {
    const { deps, calls } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [makeDoc(), makeDoc({ id: 'd2' })] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(calls).toEqual(['notice:info', 'importLocal', 'setPref', 'afterImport', 'notice:info'])
  })
})

// ---- F-408 로그인 금고 이관 ----

function makeCheckDeps(overrides: Partial<LocalE2eeCheckDeps> = {}): LocalE2eeCheckDeps {
  return {
    userId: 'u1',
    localDbExists: vi.fn(async () => true),
    readLocalRow: vi.fn(async () => null),
    readLocal: vi.fn(async () => ({ folders: [], docs: [] })),
    accountIds: () => ({ docIds: new Set(), folderIds: new Set() }),
    markMigrated: vi.fn(async () => true),
    ...overrides,
  }
}

function vaultDoc(id: string): Doc {
  return { id, title: 't', content: 'c', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null, e2eeKey: 'k' }
}

async function genMk(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey'])
}

async function makeVaultDoc(id: string, mk: CryptoKey, opts: { folderId?: string | null; refs?: string[] } = {}): Promise<Doc> {
  const { wrappedDocKey, docKey } = await createDocKey(mk)
  const title = await encryptDocField(docKey, id, 'title', `제목-${id}`)
  const content = await encryptDocField(docKey, id, 'content', `본문-${id}`)
  return {
    id,
    title,
    content,
    lineEnding: 'lf',
    createdAt: 1,
    updatedAt: 1,
    folderId: opts.folderId ?? null,
    pinnedAt: null,
    e2eeKey: wrappedDocKey,
    attachmentRefs: opts.refs ?? [],
  }
}

async function makeVaultAttachment(id: string, mk: CryptoKey): Promise<Attachment> {
  const plain = new TextEncoder().encode('img')
  const envelope = await encryptAttachment(mk, id, plain)
  return {
    id,
    mime: 'application/octet-stream',
    ext: 'png',
    size: envelope.length,
    width: 1,
    height: 1,
    createdAt: 1,
    e2ee: true,
    blob: new Blob([envelope as BlobPart]),
  }
}

function plainAttachment(id: string, bytes: Uint8Array, width = 2, height = 2): Attachment {
  return { id, mime: 'image/png', ext: 'png', size: bytes.length, width, height, createdAt: 1, blob: new Blob([bytes as BlobPart]) }
}

type FakeImportInput = { folders?: Folder[]; docs?: Doc[]; attachments?: Attachment[] }

function makeFakeImportLocalE2ee(options: { failOnce?: (input: FakeImportInput) => boolean } = {}) {
  const calls: FakeImportInput[] = []
  const seen = { folders: new Set<string>(), attachments: new Set<string>(), docs: new Set<string>() }
  const written = { folders: new Map<string, Folder>(), attachments: new Map<string, Attachment>(), docs: new Map<string, Doc>() }
  let failed = false
  const fn = vi.fn(async (input: FakeImportInput) => {
    if (!failed && options.failOnce?.(input)) {
      failed = true
      throw new Error('가짜 쓰기 실패')
    }
    calls.push(input)
    let foldersN = 0
    let docsN = 0
    let attachmentsN = 0
    for (const f of input.folders ?? []) {
      if (!seen.folders.has(f.id)) {
        seen.folders.add(f.id)
        written.folders.set(f.id, f)
        foldersN++
      }
    }
    for (const a of input.attachments ?? []) {
      if (!seen.attachments.has(a.id)) {
        seen.attachments.add(a.id)
        written.attachments.set(a.id, a)
        attachmentsN++
      }
    }
    for (const d of input.docs ?? []) {
      if (!seen.docs.has(d.id)) {
        seen.docs.add(d.id)
        written.docs.set(d.id, d)
        docsN++
      }
    }
    return { folders: foldersN, docs: docsN, attachments: attachmentsN }
  })
  return { fn, calls, written }
}

describe('F-408 M1~M2 checkLocalE2eeMigration', () => {
  it('M1: 1~3번은 skip 이고 readLocal 을 부르지 않는다', async () => {
    const d1 = makeCheckDeps({ localDbExists: vi.fn(async () => false) })
    expect(await checkLocalE2eeMigration(d1)).toEqual({ kind: 'skip' })
    expect(d1.readLocal).not.toHaveBeenCalled()

    const d2 = makeCheckDeps({ readLocalRow: vi.fn(async () => null) })
    expect(await checkLocalE2eeMigration(d2)).toEqual({ kind: 'skip' })
    expect(d2.readLocal).not.toHaveBeenCalled()

    const d3 = makeCheckDeps({ readLocalRow: vi.fn(async () => ({ bundle: 'b1', migratedTo: ['u1'] })) })
    expect(await checkLocalE2eeMigration(d3)).toEqual({ kind: 'skip' })
    expect(d3.readLocal).not.toHaveBeenCalled()
  })

  it('M2: 5·6번 — 계정에 모두 있음 → skip + markMigrated. 없음 → ask', async () => {
    const a1 = vaultDoc('a1')
    const r1 = vaultDoc('r1')
    const allSame = makeCheckDeps({
      readLocalRow: vi.fn(async () => ({ bundle: 'b1' })),
      readLocal: vi.fn(async () => ({ folders: [], docs: [a1, r1] })),
      accountIds: () => ({ docIds: new Set(['a1', 'r1']), folderIds: new Set() }),
    })
    expect(await checkLocalE2eeMigration(allSame)).toEqual({ kind: 'skip' })
    expect(allSame.markMigrated).toHaveBeenCalledWith('b1')

    const none = makeCheckDeps({
      readLocalRow: vi.fn(async () => ({ bundle: 'b1' })),
      readLocal: vi.fn(async () => ({ folders: [], docs: [a1, r1] })),
      accountIds: () => ({ docIds: new Set(), folderIds: new Set() }),
    })
    expect(await checkLocalE2eeMigration(none)).toEqual({ kind: 'ask', count: 2, bundle: 'b1' })
  })
})

describe('F-408 M3~M8 runLocalE2eeMigration', () => {
  it('M3: adopt 흐름 — 금고 폴더 1·문서 2(하나에 금고 첨부 1)', async () => {
    const mk = await genMk()
    const folder: Folder = { id: 'F', name: 'F', parentId: null, createdAt: 1, updatedAt: 1, e2ee: true }
    const AA = '00000000000000aa'
    const att = await makeVaultAttachment(AA, mk)
    const d1 = await makeVaultDoc('d1', mk, { refs: [AA] })
    const d2 = await makeVaultDoc('d2', mk)
    const shared = makeFakeImportLocalE2ee()
    const progress: Array<[number, number]> = []
    const keys: LocalE2eeKeys = { mode: 'adopt', localKey: mk, accountKey: mk }
    const deps: LocalE2eeRunDeps = {
      ...makeCheckDeps({ readLocal: vi.fn(async () => ({ folders: [folder], docs: [d1, d2] })) }),
      bundle: 'b1',
      keys,
      getLocalAttachment: vi.fn(async (id: string) => (id === AA ? att : null)),
      importLocalE2ee: shared.fn,
      keyAlive: () => true,
      noteActivity: vi.fn(),
      onProgress: (done, total) => progress.push([done, total]),
    }
    const outcome = await runLocalE2eeMigration(deps)
    expect(outcome).toEqual({ kind: 'done', count: 2, skippedImages: 0 })
    expect(
      shared.calls.map((c) => ({
        ...(c.folders ? { folders: c.folders.length } : {}),
        ...(c.attachments ? { attachments: c.attachments.map((a) => a.id) } : {}),
        ...(c.docs ? { docs: c.docs.map((d) => d.id) } : {}),
      })),
    ).toEqual([{ folders: 1 }, { attachments: [AA] }, { docs: ['d1'] }, { docs: ['d2'] }])
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
    expect(deps.markMigrated).toHaveBeenCalledTimes(1)
    expect(deps.markMigrated).toHaveBeenCalledWith('b1')
  })

  it('M4: 실제 로컬 묶음(1,000회)으로 연 로컬 MK 로 rewrap', async () => {
    const { bundle } = await createKeyBundle('로컬금고암호12345', { iterations: 1000 })
    const { masterKey: openedLocalMk } = await openWithPassword(bundle, '로컬금고암호12345')
    const accountMk = await genMk()
    const d1 = await makeVaultDoc('d1', openedLocalMk)
    const shared = makeFakeImportLocalE2ee()
    const keys: LocalE2eeKeys = { mode: 'rewrap', localKey: openedLocalMk, accountKey: accountMk }
    const deps: LocalE2eeRunDeps = {
      ...makeCheckDeps({ readLocal: vi.fn(async () => ({ folders: [], docs: [d1] })) }),
      bundle: 'b1',
      keys,
      getLocalAttachment: vi.fn(async () => null),
      importLocalE2ee: shared.fn,
      keyAlive: () => true,
      noteActivity: vi.fn(),
      onProgress: vi.fn(),
    }
    const outcome = await runLocalE2eeMigration(deps)
    expect(outcome).toEqual({ kind: 'done', count: 1, skippedImages: 0 })
    const writtenDoc = shared.written.docs.get('d1')!
    const accountDocKey = await openDocKey(accountMk, writtenDoc.e2eeKey as string)
    expect(await decryptDocField(accountDocKey, 'd1', 'content', writtenDoc.content)).toBe('본문-d1')
  })

  it('M5: 이어가기 — 실패한 자리에서 멈추고, 다음 실행은 이미 있는 문서를 건너뛴다', async () => {
    const mk = await genMk()
    const AA = '00000000000000aa'
    const att = await makeVaultAttachment(AA, mk)
    const d1 = await makeVaultDoc('d1', mk, { refs: [AA] })
    const d2 = await makeVaultDoc('d2', mk)
    const shared = makeFakeImportLocalE2ee({ failOnce: (input) => Boolean(input.docs?.some((d) => d.id === 'd2')) })
    const keys: LocalE2eeKeys = { mode: 'adopt', localKey: mk, accountKey: mk }
    const baseDeps: LocalE2eeRunDeps = {
      ...makeCheckDeps({
        readLocal: vi.fn(async () => ({ folders: [], docs: [d1, d2] })),
        accountIds: () => ({ docIds: new Set(shared.written.docs.keys()), folderIds: new Set(shared.written.folders.keys()) }),
      }),
      bundle: 'b1',
      keys,
      getLocalAttachment: vi.fn(async (id: string) => (id === AA ? att : null)),
      importLocalE2ee: shared.fn,
      keyAlive: () => true,
      noteActivity: vi.fn(),
      onProgress: vi.fn(),
    }

    const first = await runLocalE2eeMigration(baseDeps)
    expect(first).toEqual({ kind: 'stopped', reason: 'failed', done: 1, total: 2 })
    expect(baseDeps.markMigrated).not.toHaveBeenCalled()
    expect(shared.written.docs.has('d1')).toBe(true)
    expect(shared.written.attachments.has(AA)).toBe(true)
    expect(shared.written.docs.has('d2')).toBe(false)

    const second = await runLocalE2eeMigration(baseDeps)
    expect(second).toEqual({ kind: 'done', count: 1, skippedImages: 0 })
    expect(baseDeps.markMigrated).toHaveBeenCalledTimes(1)
    expect(shared.written.docs.size).toBe(2)
  })

  it('M6: keyAlive 가 거짓이면 그 자리에서 멈춘다', async () => {
    const mk = await genMk()
    const d1 = await makeVaultDoc('d1', mk)
    const d2 = await makeVaultDoc('d2', mk)
    const shared = makeFakeImportLocalE2ee()
    let calls = 0
    const keys: LocalE2eeKeys = { mode: 'adopt', localKey: mk, accountKey: mk }
    const deps: LocalE2eeRunDeps = {
      ...makeCheckDeps({ readLocal: vi.fn(async () => ({ folders: [], docs: [d1, d2] })) }),
      bundle: 'b1',
      keys,
      getLocalAttachment: vi.fn(async () => null),
      importLocalE2ee: shared.fn,
      keyAlive: () => {
        calls++
        return calls === 1
      },
      noteActivity: vi.fn(),
      onProgress: vi.fn(),
    }
    const outcome = await runLocalE2eeMigration(deps)
    expect(outcome).toEqual({ kind: 'stopped', reason: 'locked', done: 1, total: 2 })
    expect(shared.written.docs.has('d2')).toBe(false)
  })

  it('M7: 섞인 평문 첨부 — 같은 것은 한 번만 암호화, 너무 큰 것은 줄을 바꾸지 않고 건너뛴다', async () => {
    const mk = await genMk()
    const AA = '00000000000000aa'
    const BB = '00000000000000bb'
    const attSmall = plainAttachment(AA, new TextEncoder().encode('img'))
    const attBig = plainAttachment(BB, new Uint8Array(5_242_812))

    const { docKey: k1, wrappedDocKey: w1 } = await createDocKey(mk)
    const content1 = `이미지1 ![](attachments/${AA}.png)`
    const d1: Doc = {
      id: 'd1',
      title: await encryptDocField(k1, 'd1', 'title', 't1'),
      content: await encryptDocField(k1, 'd1', 'content', content1),
      lineEnding: 'lf',
      createdAt: 1,
      updatedAt: 1,
      folderId: null,
      pinnedAt: null,
      e2eeKey: w1,
      attachmentRefs: [AA],
    }
    const { docKey: k2, wrappedDocKey: w2 } = await createDocKey(mk)
    const content2 = `이미지2 ![](attachments/${AA}.png)`
    const d2: Doc = {
      id: 'd2',
      title: await encryptDocField(k2, 'd2', 'title', 't2'),
      content: await encryptDocField(k2, 'd2', 'content', content2),
      lineEnding: 'lf',
      createdAt: 1,
      updatedAt: 1,
      folderId: null,
      pinnedAt: null,
      e2eeKey: w2,
      attachmentRefs: [AA],
    }
    const { docKey: k3, wrappedDocKey: w3 } = await createDocKey(mk)
    const content3 = `큰 이미지 ![](attachments/${BB}.png)`
    const d3: Doc = {
      id: 'd3',
      title: await encryptDocField(k3, 'd3', 'title', 't3'),
      content: await encryptDocField(k3, 'd3', 'content', content3),
      lineEnding: 'lf',
      createdAt: 1,
      updatedAt: 1,
      folderId: null,
      pinnedAt: null,
      e2eeKey: w3,
      attachmentRefs: [BB],
    }

    const shared = makeFakeImportLocalE2ee()
    const keys: LocalE2eeKeys = { mode: 'adopt', localKey: mk, accountKey: mk }
    const deps: LocalE2eeRunDeps = {
      ...makeCheckDeps({ readLocal: vi.fn(async () => ({ folders: [], docs: [d1, d2, d3] })) }),
      bundle: 'b1',
      keys,
      getLocalAttachment: vi.fn(async (id: string) => (id === AA ? attSmall : id === BB ? attBig : null)),
      importLocalE2ee: shared.fn,
      keyAlive: () => true,
      noteActivity: vi.fn(),
      onProgress: vi.fn(),
    }
    const outcome = await runLocalE2eeMigration(deps)
    expect(outcome).toEqual({ kind: 'done', count: 3, skippedImages: 1 })

    const encryptedAttachments = [...shared.written.attachments.values()].filter((a) => a.e2ee === true)
    expect(encryptedAttachments).toHaveLength(1)
    const newId = encryptedAttachments[0].id

    const writtenD1 = shared.written.docs.get('d1')!
    const writtenD2 = shared.written.docs.get('d2')!
    const dk1 = await openDocKey(mk, writtenD1.e2eeKey as string)
    const dk2 = await openDocKey(mk, writtenD2.e2eeKey as string)
    expect(await decryptDocField(dk1, 'd1', 'content', writtenD1.content)).toContain(`attachments/${newId}.png`)
    expect(await decryptDocField(dk2, 'd2', 'content', writtenD2.content)).toContain(`attachments/${newId}.png`)

    const writtenD3 = shared.written.docs.get('d3')!
    const dk3 = await openDocKey(mk, writtenD3.e2eeKey as string)
    expect(await decryptDocField(dk3, 'd3', 'content', writtenD3.content)).toBe(content3)
  })

  it('M8: 손상 문서는 건너뛰고 count 에 들지 않는다', async () => {
    const mk = await genMk()
    const accountMk = await genMk()
    const d1 = await makeVaultDoc('d1', mk)
    const broken: Doc = {
      id: 'broken',
      title: 'x',
      content: 'y',
      lineEnding: 'lf',
      createdAt: 1,
      updatedAt: 1,
      folderId: null,
      pinnedAt: null,
      e2eeKey: 'not-a-valid-wrapped-key',
      attachmentRefs: [],
    }
    const d2 = await makeVaultDoc('d2', mk)
    const shared = makeFakeImportLocalE2ee()
    const keys: LocalE2eeKeys = { mode: 'rewrap', localKey: mk, accountKey: accountMk }
    const deps: LocalE2eeRunDeps = {
      ...makeCheckDeps({ readLocal: vi.fn(async () => ({ folders: [], docs: [d1, broken, d2] })) }),
      bundle: 'b1',
      keys,
      getLocalAttachment: vi.fn(async () => null),
      importLocalE2ee: shared.fn,
      keyAlive: () => true,
      noteActivity: vi.fn(),
      onProgress: vi.fn(),
    }
    const outcome = await runLocalE2eeMigration(deps)
    expect(outcome).toEqual({ kind: 'done', count: 2, skippedImages: 0 })
    expect(shared.written.docs.has('broken')).toBe(false)
  })
})
