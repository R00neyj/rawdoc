// F-2019.md 15.1 U6~U19 — 볼트 가져오기 순수 함수 단위 테스트
import { describe, it, expect } from 'vitest'
import {
  scanVault,
  vaultWantsBytes,
  filesAsEntries,
  defaultVaultTarget,
  vaultTargetOptions,
  planVaultImport,
  applyVaultImport,
  vaultUploadNames,
  type VaultEntry,
  type VaultScan,
  type ApplyVaultStore,
} from './importVault'
import { planVaultExport, toVaultMarkdown } from './exportVault'
import { buildImageBlock } from '../lib/imageBlock'
import type { AttachmentExt, Doc, Folder } from '../types'

async function* entriesOf(list: Array<{ name: string; text?: string; bytes?: Uint8Array }>): AsyncGenerator<VaultEntry> {
  for (const e of list) {
    yield { name: e.name, bytes: e.bytes ?? (e.text !== undefined ? new TextEncoder().encode(e.text) : null) }
  }
}

const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
])

// SOF0(0xC0) 마커 하나만 있는 최소 JPEG (src/lib/imageFile.test.ts 와 같은 모양)
const JPEG_1PX = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1])

function makeDoc(overrides: Partial<Doc> & { id: string; title: string }): Doc {
  return {
    content: '',
    lineEnding: 'lf',
    createdAt: 1,
    updatedAt: 1,
    folderId: null,
    pinnedAt: null,
    ...overrides,
  }
}

function makeFolder(overrides: Partial<Folder> & { id: string; name: string }): Folder {
  return { parentId: null, createdAt: 1, updatedAt: 1, ...overrides }
}

async function scanFrom(root: { kind: 'zip'; fileName: string } | { kind: 'folder' }, list: Array<{ name: string; text?: string; bytes?: Uint8Array }>): Promise<VaultScan> {
  return scanVault({ root, entries: entriesOf(list) })
}

describe('filesAsEntries', () => {
  it('want 가 참인 것만 바이트를 읽고, 아니면 이름만(bytes null)', async () => {
    const files = [
      { path: 'a.md', file: new Blob([new TextEncoder().encode('내용')]) },
      { path: 'b.txt', file: new Blob([new TextEncoder().encode('제외')]) },
    ]
    const result: VaultEntry[] = []
    for await (const e of filesAsEntries(files, vaultWantsBytes)) result.push(e)
    expect(result[0]).toEqual({ name: 'a.md', bytes: new TextEncoder().encode('내용') })
    expect(result[1]).toEqual({ name: 'b.txt', bytes: null })
  })
})

describe('vaultWantsBytes', () => {
  it('.md·.markdown·이미지 4종만 참', () => {
    expect(vaultWantsBytes('a.md')).toBe(true)
    expect(vaultWantsBytes('a.markdown')).toBe(true)
    expect(vaultWantsBytes('a.png')).toBe(true)
    expect(vaultWantsBytes('a.JPG')).toBe(true)
    expect(vaultWantsBytes('a.svg')).toBe(false)
    expect(vaultWantsBytes('a.txt')).toBe(false)
  })
})

describe('scanVault — 6.1 zip (F-2019.md U7)', () => {
  it('공통 최상위를 벗기고 볼트 이름을 정한다, __MACOSX·.obsidian 은 안 셈, ..는 경고', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'x.zip' }, [
      { name: '내볼트/a.md', text: '# a\n' },
      { name: '내볼트/폴더/b.md', text: '# b\n' },
      { name: '__MACOSX/x', text: '' },
      { name: '내볼트/.obsidian/y', text: '' },
      { name: '내볼트/note.txt', text: '메모' },
      { name: '내볼트/../evil.md', text: '악' },
    ])
    expect(scan.vaultName).toBe('내볼트')
    expect(scan.docs.map((d) => d.path).sort()).toEqual(['a.md', '폴더/b.md'])
    expect(scan.nonMdSkipped).toBe(1)
    expect(scan.traversalSkipped).toBe(1)
  })

  it('루트에 파일이 있으면 공통 최상위를 벗기지 않고 zip 파일 이름을 쓴다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'import.zip' }, [
      { name: 'a.md', text: '내용' },
      { name: '폴더/b.md', text: '내용' },
    ])
    expect(scan.vaultName).toBe('import')
    expect(scan.docs.map((d) => d.path).sort()).toEqual(['a.md', '폴더/b.md'])
  })

  it('.ZIP 대문자도 뗀다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'Import.ZIP' }, [{ name: 'a.md', text: '내용' }])
    expect(scan.vaultName).toBe('Import')
  })

  it('이미지 확장자 파일은 nonMdSkipped 로 세지 않는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/a.md', text: '내용' },
      { name: 'v/그림.svg', text: '<svg/>' },
    ])
    expect(scan.nonMdSkipped).toBe(0)
  })

  it('NFD 파일 이름은 NFC 제목·경로로, 본문은 그대로', async () => {
    const nfdName = '가'.normalize('NFD') + '.md' // '가' 를 NFD 로
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: `v/${nfdName}`, text: '본문' }])
    expect(scan.docs[0].path.normalize('NFC')).toBe(scan.docs[0].path)
    expect(scan.docs[0].title).toBe('가')
  })

  it('4.4 — 이름 끝 -vault 를 뗀다', async () => {
    const a = await scanFrom({ kind: 'zip', fileName: '교안-vault.zip' }, [{ name: '교안-vault/a.md', text: 'x' }])
    expect(a.vaultName).toBe('교안')
    const b = await scanFrom({ kind: 'zip', fileName: '2026-09-23-vault.zip' }, [{ name: 'a.md', text: 'x' }])
    expect(b.vaultName).toBe('2026-09-23')
    const c = await scanFrom({ kind: 'folder' }, [{ name: '교안-vault/a.md', text: 'x' }])
    expect(c.vaultName).toBe('교안')
    const d = await scanFrom({ kind: 'zip', fileName: '교안-Vault.zip' }, [{ name: '교안-Vault/a.md', text: 'x' }])
    expect(d.vaultName).toBe('교안-Vault')
    const e = await scanFrom({ kind: 'zip', fileName: '-vault.zip' }, [{ name: '-vault/a.md', text: 'x' }])
    expect(e.vaultName).toBe('-vault')
  })

  it('폴더 입구는 첫 조각만 벗기고 더 벗기지 않는다', async () => {
    const scan = await scanFrom({ kind: 'folder' }, [
      { name: '내 볼트/위키/개념/a.md', text: '내용' },
      { name: '내 볼트/attachments/그림.png', bytes: PNG_1PX },
      { name: '내 볼트/.obsidian/app.json', text: '{}' },
    ])
    expect(scan.vaultName).toBe('내 볼트')
    expect(scan.docs[0].path).toBe('위키/개념/a.md')
  })
})

describe('scanVault — 6.2·7.3 이미지 (F-2019.md U8)', () => {
  it('16진수 이름 + 형식 일치는 이름 id, 5MB 넘거나 형식 모르면 attachmentId 없음', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/0f3a9c2e7b1d4a58.png', bytes: PNG_1PX },
      { name: 'v/모름.png', bytes: new TextEncoder().encode('not a png') },
    ])
    const hexNamed = scan.images.find((i) => i.path === '0f3a9c2e7b1d4a58.png')!
    expect(hexNamed.attachmentId).toBe('0f3a9c2e7b1d4a58')
    const unknown = scan.images.find((i) => i.path === '모름.png')!
    expect(unknown.attachmentId).toBeNull()
    expect(unknown.unreadable).toBe(true)
  })

  it('내용 해시가 node:crypto SHA-256 앞 16자와 같다, 같은 바이트는 같은 id', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/a.png', bytes: PNG_1PX },
      { name: 'v/b.png', bytes: PNG_1PX },
    ])
    const digest = await crypto.subtle.digest('SHA-256', PNG_1PX as unknown as BufferSource)
    const expected = Array.from(new Uint8Array(digest).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    expect(scan.images[0].attachmentId).toBe(expected)
    expect(scan.images[0].attachmentId).toBe(scan.images[1].attachmentId)
  })

  it('wiki 임베드는 같은 디렉터리 우선으로 볼트 이미지를 찾는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/문서.md', text: '![[그림.png]]\n' },
      { name: 'v/그림.png', bytes: PNG_1PX },
    ])
    const doc = scan.docs[0]
    expect(doc.embeds[0].resolvedImagePath).toBe('그림.png')
  })

  it('markdown 임베드 — 상대 경로 → 루트 → 이름 하나뿐이면 그것', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/하위/문서.md', text: '![](../img/a.png)\n' },
      { name: 'v/img/a.png', bytes: PNG_1PX },
    ])
    const doc = scan.docs[0]
    expect(doc.embeds[0].resolvedImagePath).toBe('img/a.png')
  })

  it('markdown 임베드 — 이름이 볼트에 하나뿐이면 그 파일(셋째 단계)', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/문서.md', text: '![](유일.png)\n' },
      { name: 'v/어딘가/유일.png', bytes: PNG_1PX },
    ])
    expect(scan.docs[0].embeds[0].resolvedImagePath).toBe('어딘가/유일.png')
  })

  it('찾지 못하면 resolvedImagePath 가 null', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/문서.md', text: '![[없음.png]]\n' }])
    expect(scan.docs[0].embeds[0].resolvedImagePath).toBeNull()
  })
})

describe('defaultVaultTarget·vaultTargetOptions (F-2019.md U9)', () => {
  it('최상위에 같은 이름 폴더가 하나면 그 폴더, 없거나 둘이면 new', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: '내볼트/a.md', text: 'x' }])
    const one = [makeFolder({ id: 'f1', name: '내볼트' })]
    expect(defaultVaultTarget(scan, one)).toEqual({ kind: 'folder', folderId: 'f1' })
    expect(defaultVaultTarget(scan, [])).toEqual({ kind: 'new' })
    const two = [makeFolder({ id: 'f1', name: '내볼트' }), makeFolder({ id: 'f2', name: '내볼트' })]
    expect(defaultVaultTarget(scan, two)).toEqual({ kind: 'new' })
  })

  it('하위 폴더의 같은 이름은 무시한다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: '내볼트/a.md', text: 'x' }])
    const nested = [makeFolder({ id: 'p', name: '상위' }), makeFolder({ id: 'c', name: '내볼트', parentId: 'p' })]
    expect(defaultVaultTarget(scan, nested)).toEqual({ kind: 'new' })
  })

  it('선택지 순서 — new, top, 그다음 폴더 트리 순', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/a.md', text: 'x' }])
    const folders = [makeFolder({ id: 'f1', name: '가' })]
    const options = vaultTargetOptions(scan, folders)
    expect(options[0]).toEqual({ value: 'new', label: '새 폴더 "v"' })
    expect(options[1]).toEqual({ value: 'top', label: '최상위' })
    expect(options[2].value).toBe('folder:f1')
  })
})

describe('planVaultImport — 7.4 경로 맞추기 (F-2019.md U10)', () => {
  it('내보내기 이름 키로 맞추고(왜? ↔ 왜_.md), 없으면 제목 그대로 키로', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/왜_.md', text: '새 내용\n' }])
    const existing = makeDoc({ id: 'd1', title: '왜?', content: '옛 내용\n' })
    const plan = planVaultImport({
      scan,
      target: { kind: 'top' },
      docs: [existing],
      folders: [],
      attachments: new Map(),
      storeKind: 'idb',
    })
    expect(plan.counts.updated).toBe(1)
    expect(plan.counts.created).toBe(0)
  })

  it('제목 그대로 키(2단계) — 101자 제목도 맞는다', async () => {
    const longTitle = 'a'.repeat(101)
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: `v/${longTitle}.md`, text: '새 내용\n' }])
    const existing = makeDoc({ id: 'd1', title: longTitle, content: '옛 내용\n' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(plan.counts.updated).toBe(1)
  })

  it('T 밖 문서·공유받은 문서는 안 맞는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/문서.md', text: '내용\n' }])
    const outside = makeDoc({ id: 'd1', title: '문서', folderId: 'other', content: '옛\n' })
    const shared = makeDoc({ id: 'd2', title: '문서', role: 'edit', content: '옛\n' })
    const plan = planVaultImport({
      scan,
      target: { kind: 'top' },
      docs: [outside, shared],
      folders: [makeFolder({ id: 'other', name: '다른' })],
      attachments: new Map(),
      storeKind: 'idb',
    })
    expect(plan.counts.created).toBe(1)
    expect(plan.counts.updated).toBe(0)
  })

  it('문서 없는 볼트 디렉터리는 폴더를 만들지 않는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/a.md', text: 'x\n' },
      { name: 'v/빈폴더/그림.png', bytes: PNG_1PX },
    ])
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect([...plan.folders.keys()]).not.toContain('빈폴더')
  })

  it('top 이면 폴더 안 문서도 매칭 대상(같은 폴더 구조가 있으면 맞는다)', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/아무데나/문서.md', text: '새 내용\n' }])
    const existing = makeDoc({ id: 'd1', title: '문서', folderId: 'f1', content: '옛 내용\n' })
    const plan = planVaultImport({
      scan,
      target: { kind: 'top' },
      docs: [existing],
      folders: [makeFolder({ id: 'f1', name: '아무데나' })],
      attachments: new Map(),
      storeKind: 'idb',
    })
    expect(plan.counts.updated).toBe(1)
  })
})

describe('planVaultImport — 7.6 판정 (F-2019.md U11)', () => {
  it('CRLF 기존 문서 ↔ LF 볼트 파일이 같은 내용이면 skip', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/문서.md', text: '한 줄\n두 줄\n' }])
    const existing = makeDoc({ id: 'd1', title: '문서', content: '한 줄\r\n두 줄\r\n', lineEnding: 'crlf' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(plan.counts.skipped).toBe(1)
    expect(plan.counts.updated).toBe(0)
  })

  it('다르면 update', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/문서.md', text: '새 줄\n' }])
    const existing = makeDoc({ id: 'd1', title: '문서', content: '옛 줄\n' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(plan.counts.updated).toBe(1)
  })

  it('대소문자만 다른 이름은 제목을 바꾸고 update', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/ABC.md', text: '내용\n' }])
    const existing = makeDoc({ id: 'd1', title: 'abc', content: '내용\n' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(plan.counts.updated).toBe(1)
    const j = plan.judgements.find((x) => x.action === 'update')!
    expect((j as { title: string }).title).toBe('ABC')
  })

  it('볼트에 없는 T 안 문서는 경고로 남는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/문서.md', text: '내용\n' }])
    const existing = makeDoc({ id: 'd1', title: '다른문서', content: '내용\n' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(plan.warnings).toContain('볼트에 없어 그대로 둔 문서 1개')
  })

  it('넣을 폴더를 바꾸면 counts 가 바뀐다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/문서.md', text: '내용\n' }])
    const existing = makeDoc({ id: 'd1', title: '문서', content: '내용\n' })
    const planTop = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(planTop.counts.skipped).toBe(1)
    const planNew = planVaultImport({ scan, target: { kind: 'new' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(planNew.counts.created).toBe(1)
    expect(planNew.counts.skipped).toBe(0)
  })
})

describe('planVaultImport — 7.5 이미지 블록 값 (F-2019.md U12)', () => {
  it('기존 블록의 align·alt·ext 를 이어받고, 볼트 caption 이 이기고 width 는 볼트 쪽', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/문서.md', text: '![[그림.png|새설명|250]]\n' },
      { name: 'v/그림.png', bytes: PNG_1PX },
    ])
    // 볼트 이미지의 attachmentId 는 내용 해시라 id 와 다르다 — 기존 문서 쪽에 그 해시로 된 블록을 만들어 이어받게 한다
    const hash = scan.images[0].attachmentId!
    const existingBlock = buildImageBlock({ id: hash, ext: 'jpg', alt: '옛설명', width: 100, align: 'center' })
    const existing = makeDoc({ id: 'd1', title: '문서', content: `${existingBlock}\n` })
    const plan = planVaultImport({
      scan,
      target: { kind: 'top' },
      docs: [existing],
      folders: [],
      attachments: new Map([[hash, 'jpg' as AttachmentExt]]),
      storeKind: 'idb',
    })
    const finalText = plan.finalContentByPath.get('문서.md')!
    expect(finalText).toContain('align="center"')
    expect(finalText).toContain('alt="새설명"')
    expect(finalText).toContain('width="250"')
    expect(finalText).toContain(`${hash}.jpg`)
  })

  it('listAttachments 에 없고 기존 블록으로만 아는 id 는 올리지 않는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/문서.md', text: '![[그림.png]]\n' },
      { name: 'v/그림.png', bytes: PNG_1PX },
    ])
    const hash = scan.images[0].attachmentId!
    const existingBlock = buildImageBlock({ id: hash, ext: 'png', alt: 'x', align: 'left' })
    const existing = makeDoc({ id: 'd1', title: '문서', content: `${existingBlock}\n` })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(plan.counts.images).toBe(0)
  })

  it('caption 도 없고 이어받을 블록도 없으면 alt 는 파일 이름에서 확장자만 뗀 것', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/문서.md', text: '![[그림.png]]\n' },
      { name: 'v/그림.png', bytes: PNG_1PX },
    ])
    const plan = planVaultImport({
      scan,
      target: { kind: 'top' },
      docs: [],
      folders: [],
      attachments: new Map(),
      storeKind: 'idb',
    })
    const finalText = plan.finalContentByPath.get('문서.md')!
    expect(finalText).toContain('alt="그림"')
  })

  it('왕복 — F-2020 실물로 내보낸 볼트를 다시 계획하면 skip', async () => {
    const id = '0f3a9c2e7b1d4a58'
    const b1 = buildImageBlock({ id, ext: 'png', alt: '고양이', width: 300, align: 'center' })
    const b2 = buildImageBlock({ id: '1111111111111111', ext: 'jpg', alt: 'x' })
    const content = `# 문서\n\n${b1}\n\n글\n\n${b2}\n`
    const doc = makeDoc({ id: 'd1', title: '문서', content, updatedAt: 5, createdAt: 5 })
    const exportPlan = planVaultExport({ docs: [doc], folders: [], scope: { kind: 'all' }, now: 1000 })
    const { text: vaultText } = toVaultMarkdown(doc.content, doc.folderId, exportPlan.links)
    expect(vaultText).toContain(`![[${id}.png|300]]`)

    const scan = await scanVault({
      root: { kind: 'zip', fileName: 'v.zip' },
      entries: entriesOf([
        { name: 'v/문서.md', text: vaultText },
        { name: `v/attachments/${id}.png`, bytes: PNG_1PX },
        { name: 'v/attachments/1111111111111111.jpg', bytes: JPEG_1PX },
      ]),
    })
    const plan = planVaultImport({
      scan,
      target: { kind: 'top' },
      docs: [doc],
      folders: [],
      attachments: new Map([
        [id, 'png' as AttachmentExt],
        ['1111111111111111', 'jpg' as AttachmentExt],
      ]),
      storeKind: 'idb',
    })
    expect(plan.counts.skipped).toBe(1)
    expect(plan.counts.updated).toBe(0)
  })
})

describe('planVaultImport — 7.7 경고 (F-2019.md U13)', () => {
  it('경고 문구·순서', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/../evil.md', text: '악' },
      { name: 'v/메모.txt', text: 'x' },
      { name: 'v/a.md', text: '![[없는거.png]]\n' },
    ])
    const existing = makeDoc({ id: 'd1', title: '남는문서', content: '내용\n' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(plan.warnings[0]).toBe('경로가 이상해 건너뛴 파일 1개')
    expect(plan.warnings).toContain('.md 가 아니라 건너뛴 파일 1개')
    expect(plan.warnings).toContain('원문 그대로 둔 이미지·임베드 1개')
    expect(plan.warnings).toContain('볼트에 없어 그대로 둔 문서 1개')
  })

  it('서버가 아니면 1MB·공간 경고를 내지 않는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/a.md', text: 'x\n' }])
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [], folders: [], attachments: new Map(), storeKind: 'idb', remainingBytes: 0 })
    expect(plan.warnings.some((w) => w.includes('1MB'))).toBe(false)
    expect(plan.warnings.some((w) => w.includes('저장 공간'))).toBe(false)
  })
})

describe('applyVaultImport (F-2019.md 9장 U14)', () => {
  function fakeStore(): ApplyVaultStore & { calls: string[]; docs: Map<string, Doc>; atts: Map<string, AttachmentExt> } {
    const calls: string[] = []
    const docs = new Map<string, Doc>()
    const atts = new Map<string, AttachmentExt>()
    let seq = 0
    return {
      calls,
      docs,
      atts,
      kind: 'idb',
      async create(input) {
        calls.push('create')
        seq++
        const doc = makeDoc({ id: `new-${seq}`, title: input.title, content: input.content, lineEnding: input.lineEnding, folderId: input.folderId ?? null })
        docs.set(doc.id, doc)
        return doc
      },
      async update(id, patch) {
        calls.push('update')
        const existing = docs.get(id)!
        // 실제 idbStore 처럼 patch 에 title 키가 없으면(undefined 라도 키가 있으면 다름) 제목을 바꾸지 않는다
        const updated = { ...existing, ...('title' in patch ? { title: patch.title as string } : {}), ...('content' in patch ? { content: patch.content as string } : {}) }
        docs.set(id, updated)
        return updated
      },
      async get(id) {
        return docs.get(id) ?? null
      },
      async createFolder(input) {
        calls.push('createFolder')
        seq++
        return makeFolder({ id: `folder-${seq}`, name: input.name, parentId: input.parentId ?? null })
      },
      async putAttachment(input) {
        calls.push('putAttachment')
        atts.set(input.id!, input.ext)
        return { id: input.id!, ext: input.ext }
      },
    }
  }

  it('순서 — 새 폴더 → 폴더 → putAttachment → create → update', async () => {
    const scan = await scanFrom({ kind: 'folder' }, [
      { name: '내볼트/a.md', text: '![[그림.png]]\n' },
      { name: '내볼트/그림.png', bytes: PNG_1PX },
    ])
    const plan = planVaultImport({ scan, target: { kind: 'new' }, docs: [], folders: [], attachments: new Map(), storeKind: 'idb' })
    const store = fakeStore()
    const result = await applyVaultImport({
      plan,
      scan,
      entries: entriesOf([{ name: '내볼트/그림.png', bytes: PNG_1PX }]),
      store,
    })
    expect(store.calls[0]).toBe('createFolder')
    expect(store.calls.slice(1)).toEqual(['putAttachment', 'create'])
    expect(result.createdCount).toBe(1)
  })

  it('update 는 사본을 먼저 만들고 기존 lineEnding 을 유지한다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/문서.md', text: '새 내용\n' }])
    const existing = makeDoc({ id: 'd1', title: '문서', content: '옛 내용\r\n', lineEnding: 'crlf' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    const store = fakeStore()
    store.docs.set('d1', existing)
    const result = await applyVaultImport({ plan, scan, entries: entriesOf([]), store })
    expect(store.calls).toEqual(['create', 'update'])
    expect(result.updatedCount).toBe(1)
    const updated = store.docs.get('d1')!
    expect(updated.content).toBe('새 내용\r\n')
  })

  it('제목을 안 바꾸는 update 는 title 키를 아예 안 보낸다 — 값을 undefined 로 보내면 일부 저장소가 제목을 지운다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/문서.md', text: '새 내용\n' }])
    const existing = makeDoc({ id: 'd1', title: '문서', content: '옛 내용\n' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    const store = fakeStore()
    store.docs.set('d1', existing)
    await applyVaultImport({ plan, scan, entries: entriesOf([]), store })
    expect(store.docs.get('d1')!.title).toBe('문서')
  })

  it('폴더 만들기 실패는 가장 가까운 성공한 조상으로', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [{ name: 'v/하위/a.md', text: 'x\n' }])
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [], folders: [], attachments: new Map(), storeKind: 'idb' })
    const store = fakeStore()
    let failOnce = true
    const origCreateFolder = store.createFolder.bind(store)
    store.createFolder = async (input) => {
      if (failOnce) {
        failOnce = false
        throw new Error('fail')
      }
      return origCreateFolder(input)
    }
    const result = await applyVaultImport({ plan, scan, entries: entriesOf([]), store })
    expect(result.failures.some((f) => f.includes('폴더를 만들지 못했습니다'))).toBe(true)
    expect(result.createdCount).toBe(1)
  })

  it('취소하면 이미 올린 이미지는 남고 나머지는 처리하지 않는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/a.md', text: '내용a\n' },
      { name: 'v/b.md', text: '내용b\n' },
    ])
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [], folders: [], attachments: new Map(), storeKind: 'idb' })
    const store = fakeStore()
    let calls = 0
    const result = await applyVaultImport({
      plan,
      scan,
      entries: entriesOf([]),
      store,
      isCancelled: () => {
        calls++
        return calls > 1
      },
    })
    expect(result.cancelled).toBe(true)
  })
})

describe('vaultUploadNames', () => {
  it('올릴 이미지의 원래 이름 집합', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/a.md', text: '![[그림.png]]\n' },
      { name: 'v/그림.png', bytes: PNG_1PX },
    ])
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(vaultUploadNames(plan)).toEqual(new Set(['v/그림.png']))
  })
})

describe('수렴 (F-2019.md U16)', () => {
  it('같은 볼트를 두 번 적용하면 두 번째는 created 0 · updated 0 · images 0', async () => {
    const scan = await scanFrom({ kind: 'folder' }, [
      { name: '내볼트/a.md', text: '# a\n\n![[Pasted image 1.png]]\n' },
      { name: '내볼트/Pasted image 1.png', bytes: PNG_1PX },
    ])
    function fakeStore(): ApplyVaultStore & { docs: Map<string, Doc>; atts: Map<string, AttachmentExt> } {
      const docs = new Map<string, Doc>()
      const atts = new Map<string, AttachmentExt>()
      let seq = 0
      return {
        docs,
        atts,
        kind: 'idb',
        async create(input) {
          seq++
          const doc = makeDoc({ id: `new-${seq}`, title: input.title, content: input.content, lineEnding: input.lineEnding, folderId: input.folderId ?? null })
          docs.set(doc.id, doc)
          return doc
        },
        async update(id, patch) {
          const existing = docs.get(id)!
          const updated = { ...existing, ...('title' in patch ? { title: patch.title as string } : {}), ...('content' in patch ? { content: patch.content as string } : {}) }
          docs.set(id, updated)
          return updated
        },
        async get(id) {
          return docs.get(id) ?? null
        },
        async createFolder(input) {
          seq++
          return makeFolder({ id: `folder-${seq}`, name: input.name, parentId: input.parentId ?? null })
        },
        async putAttachment(input) {
          if (!atts.has(input.id!)) atts.set(input.id!, input.ext)
          return { id: input.id!, ext: atts.get(input.id!)! }
        },
      }
    }
    const store = fakeStore()

    const plan1 = planVaultImport({ scan, target: { kind: 'new' }, docs: [], folders: [], attachments: new Map(), storeKind: 'idb' })
    await applyVaultImport({
      plan: plan1,
      scan,
      entries: entriesOf([{ name: '내볼트/Pasted image 1.png', bytes: PNG_1PX }]),
      store,
    })

    const currentDocs = [...store.docs.values()]
    const currentFolders: Folder[] = [{ id: 'folder-1', name: '내볼트', parentId: null, createdAt: 1, updatedAt: 1 }]
    const plan2 = planVaultImport({
      scan,
      target: { kind: 'folder', folderId: 'folder-1' },
      docs: currentDocs,
      folders: currentFolders,
      attachments: new Map([...store.atts.entries()]),
      storeKind: 'idb',
    })
    expect(plan2.counts.created).toBe(0)
    expect(plan2.counts.updated).toBe(0)
    expect(plan2.counts.images).toBe(0)
    expect(plan2.counts.skipped).toBe(1)
  })
})

describe('planVaultImport — 7.8 링크 되돌리기 (F-2019.md U19)', () => {
  it('[[a|a]] 는 [[a]] 로 접는다', async () => {
    const scan = await scanFrom({ kind: 'zip', fileName: 'v.zip' }, [
      { name: 'v/문서.md', text: '[[a|a]]\n' },
      { name: 'v/a.md', text: 'A\n' },
    ])
    const existing = makeDoc({ id: 'd1', title: 'a', content: 'A\n' })
    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: [existing], folders: [], attachments: new Map(), storeKind: 'idb' })
    expect(plan.finalContentByPath.get('문서.md')).toBe('[[a]]\n')
  })

  it('왕복 — F-2020 실물로 내보낸 볼트(경로 붙은 링크)를 top 에 계획하면 skip 으로 돌아온다', async () => {
    const 왜 = makeDoc({ id: 'd-why', title: '왜?', content: '내용\n', updatedAt: 10, createdAt: 10 })
    const folderA = makeFolder({ id: 'fa', name: '교안' })
    const folderB = makeFolder({ id: 'fb', name: '과제' })
    const 회의록A = makeDoc({ id: 'd-a', title: '회의록', folderId: 'fa', content: '내용A\n', updatedAt: 20, createdAt: 20 })
    // 7.8 표 2행 — 같은 이름이 둘이라 내보낼 때 경로가 붙는다(교안/회의록·과제/회의록)
    const 회의록B = makeDoc({ id: 'd-b', title: '회의록', folderId: 'fb', content: '내용B\n', updatedAt: 15, createdAt: 15 })
    const 목차 = makeDoc({
      id: 'd-idx',
      title: '목차',
      folderId: 'fa',
      content: '[[왜?]]\n[[회의록]]\n',
      updatedAt: 30,
      createdAt: 30,
    })
    const allDocs = [왜, 회의록A, 회의록B, 목차]
    const allFolders = [folderA, folderB]

    const exportPlan = planVaultExport({ docs: allDocs, folders: allFolders, scope: { kind: 'all' }, now: 1000 })
    const converted = new Map(exportPlan.docs.map(({ doc }) => [doc.id, toVaultMarkdown(doc.content, doc.folderId, exportPlan.links).text]))
    expect(converted.get('d-idx')).toContain('[[왜_|왜?]]')
    expect(converted.get('d-idx')).toContain('[[교안/회의록|회의록]]')

    const entries: Array<{ name: string; text: string }> = exportPlan.docs.map(({ doc, path }) => ({ name: `v/${path}`, text: converted.get(doc.id)! }))
    const scan = await scanVault({ root: { kind: 'zip', fileName: 'v.zip' }, entries: entriesOf(entries) })

    const plan = planVaultImport({ scan, target: { kind: 'top' }, docs: allDocs, folders: allFolders, attachments: new Map(), storeKind: 'idb' })
    expect(plan.counts.skipped).toBe(4) // 왜?, 교안/회의록, 과제/회의록, 교안/목차 — 링크가 원래 모양으로 되돌아온다
    expect(plan.counts.updated).toBe(0)
    expect(plan.counts.created).toBe(0)
  })
})
