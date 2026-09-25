// F-405 U1~U12 (specs/features/F-405.md 9.1) — 아래 저장소는 createIdbStore, MK 는 PBKDF2 없이 바로 만든다
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { createIdbStore } from '../storage/idbStore'
import { decryptDocField, E2eeError, openDocKey } from './crypto'
import { attachmentRefsOf, isE2eeStoreError, lockDocMetas, makeE2eeConflictCopy, planE2eeReset, withE2ee } from './e2eeStore'
import type { Doc, Store } from '../types'

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

let dbCounter = 0
function freshDbName() {
  dbCounter += 1
  return `test-e2ee-store-${Date.now()}-${dbCounter}`
}

function newMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']) as Promise<CryptoKey>
}

async function readRow(dbName: string, storeName: 'docs' | 'folders', id: string): Promise<Record<string, unknown> | undefined> {
  const db = await openDB(dbName)
  try {
    return (await db.get(storeName, id)) as Record<string, unknown> | undefined
  } finally {
    db.close()
  }
}

async function putRow(dbName: string, storeName: 'docs' | 'folders', row: Record<string, unknown>) {
  const db = await openDB(dbName)
  try {
    await db.put(storeName, row)
  } finally {
    db.close()
  }
}

async function markFolderE2ee(dbName: string, id: string) {
  const row = await readRow(dbName, 'folders', id)
  await putRow(dbName, 'folders', { ...row, e2ee: true })
}

async function setup() {
  const dbName = freshDbName()
  const inner = await createIdbStore(dbName)
  let mk: CryptoKey | null = await newMasterKey()
  const store = withE2ee(inner, { getMasterKey: () => mk })
  const vaultFolder = await inner.createFolder({ name: '금고' })
  await markFolderE2ee(dbName, vaultFolder.id)
  return {
    dbName,
    inner,
    store,
    vaultFolderId: vaultFolder.id,
    getMk: () => mk,
    setMk: (next: CryptoKey | null) => {
      mk = next
    },
  }
}

async function expectStoreError(promise: Promise<unknown>, code: string) {
  let caught: unknown = null
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(isE2eeStoreError(caught, code as never)).toBe(true)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('U1 금고 폴더에 만들기', () => {
  it('앱에는 평문, 아래 저장소 행은 봉투·감싼 키 56자·빈 첨부 목록', async () => {
    const { dbName, store, vaultFolderId, getMk } = await setup()
    const created = await store.create({ title: '비밀 제목', content: '비밀 본문', lineEnding: 'lf', folderId: vaultFolderId })

    expect(created.e2ee).toBe('open')
    expect(created.title).toBe('비밀 제목')
    expect(created.content).toBe('비밀 본문')
    expect('e2eeKey' in created).toBe(false)

    const row = (await readRow(dbName, 'docs', created.id))!
    expect(row.title).toMatch(BASE64_RE)
    expect(row.content).toMatch(BASE64_RE)
    expect(String(row.title)).not.toContain('비밀')
    expect(String(row.content)).not.toContain('비밀')
    expect(String(row.e2eeKey)).toHaveLength(56)
    expect(row.attachmentRefs).toEqual([])

    const docKey = await openDocKey(getMk()!, String(row.e2eeKey))
    expect(await decryptDocField(docKey, created.id, 'title', String(row.title))).toBe('비밀 제목')
    expect(await decryptDocField(docKey, created.id, 'content', String(row.content))).toBe('비밀 본문')
  })
})

describe('U2 읽기', () => {
  it('MK 있음은 평문, 없음은 잠긴 모양. 일반 문서는 아래 저장소 값 그대로', async () => {
    const { inner, store, vaultFolderId, setMk, getMk } = await setup()
    const plain = await store.create({ title: '보통', content: '보통 본문', lineEnding: 'lf' })
    const vault = await store.create({ title: '비밀 제목', content: '![](attachments/00000000000000aa.png)', lineEnding: 'lf', folderId: vaultFolderId })

    const openList = await store.list()
    const openVault = openList.find((d) => d.id === vault.id)!
    expect(openVault).toMatchObject({ title: '비밀 제목', content: '![](attachments/00000000000000aa.png)', e2ee: 'open', attachmentRefs: ['00000000000000aa'] })
    expect('e2eeKey' in openVault).toBe(false)
    expect(openList.find((d) => d.id === plain.id)).toStrictEqual(await inner.get(plain.id))
    expect((await store.get(vault.id))?.e2ee).toBe('open')

    const mk = getMk()
    setMk(null)
    const lockedList = await store.list()
    const lockedVault = lockedList.find((d) => d.id === vault.id)!
    expect(lockedVault.title).toBe('')
    expect(lockedVault.content).toBe('')
    expect(lockedVault.e2ee).toBe('locked')
    expect(lockedVault.attachmentRefs).toEqual(['00000000000000aa'])
    expect('e2eeKey' in lockedVault).toBe(false)
    expect(lockedList.find((d) => d.id === plain.id)).toStrictEqual(await inner.get(plain.id))
    const lockedGet = await store.get(vault.id)
    expect(lockedGet).toMatchObject({ title: '', content: '', e2ee: 'locked' })
    setMk(mk)
  })
})

describe('U3 update 는 문서 키를 다시 쓴다', () => {
  it('e2eeKey 그대로, 본문 봉투는 매번 다르다. 봉투를 바꿔치기하면 잠긴 모양 + console.error 한 번', async () => {
    const { dbName, store, vaultFolderId } = await setup()
    const vault = await store.create({ title: '제목', content: '처음', lineEnding: 'lf', folderId: vaultFolderId })
    const row0 = (await readRow(dbName, 'docs', vault.id))!

    await store.update(vault.id, { content: '두 번째' })
    const row1 = (await readRow(dbName, 'docs', vault.id))!
    await store.update(vault.id, { content: '두 번째' })
    const row2 = (await readRow(dbName, 'docs', vault.id))!

    expect(row1.e2eeKey).toBe(row0.e2eeKey)
    expect(row2.e2eeKey).toBe(row0.e2eeKey)
    expect(row1.content).not.toBe(row0.content)
    expect(row2.content).not.toBe(row1.content)
    expect((await store.get(vault.id))?.content).toBe('두 번째')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await putRow(dbName, 'docs', { ...row2, content: row2.title })
    const broken = await store.get(vault.id)
    expect(broken).toMatchObject({ title: '', content: '', e2ee: 'locked' })
    await store.list()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('e2ee_decrypt_failed', vault.id)
  })
})

describe('U4 크기 경계 (평문 UTF-8 749,971 B)', () => {
  it('update — 749,971 통과, 749,972 는 too-large 이고 행이 그대로', async () => {
    const { dbName, store, vaultFolderId } = await setup()
    const vault = await store.create({ title: 'T', content: '', lineEnding: 'lf', folderId: vaultFolderId })

    await store.update(vault.id, { content: 'a'.repeat(749_971) })
    const before = (await readRow(dbName, 'docs', vault.id))!
    await expectStoreError(store.update(vault.id, { content: 'a'.repeat(749_972) }), 'too-large')
    expect((await readRow(dbName, 'docs', vault.id))!.content).toBe(before.content)

    await expectStoreError(store.update(vault.id, { content: `${'a'.repeat(749_969)}가` }), 'too-large')
    await store.update(vault.id, { content: `${'a'.repeat(749_968)}가` })
  })

  it('create 도 같다 — 넘으면 문서 수가 그대로', async () => {
    const { inner, store, vaultFolderId } = await setup()
    await store.create({ title: 'T', content: 'a'.repeat(749_971), lineEnding: 'lf', folderId: vaultFolderId })
    const count = (await inner.list()).length
    await expectStoreError(store.create({ title: 'T', content: 'a'.repeat(749_972), lineEnding: 'lf', folderId: vaultFolderId }), 'too-large')
    expect((await inner.list()).length).toBe(count)
  })
})

describe('U5 MK 없이 쓰기', () => {
  it('금고 문서 update·금고 폴더 create 는 locked, 일반은 된다', async () => {
    const { dbName, inner, store, vaultFolderId, setMk } = await setup()
    const vault = await store.create({ title: 'T', content: '본문', lineEnding: 'lf', folderId: vaultFolderId })
    const plain = await store.create({ title: 'P', content: '보통', lineEnding: 'lf' })
    const plainFolder = await store.createFolder({ name: '보통 폴더' })
    const rowBefore = await readRow(dbName, 'docs', vault.id)

    setMk(null)
    await expectStoreError(store.update(vault.id, { content: '잠긴 채 편집' }), 'locked')
    expect(await readRow(dbName, 'docs', vault.id)).toEqual(rowBefore)

    const count = (await inner.list()).length
    await expectStoreError(store.create({ title: 'N', content: '', lineEnding: 'lf', folderId: vaultFolderId }), 'locked')
    expect((await inner.list()).length).toBe(count)

    expect((await store.update(plain.id, { content: '보통 편집' })).content).toBe('보통 편집')
    const inPlainFolder = await store.create({ title: 'Q', content: '', lineEnding: 'lf', folderId: plainFolder.id })
    expect(inPlainFolder.e2ee).toBeUndefined()
  })
})

describe('U6 첨부 id 목록', () => {
  it('정렬·중복 없음, 1,001개는 too-many-refs, 앱이 준 목록은 무시', async () => {
    const { dbName, store, vaultFolderId } = await setup()
    const vault = await store.create({ title: 'T', content: '', lineEnding: 'lf', folderId: vaultFolderId })

    const content = '![](attachments/00000000000000bb.png)\n![](attachments/00000000000000aa.png)\n![](attachments/00000000000000bb.png)'
    await store.update(vault.id, { content })
    expect((await readRow(dbName, 'docs', vault.id))!.attachmentRefs).toEqual(['00000000000000aa', '00000000000000bb'])

    const many = Array.from({ length: 1_001 }, (_, i) => `![](attachments/${i.toString(16).padStart(16, '0')}.png)`).join('\n')
    await expectStoreError(store.update(vault.id, { content: many }), 'too-many-refs')

    await store.update(vault.id, { content: '![](attachments/00000000000000cc.png)', attachmentRefs: ['ffffffffffffffff'] })
    expect((await readRow(dbName, 'docs', vault.id))!.attachmentRefs).toEqual(['00000000000000cc'])
  })
})

describe('U7 폴더 규칙 (4.5)', () => {
  it('일반 → 금고 폴더 옮기기는 e2ee-folder, 금고 → 일반은 된다, 금고 폴더 아래 폴더는 금고', async () => {
    const { dbName, store, vaultFolderId } = await setup()
    const plainFolder = await store.createFolder({ name: '보통' })
    const plain = await store.create({ title: 'P', content: '', lineEnding: 'lf' })
    const vault = await store.create({ title: 'V', content: '', lineEnding: 'lf', folderId: vaultFolderId })

    await expectStoreError(store.moveDoc(plain.id, vaultFolderId), 'e2ee-folder')
    expect((await readRow(dbName, 'docs', plain.id))!.folderId).toBeNull()

    const moved = await store.moveDoc(vault.id, plainFolder.id)
    expect(moved.folderId).toBe(plainFolder.id)
    expect(moved.e2ee).toBe('open')

    await expectStoreError(store.moveFolder(plainFolder.id, vaultFolderId), 'e2ee-folder')
    expect((await readRow(dbName, 'folders', plainFolder.id))!.parentId).toBeNull()

    const sub = await store.createFolder({ name: '하위', parentId: vaultFolderId })
    expect((await readRow(dbName, 'folders', sub.id))!.e2ee).toBe(true)
  })
})

describe('U8 최상위 금고 문서', () => {
  it('create({ e2ee: true }) — 입력의 e2eeKey 는 버리고 새로 만든다', async () => {
    const { dbName, store } = await setup()
    const created = await store.create({ title: 'T', content: 'C', lineEnding: 'lf', folderId: null, e2ee: true, e2eeKey: 'x' })
    const row = (await readRow(dbName, 'docs', created.id))!
    expect(row.folderId).toBeNull()
    expect(String(row.e2eeKey)).toHaveLength(56)
    expect(row.e2eeKey).not.toBe('x')
    expect(created.e2ee).toBe('open')
  })
})

describe('U9 기억(4.4)', () => {
  it('clearPlainCache 뒤 MK null 이면 잠김, 다른 MK 객체면 옛 기억을 쓰지 않고 잠긴 모양', async () => {
    const { store, vaultFolderId, setMk, getMk } = await setup()
    const vault = await store.create({ title: '비밀', content: '본문', lineEnding: 'lf', folderId: vaultFolderId })
    const mk = getMk()
    expect((await store.list()).find((d) => d.id === vault.id)?.e2ee).toBe('open')

    store.clearPlainCache()
    setMk(null)
    expect((await store.list()).find((d) => d.id === vault.id)).toMatchObject({ e2ee: 'locked', title: '' })

    setMk(mk)
    expect((await store.list()).find((d) => d.id === vault.id)?.e2ee).toBe('open')

    vi.spyOn(console, 'error').mockImplementation(() => {})
    setMk(await newMasterKey())
    expect((await store.list()).find((d) => d.id === vault.id)).toMatchObject({ e2ee: 'locked', title: '', content: '' })
  })
})

describe('U10 lockDocMetas', () => {
  it('open 만 잠긴 모양으로, 나머지는 같은 객체', () => {
    const open = { id: 'a', title: '비밀', e2ee: 'open' as const }
    const locked = { id: 'b', title: '', e2ee: 'locked' as const }
    const plain = { id: 'c', title: '보통' }
    const out = lockDocMetas([open, locked, plain])
    expect(out[0]).toEqual({ id: 'a', title: '', e2ee: 'locked' })
    expect(out[1]).toBe(locked)
    expect(out[2]).toBe(plain)
  })
})

describe('U11 planE2eeReset', () => {
  it('맨 바깥 금고 폴더와 그 밖의 금고 문서만', () => {
    const plan = planE2eeReset({
      folders: [
        { id: 'A', parentId: null, e2ee: true },
        { id: 'B', parentId: 'A', e2ee: true },
        { id: 'C', parentId: null },
      ],
      docs: [
        { id: 'd1', folderId: 'C', e2ee: 'locked' },
        { id: 'd2', folderId: 'A', e2ee: 'open' },
        { id: 'd3', folderId: 'B', e2ee: 'locked' },
        { id: 'n', folderId: 'C' },
      ],
    })
    expect(plan).toEqual({ folderIds: ['A'], docIds: ['d1'] })
  })
})

describe('U12 makeE2eeConflictCopy', () => {
  it('사본 id AAD 로 풀리고 원본 id AAD 로는 안 풀린다. 문서 키가 새것. MK 가 다르면 던진다', async () => {
    const { dbName, store, vaultFolderId, getMk } = await setup()
    const vault = await store.create({ title: '원본', content: '![](attachments/00000000000000aa.png)', lineEnding: 'lf', folderId: vaultFolderId })
    const row = (await readRow(dbName, 'docs', vault.id))!
    const source = { id: vault.id, title: String(row.title), content: String(row.content), e2eeKey: String(row.e2eeKey) }
    const copyId = crypto.randomUUID()

    const copy = await makeE2eeConflictCopy(getMk()!, source, copyId)
    expect(copy.e2eeKey).not.toBe(source.e2eeKey)
    expect(copy.attachmentRefs).toEqual(['00000000000000aa'])
    const copyKey = await openDocKey(getMk()!, copy.e2eeKey)
    expect(await decryptDocField(copyKey, copyId, 'title', copy.title)).toBe('원본 (충돌 사본)')
    expect(await decryptDocField(copyKey, copyId, 'content', copy.content)).toBe('![](attachments/00000000000000aa.png)')

    let code: string | null = null
    try {
      await decryptDocField(copyKey, vault.id, 'title', copy.title)
    } catch (err) {
      code = err instanceof E2eeError ? err.code : 'other'
    }
    expect(code).toBe('decrypt-failed')

    await expect(makeE2eeConflictCopy(await newMasterKey(), source, copyId)).rejects.toBeTruthy()
  })
})

describe('attachmentRefsOf', () => {
  it('정렬한 배열, 빈 본문이면 []', () => {
    expect(attachmentRefsOf('')).toEqual([])
    expect(attachmentRefsOf('attachments/00000000000000bb.webp attachments/00000000000000aa.png')).toEqual(['00000000000000aa', '00000000000000bb'])
  })
})

// 타입만 — withE2ee 가 아래 저장소의 추가 필드를 그대로 넘기는지
describe('그대로 넘기기', () => {
  it('kind·findDocByFileHandle 이 남는다', async () => {
    const inner: Store = await createIdbStore(freshDbName())
    const store = withE2ee(inner, { getMasterKey: () => null })
    expect(store.kind).toBe('idb')
    expect(typeof store.findDocByFileHandle).toBe('function')
    const doc: Doc = await store.create({ title: 'a', content: 'b', lineEnding: 'lf' })
    expect(doc.e2ee).toBeUndefined()
  })
})
