// F-282.md 5장 A1~A10 — 가져오기 순수 함수 단위 테스트 (DOM 없이 돌아야 한다)
import { describe, it, expect } from 'vitest'
import { Zip, ZipPassThrough, zipSync } from 'fflate'
import {
  decodeZipName,
  readZipEntries,
  detectZipKind,
  planWorkspaceImport,
  planPlainImport,
  applyImportPlan,
  MAX_CONTENT_BYTES,
  MAX_ATTACHMENT_BYTES,
  type ApplyStore,
  type ImportPlan,
} from './importWorkspace'
import type { Doc } from '../types'

function bytesOf(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

// ---------- A1 decodeZipName ----------
describe('decodeZipName (F-282 A1)', () => {
  it('ASCII 는 그대로', () => {
    expect(decodeZipName('hello.md')).toBe('hello.md')
  })

  it('fflate 가 UTF-8 로 이미 푼 한글은 그대로', () => {
    expect(decodeZipName('안녕.md')).toBe('안녕.md')
  })

  it('CP949 바이트를 latin1 로 담은 문자열은 한글로 풀린다', () => {
    // '가나' 의 CP949 바이트: B0 A1 B3 AA — latin1 로 문자열에 담긴 모양
    const cp949 = String.fromCharCode(0xb0, 0xa1, 0xb3, 0xaa)
    expect(decodeZipName(cp949)).toBe('가나')
  })

  it('UTF-8 바이트를 latin1 로 담은 문자열도 한글로 풀린다', () => {
    // '가' 의 UTF-8 바이트: EA B0 80 — latin1 로 문자열에 담긴 모양
    const utf8AsLatin1 = String.fromCharCode(0xea, 0xb0, 0x80)
    expect(decodeZipName(utf8AsLatin1)).toBe('가')
  })

  it('어느 쪽으로도 안 풀리는 바이트는 그대로 돌려주고 던지지 않는다', () => {
    const weird = String.fromCharCode(0xff, 0xfe, 0x80)
    expect(() => decodeZipName(weird)).not.toThrow()
    expect(decodeZipName(weird)).toBe(weird)
  })
})

// ---------- A2 readZipEntries ----------
async function* toChunks(bytes: Uint8Array, size = 1024): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) {
    yield bytes.subarray(i, Math.min(i + size, bytes.length))
  }
}

function buildStreamingZip(files: Record<string, string>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    const zip = new Zip((err, chunk, final) => {
      if (err) reject(err)
      if (chunk) chunks.push(chunk)
      if (final) {
        const total = chunks.reduce((s, c) => s + c.length, 0)
        const out = new Uint8Array(total)
        let off = 0
        for (const c of chunks) {
          out.set(c, off)
          off += c.length
        }
        resolve(out)
      }
    })
    for (const [name, content] of Object.entries(files)) {
      const f = new ZipPassThrough(name)
      zip.add(f)
      f.push(bytesOf(content), true)
    }
    zip.end()
  })
}

describe('readZipEntries (F-282 A2)', () => {
  it('F-281 방식(스트리밍 Zip+ZipPassThrough, 데이터 디스크립터) zip 을 1KB 조각으로 읽는다', async () => {
    const zipBytes = await buildStreamingZip({ 'a.md': '내용 A', 'b.md': '내용 B' })
    const results: { name: string; bytes: Uint8Array | null }[] = []
    for await (const entry of readZipEntries(toChunks(zipBytes, 1024))) {
      results.push(entry)
    }
    expect(results.map((r) => r.name).sort()).toEqual(['a.md', 'b.md'])
    const a = results.find((r) => r.name === 'a.md')!
    expect(new TextDecoder().decode(a.bytes as Uint8Array)).toBe('내용 A')
  })

  it('일반 zipSync(deflate) zip 을 1KB 조각으로 읽는다', async () => {
    const zipBytes = zipSync({ 'x.md': bytesOf('내용 X'), 'y.md': bytesOf('내용 Y') })
    const results: { name: string; bytes: Uint8Array | null }[] = []
    for await (const entry of readZipEntries(toChunks(zipBytes, 1024))) {
      results.push(entry)
    }
    expect(results.map((r) => r.name).sort()).toEqual(['x.md', 'y.md'])
  })

  it('want 가 false 인 항목은 bytes 가 null 이고 그 뒤 항목이 정상으로 나온다', async () => {
    const zipBytes = await buildStreamingZip({ 'a.md': '내용 A', 'skip.md': '건너뜀', 'b.md': '내용 B' })
    const results: { name: string; bytes: Uint8Array | null }[] = []
    for await (const entry of readZipEntries(toChunks(zipBytes, 1024), { want: (n) => n !== 'skip.md' })) {
      results.push(entry)
    }
    const skip = results.find((r) => r.name === 'skip.md')!
    expect(skip.bytes).toBeNull()
    const b = results.find((r) => r.name === 'b.md')!
    expect(new TextDecoder().decode(b.bytes as Uint8Array)).toBe('내용 B')
  })

  it('같은 이름이 두 번이면 처음 것만 나온다', async () => {
    const zipBytes = zipSync({ 'dup.md': bytesOf('첫번째') })
    // zipSync 는 같은 이름을 만들 수 없으니, 두 zip 을 이어붙여 이름이 겹치는 스트림을 흉내낸다
    const zipBytes2 = zipSync({ 'dup.md': bytesOf('두번째') })
    const combined = new Uint8Array(zipBytes.length + zipBytes2.length)
    combined.set(zipBytes, 0)
    combined.set(zipBytes2, zipBytes.length)
    const results: { name: string; bytes: Uint8Array | null }[] = []
    for await (const entry of readZipEntries(toChunks(combined, 1024))) {
      results.push(entry)
    }
    const dups = results.filter((r) => r.name === 'dup.md')
    expect(dups.length).toBe(1)
    expect(new TextDecoder().decode(dups[0].bytes as Uint8Array)).toBe('첫번째')
  })
})

// ---------- A3 판별·거부 ----------
describe('detectZipKind (F-282 A3)', () => {
  it('manifest.json 없으면 plain', () => {
    expect(detectZipKind(null)).toEqual({ kind: 'plain' })
  })

  it('format:1 정상이면 workspace', () => {
    const manifest = { format: 1, folders: [], docs: [] }
    const result = detectZipKind(bytesOf(JSON.stringify(manifest)))
    expect(result.kind).toBe('workspace')
  })

  it('format:2 는 거부', () => {
    const manifest = { format: 2, folders: [], docs: [] }
    const result = detectZipKind(bytesOf(JSON.stringify(manifest)))
    expect(result).toEqual({ kind: 'rejected', message: '이 zip 은 모르는 형식(format 2)이라 가져올 수 없습니다.' })
  })

  it('깨진 JSON 은 plain', () => {
    const result = detectZipKind(bytesOf('{ 이거 깨진 json'))
    expect(result).toEqual({ kind: 'plain' })
  })

  it('format 이 문자열이면 plain', () => {
    const manifest = { format: '1', folders: [], docs: [] }
    const result = detectZipKind(bytesOf(JSON.stringify(manifest)))
    expect(result).toEqual({ kind: 'plain' })
  })
})

// ---------- A4 workspace 문서 판정 ----------
describe('planWorkspaceImport 문서 판정 (F-282 A4)', () => {
  const NOW = 2_000_000
  const existingDocs = [
    { id: 'owned-update', updatedAt: 1000, role: 'owner' as const },
    { id: 'owned-same', updatedAt: 1000, role: undefined },
    { id: 'owned-newer', updatedAt: 2000, role: 'owner' as const },
    { id: 'shared-edit', updatedAt: 1000, role: 'edit' as const },
  ]

  function manifestDoc(over: Partial<{ id: string; path: string; updatedAt: number }>) {
    return {
      id: over.id ?? 'x',
      path: over.path ?? `${over.id}.md`,
      title: '제목',
      folderId: null,
      lineEnding: 'lf' as const,
      createdAt: 500,
      updatedAt: over.updatedAt ?? 500,
      pinnedAt: null,
    }
  }

  it('새 id → create, 더 늦음 → update, 같음/더 이름 → skip, 없는 path/빠진 id → 계획에서 빠짐, 공유받은 id 는 create-new-id', () => {
    const manifest = {
      format: 1 as const,
      exportedAt: NOW,
      scope: 'all' as const,
      rootFolderId: null,
      folders: [],
      docs: [
        manifestDoc({ id: 'new-doc', updatedAt: 900 }), // 새 id → create
        manifestDoc({ id: 'owned-update', updatedAt: 1500 }), // 더 늦음 → update
        manifestDoc({ id: 'owned-same', updatedAt: 1000 }), // 같음 → skip
        manifestDoc({ id: 'owned-newer', updatedAt: 1000 }), // 더 이름 → skip
        { ...manifestDoc({ id: 'no-such-path', path: 'zip에없음.md', updatedAt: 900 }) },
        { ...manifestDoc({ id: '', updatedAt: 900 }), path: '' }, // id 빠짐
        manifestDoc({ id: 'shared-edit', updatedAt: 900 }), // 공유받은 id
      ],
    }
    const zipPaths = new Set(['new-doc.md', 'owned-update.md', 'owned-same.md', 'owned-newer.md', 'shared-edit.md'])

    const plan = planWorkspaceImport({
      manifest,
      existingDocs,
      existingFolders: [],
      zipPaths,
      existingAttachmentIds: new Set(),
      now: NOW,
    })

    const byPath = new Map(plan.docs.map((d) => [d.path, d]))
    expect(byPath.get('new-doc.md')?.action).toBe('create')
    const created = byPath.get('new-doc.md') as { action: 'create'; id?: string; createdAt?: number; updatedAt?: number; pinnedAt?: number | null }
    expect(created.id).toBe('new-doc')
    expect(created.createdAt).toBe(500)
    expect(created.updatedAt).toBe(900)
    expect(created.pinnedAt).toBeNull()

    expect(byPath.get('owned-update.md')?.action).toBe('update')
    expect(byPath.has('owned-same.md')).toBe(false) // skip 은 계획에 없다(counts 로만 잡는다)
    expect(byPath.has('owned-newer.md')).toBe(false)
    expect(byPath.get('shared-edit.md')?.action).toBe('create-new-id')

    expect(plan.counts.created).toBe(2) // new-doc + shared-edit
    expect(plan.counts.updated).toBe(1)
    expect(plan.counts.skipped).toBe(2)
    expect(plan.warnings.some((w) => w.includes('zip 에 없는 문서'))).toBe(true)
    expect(plan.warnings.some((w) => w.includes('공유받은 문서와 id 가 같아'))).toBe(true)
  })
})

// ---------- A5 workspace 폴더 판정 ----------
describe('planWorkspaceImport 폴더 판정 (F-282 A5)', () => {
  const NOW = 1000

  it('있으면 재사용, 없으면 id 유지해 만들기, 끊긴 부모는 최상위, 3단계는 2단계로, 부모가 자식보다 먼저', () => {
    const manifest = {
      format: 1 as const,
      exportedAt: NOW,
      scope: 'all' as const,
      rootFolderId: null,
      folders: [
        { id: 'existing-f', name: '이미있음', parentId: null, path: '이미있음' },
        { id: 'new-f', name: '새폴더', parentId: null, path: '새폴더' },
        { id: 'orphan-f', name: '끊김', parentId: 'no-such-parent', path: '끊김' },
        { id: 'd1', name: 'd1', parentId: null, path: 'd1' },
        { id: 'd2', name: 'd2', parentId: 'd1', path: 'd1/d2' },
        { id: 'd3', name: 'd3', parentId: 'd2', path: 'd1/d2/d3' },
      ],
      docs: [],
    }
    const existingFolders = [{ id: 'existing-f', parentId: null }]

    const plan = planWorkspaceImport({
      manifest,
      existingDocs: [],
      existingFolders,
      zipPaths: new Set(),
      existingAttachmentIds: new Set(),
      now: NOW,
    })

    const byId = new Map(plan.folders.map((f) => [f.id, f]))
    expect(byId.get('existing-f')?.action).toBe('existing')
    expect(byId.get('new-f')?.action).toBe('create')
    expect(byId.get('orphan-f')?.parentId).toBeNull()

    // d3 는 3단계라 2단계(d1 의 자식)로 합쳐진다
    expect(byId.get('d3')?.parentId).toBe('d1')
    expect(plan.warnings.some((w) => w.includes('2단계로 합친 폴더'))).toBe(true)

    // 부모가 자식보다 앞선다
    const order = plan.folders.map((f) => f.id)
    expect(order.indexOf('d1')).toBeLessThan(order.indexOf('d2'))
    expect(order.indexOf('d1')).toBeLessThan(order.indexOf('d3'))
  })

  it('scope:folder 에서 rootFolderId 가 있으면 그 안, 없으면 최상위', () => {
    const manifestWithRoot = {
      format: 1 as const,
      exportedAt: NOW,
      scope: 'folder' as const,
      rootFolderId: 'my-root',
      folders: [{ id: 'sub', name: '하위', parentId: null, path: '하위' }],
      docs: [],
    }
    const planA = planWorkspaceImport({
      manifest: manifestWithRoot,
      existingDocs: [],
      existingFolders: [{ id: 'my-root', parentId: null }],
      zipPaths: new Set(),
      existingAttachmentIds: new Set(),
      now: NOW,
    })
    expect(planA.folders.find((f) => f.id === 'sub')?.parentId).toBe('my-root')

    const planB = planWorkspaceImport({
      manifest: manifestWithRoot,
      existingDocs: [],
      existingFolders: [], // rootFolderId 가 내게 없음
      zipPaths: new Set(),
      existingAttachmentIds: new Set(),
      now: NOW,
    })
    expect(planB.folders.find((f) => f.id === 'sub')?.parentId).toBeNull()
  })
})

// ---------- A6 일반 zip 계획 ----------
describe('planPlainImport (F-282 A6)', () => {
  it('공통 최상위를 벗기고, 문서·폴더·잡음·경로 이상을 규칙대로 판정한다', () => {
    const entries = [
      { name: 'Vault/a.md', content: '내용' },
      { name: 'Vault/폴더/b.markdown', content: '내용' },
      { name: 'Vault/A/B/C/c.md', content: '내용' },
      { name: 'Vault/note.txt' },
      { name: '__MACOSX/x' },
      { name: 'Vault/.obsidian/y' },
      { name: 'Vault/../evil.md', content: '악' },
    ]
    const plan = planPlainImport({ entries, now: 1000 })

    const titles = plan.docs.map((d) => d.title).sort()
    expect(titles).toEqual(['a', 'b', 'c'])

    const cDoc = plan.docs.find((d) => d.title === 'c')!
    // c 는 A/B 로 합쳐진 폴더 안에 있어야 한다(3단계 → 2단계)
    const cFolder = plan.folders.find((f) => f.id === cDoc.folderId)!
    expect(cFolder.name).toBe('B')
    const cParent = plan.folders.find((f) => f.id === cFolder.parentId)!
    expect(cParent.name).toBe('A')

    expect(plan.warnings.some((w) => w === '.md 가 아니라 건너뛴 파일 1개')).toBe(true)
    expect(plan.warnings.some((w) => w.includes('2단계로 합친 폴더'))).toBe(true)
    expect(plan.warnings.some((w) => w.includes('경로가 이상해 건너뛴 파일'))).toBe(true)
    expect(plan.docs.every((d) => d.action === 'create')).toBe(true)
  })
})

// ---------- A7 일반 zip 이미지 ----------
describe('planPlainImport 이미지 (F-282 A7)', () => {
  it('앱 형식 참조만 zip 에 있으면 계획에 넣고, 원문은 안 바뀌며, 다른 형식 참조·없는 참조는 경고만', () => {
    const id = '0f3a9c2e7b1d4a58'
    const content = `본문\n<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n![[그림.png]]\n`
    const entries = [
      { name: '폴더/문서.md', content },
      { name: '폴더/attachments/' + id + '.png' },
    ]
    const plan = planPlainImport({ entries, now: 1000 })
    expect(plan.attachments.length).toBe(1)
    expect(plan.attachments[0].id).toBe(id)
    expect(plan.docs[0].title).toBe('문서')
    // 원문을 바꾸지 않는다 — planPlainImport 는 content 를 계획에 넣지 않고 path 만 넣는다(적용 때 원본 바이트 그대로 읽는다)
    expect((plan.docs[0] as { content?: unknown }).content).toBeUndefined()
    expect(plan.warnings.some((w) => w.includes('이 앱 형식이 아니라'))).toBe(true)
  })

  it('참조는 있는데 zip 에 파일이 없으면 경고', () => {
    const id = '1111111111111111'
    const content = `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n`
    const entries = [{ name: '문서.md', content }]
    const plan = planPlainImport({ entries, now: 1000 })
    expect(plan.attachments.length).toBe(0)
    expect(plan.warnings.some((w) => w.includes('가져오지 못한 이미지 참조'))).toBe(true)
  })
})

// ---------- A8 적용 ----------
function fakeStore(overrides: Partial<ApplyStore> = {}): ApplyStore & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { get: [], create: [], update: [], createFolder: [], putAttachment: [] }
  const docsById = new Map<string, Doc>()
  const attachmentIds = new Set<string>()
  const base: ApplyStore = {
    kind: 'idb',
    async get(id) {
      calls.get.push([id])
      return docsById.get(id) ?? null
    },
    async create(input) {
      calls.create.push([input])
      const doc: Doc = {
        id: input.id ?? `new-${calls.create.length}`,
        title: input.title,
        content: input.content,
        lineEnding: input.lineEnding,
        createdAt: input.createdAt ?? 1,
        updatedAt: input.updatedAt ?? 1,
        folderId: input.folderId ?? null,
        pinnedAt: input.pinnedAt ?? null,
      }
      docsById.set(doc.id, doc)
      return doc
    },
    async update(id, patch) {
      calls.update.push([id, patch])
      const existing = docsById.get(id)
      if (!existing) throw new Error('not found')
      const updated = { ...existing, ...patch }
      docsById.set(id, updated)
      return updated
    },
    async createFolder(input) {
      calls.createFolder.push([input])
      return { id: input.id ?? `f-${calls.createFolder.length}`, name: input.name, parentId: input.parentId ?? null, createdAt: 1, updatedAt: 1 }
    },
    async putAttachment(input) {
      calls.putAttachment.push([input])
      attachmentIds.add(input.id ?? 'auto')
      return { id: input.id ?? 'auto', ext: input.ext }
    },
  }
  return { ...base, ...overrides, calls, __docsById: docsById } as unknown as ApplyStore & { calls: typeof calls }
}

async function* entriesFrom(list: Array<{ name: string; text?: string; bytes?: Uint8Array }>): AsyncGenerator<{ name: string; bytes: Uint8Array | null }> {
  for (const e of list) {
    yield { name: e.name, bytes: e.bytes ?? (e.text !== undefined ? new TextEncoder().encode(e.text) : null) }
  }
}

const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
])

describe('applyImportPlan (F-282 A8)', () => {
  it('create 는 id·createdAt·updatedAt·pinnedAt 이 그대로 가고, update 는 사본을 먼저 만들고, 첨부는 putAttachment({id}), 폴더는 부모가 먼저', async () => {
    const store = fakeStore()
    // 기존 문서(update 대상)를 미리 넣어둔다
    await store.create({ title: '기존', content: '기존 내용', lineEnding: 'lf', id: 'upd-1', createdAt: 1, updatedAt: 1 })
    store.calls.create.length = 0 // 위 준비 호출은 검증에서 뺀다

    const plan: ImportPlan = {
      kind: 'workspace',
      folders: [
        { id: 'parent', name: '부모', parentId: null, action: 'create', preserveId: true },
        { id: 'child', name: '자식', parentId: 'parent', action: 'create', preserveId: true },
      ],
      docs: [
        { action: 'create', id: 'created-1', path: 'created.md', title: '새문서', lineEnding: 'lf', folderId: 'child', createdAt: 10, updatedAt: 20, pinnedAt: 30 },
        { action: 'update', id: 'upd-1', path: 'upd.md', title: '갱신됨', lineEnding: 'lf', folderId: null },
      ],
      attachments: [{ id: 'aaaaaaaaaaaaaaaa', ext: 'png', path: 'attachments/aaaaaaaaaaaaaaaa.png' }],
      warnings: [],
      counts: { created: 1, updated: 1, skipped: 0, images: 1 },
    }

    const result = await applyImportPlan({
      plan,
      entries: entriesFrom([
        { name: 'created.md', text: '새 내용\n' },
        { name: 'upd.md', text: '갱신된 내용\n' },
        { name: 'attachments/aaaaaaaaaaaaaaaa.png', bytes: PNG_1PX },
      ]),
      store,
    })

    expect(result.createdCount).toBe(1)
    expect(result.updatedCount).toBe(1)
    expect(result.failures).toEqual([])

    // 폴더는 부모가 먼저 만들어진다
    expect(store.calls.createFolder[0][0]).toMatchObject({ name: '부모', parentId: null, id: 'parent' })
    expect(store.calls.createFolder[1][0]).toMatchObject({ name: '자식', parentId: 'parent', id: 'child' })

    const createCall = store.calls.create.find((c) => (c[0] as { id?: string }).id === 'created-1')![0] as Record<string, unknown>
    expect(createCall.createdAt).toBe(10)
    expect(createCall.updatedAt).toBe(20)
    expect(createCall.pinnedAt).toBe(30)

    // update 는 사본(store.create, id 없음)이 store.update 보다 먼저 불린다
    const copyCallIndex = store.calls.create.findIndex((c) => (c[0] as { title?: string }).title === '기존 (가져오기 전)')
    expect(copyCallIndex).toBeGreaterThanOrEqual(0)
    expect(store.calls.update.length).toBe(1)
    expect(store.calls.update[0][0]).toBe('upd-1')

    // 첨부는 putAttachment({id}) 로 간다
    expect(store.calls.putAttachment[0][0]).toMatchObject({ id: 'aaaaaaaaaaaaaaaa', ext: 'png' })
  })

  it('이미 있는 첨부 id 는 계획에서 빠져 putAttachment 를 안 부른다', async () => {
    // planWorkspaceImport 단계에서 existingAttachmentIds 로 걸러지는 것을 확인 — collectWorkspaceAttachments 간접 확인
    const manifest = { format: 1 as const, exportedAt: 1, scope: 'all' as const, rootFolderId: null, folders: [], docs: [] }
    const plan = planWorkspaceImport({
      manifest,
      existingDocs: [],
      existingFolders: [],
      zipPaths: new Set(['attachments/bbbbbbbbbbbbbbbb.png']),
      existingAttachmentIds: new Set(['bbbbbbbbbbbbbbbb']),
      now: 1,
    })
    expect(plan.attachments.length).toBe(0)
  })
})

// ---------- A9 실패·취소 ----------
describe('applyImportPlan 실패·취소 (F-282 A9)', () => {
  function basePlan(): ImportPlan {
    return {
      kind: 'workspace',
      folders: [],
      docs: [
        { action: 'create', id: 'd1', path: 'd1.md', title: '문서1', lineEnding: 'lf', folderId: null, createdAt: 1, updatedAt: 1, pinnedAt: null },
        { action: 'create', id: 'd2', path: 'd2.md', title: '문서2', lineEnding: 'lf', folderId: null, createdAt: 1, updatedAt: 1, pinnedAt: null },
        { action: 'create', id: 'd3', path: 'd3.md', title: '문서3', lineEnding: 'lf', folderId: null, createdAt: 1, updatedAt: 1, pinnedAt: null },
      ],
      attachments: [],
      warnings: [],
      counts: { created: 3, updated: 0, skipped: 0, images: 0 },
    }
  }

  it('문서 하나에서 store.create 가 던지면 그 문서만 실패 목록, 나머지는 들어간다', async () => {
    const store = fakeStore({
      async create(input) {
        if (input.id === 'd2') throw new Error('boom')
        return { id: input.id ?? 'x', title: input.title, content: input.content, lineEnding: input.lineEnding, createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null }
      },
    })
    const result = await applyImportPlan({ plan: basePlan(), entries: entriesFrom([{ name: 'd1.md', text: '1' }, { name: 'd2.md', text: '2' }, { name: 'd3.md', text: '3' }]), store })
    expect(result.createdCount).toBe(2)
    expect(result.failures.length).toBe(1)
    expect(result.failures[0]).toContain('문서2')
  })

  it('사본 만들기가 던지면 갱신하지 않고 실패 목록에 남는다', async () => {
    const store = fakeStore()
    await store.create({ title: '기존', content: '기존내용', lineEnding: 'lf', id: 'upd-1', createdAt: 1, updatedAt: 1 })
    let createCalls = 0
    const wrapped: ApplyStore = {
      ...store,
      async create(input) {
        createCalls++
        if (input.title === '기존 (가져오기 전)') throw new Error('copy fail')
        return store.create(input)
      },
    }
    const plan: ImportPlan = {
      kind: 'workspace',
      folders: [],
      docs: [{ action: 'update', id: 'upd-1', path: 'upd.md', title: '새 제목', lineEnding: 'lf', folderId: null }],
      attachments: [],
      warnings: [],
      counts: { created: 0, updated: 1, skipped: 0, images: 0 },
    }
    const result = await applyImportPlan({ plan, entries: entriesFrom([{ name: 'upd.md', text: '새 내용' }]), store: wrapped })
    expect(result.updatedCount).toBe(0)
    expect(result.failures.some((f) => f.includes('사본을 만들지 못해'))).toBe(true)
    expect(createCalls).toBeGreaterThan(0)
    const doc = await store.get('upd-1')
    expect(doc?.content).toBe('기존내용') // 원래 내용이 남는다
  })

  it('폴더 만들기가 실패하면 그 폴더 문서는 최상위로 들어간다', async () => {
    const store = fakeStore({
      async createFolder() {
        throw new Error('folder fail')
      },
    })
    const plan: ImportPlan = {
      kind: 'workspace',
      folders: [{ id: 'f1', name: '실패폴더', parentId: null, action: 'create', preserveId: true }],
      docs: [{ action: 'create', id: 'd1', path: 'd1.md', title: '문서1', lineEnding: 'lf', folderId: 'f1', createdAt: 1, updatedAt: 1, pinnedAt: null }],
      attachments: [],
      warnings: [],
      counts: { created: 1, updated: 0, skipped: 0, images: 0 },
    }
    await applyImportPlan({ plan, entries: entriesFrom([{ name: 'd1.md', text: '1' }]), store })
    const created = store.calls.create[0][0] as Record<string, unknown>
    expect(created.folderId).toBeNull()
  })

  it('취소 신호를 주면 지금 항목까지만 처리하고 멈춘다', async () => {
    const store = fakeStore()
    let cancel = false
    const result = await applyImportPlan({
      plan: basePlan(),
      entries: entriesFrom([{ name: 'd1.md', text: '1' }, { name: 'd2.md', text: '2' }, { name: 'd3.md', text: '3' }]),
      store,
      isCancelled: () => cancel,
      onProgress: ({ done }) => {
        if (done === 2) cancel = true
      },
    })
    expect(result.cancelled).toBe(true)
    expect(result.createdCount).toBe(2)
    expect(store.calls.create.length).toBe(2)
  })
})

// ---------- A10 한도 ----------
describe('applyImportPlan 한도 (F-282 A10)', () => {
  it('server 저장소는 1MB 넘는 문서·5MB 넘는 이미지·형식 아닌 이미지를 건너뛰고, quota 뒤로는 남은 이미지가 전부 실패한다', async () => {
    let putCount = 0
    const store = fakeStore({
      kind: 'server',
      async putAttachment(input) {
        putCount++
        if (putCount === 1) {
          const err = new Error('quota_exceeded')
          err.name = 'quota_exceeded'
          throw err
        }
        return { id: input.id ?? 'auto', ext: input.ext }
      },
    })

    const bigContent = 'a'.repeat(MAX_CONTENT_BYTES + 10)
    const bigImage = new Uint8Array(MAX_ATTACHMENT_BYTES + 10)
    bigImage.set(PNG_1PX)

    const plan: ImportPlan = {
      kind: 'plain',
      folders: [],
      docs: [{ action: 'create', path: 'big.md', title: '큰문서', lineEnding: 'auto', folderId: null }],
      attachments: [
        { id: '1111111111111111', ext: 'png', path: 'attachments/1111111111111111.png' }, // 5MB 초과
        { id: '2222222222222222', ext: 'png', path: 'attachments/2222222222222222.png' }, // 형식 아님
        { id: '3333333333333333', ext: 'png', path: 'attachments/3333333333333333.png' }, // quota 예외 발생
        { id: '4444444444444444', ext: 'png', path: 'attachments/4444444444444444.png' }, // quota 이후 — 안 부름
      ],
      warnings: [],
      counts: { created: 1, updated: 0, skipped: 0, images: 4 },
    }

    const result = await applyImportPlan({
      plan,
      entries: entriesFrom([
        { name: 'big.md', text: bigContent },
        { name: 'attachments/1111111111111111.png', bytes: bigImage },
        { name: 'attachments/2222222222222222.png', text: '이미지 아님' },
        { name: 'attachments/3333333333333333.png', bytes: PNG_1PX },
        { name: 'attachments/4444444444444444.png', bytes: PNG_1PX },
      ]),
      store,
    })

    expect(result.createdCount).toBe(0)
    expect(result.failures.some((f) => f.includes('1MB'))).toBe(true)
    expect(result.failures.some((f) => f.includes('5MB'))).toBe(true)
    expect(result.failures.some((f) => f.includes('알 수 없는 형식'))).toBe(true)
    expect(putCount).toBe(1) // 셋째(형식·용량 통과한 첫 실제 호출)에서 quota 예외, 넷째는 안 부른다
    expect(result.quotaSkippedCount).toBe(2) // 셋째(quota 자체) + 넷째(스킵)
  })

  it('idb 저장소는 1MB 검사를 하지 않는다', async () => {
    const store = fakeStore({ kind: 'idb' })
    const bigContent = 'a'.repeat(MAX_CONTENT_BYTES + 10)
    const plan: ImportPlan = {
      kind: 'plain',
      folders: [],
      docs: [{ action: 'create', path: 'big.md', title: '큰문서', lineEnding: 'auto', folderId: null }],
      attachments: [],
      warnings: [],
      counts: { created: 1, updated: 0, skipped: 0, images: 0 },
    }
    const result = await applyImportPlan({ plan, entries: entriesFrom([{ name: 'big.md', text: bigContent }]), store })
    expect(result.createdCount).toBe(1)
    expect(result.failures).toEqual([])
  })
})
