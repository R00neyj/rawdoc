// F-281.md 5장 A1~A9 — 전체·폴더 내보내기 계획·스트리밍 zip 단위 테스트
// F-409 9.1 U7~U9·U14 — 금고 문서 빼기·알림·금고 첨부 거르기
import { describe, it, expect, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { planWorkspaceExport, exportWorkspace, selectExportScope, downloadWorkspaceExport, type WorkspaceExportStore, type WorkspaceExportSourceStore } from './exportWorkspace'
import { fromEditorText } from '../lib/lineEnding'
import type { Doc, Folder } from '../types'

vi.mock('./exportDoc', () => ({ downloadBlob: vi.fn() }))

const NOW = 1789000000000

function doc(partial: Partial<Doc> & { id: string; title: string }): Doc {
  return {
    content: '본문\n',
    lineEnding: 'lf',
    createdAt: 1000,
    updatedAt: 1000,
    folderId: null,
    pinnedAt: null,
    ...partial,
  }
}

function folder(partial: Partial<Folder> & { id: string; name: string }): Folder {
  return {
    parentId: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  }
}

describe('planWorkspaceExport (F-281 A1)', () => {
  it('owner 이거나 role 없는 문서만 담고, edit·view 는 뺀다', () => {
    const docs = [
      doc({ id: 'd1', title: '내 문서', role: 'owner' }),
      doc({ id: 'd2', title: '로컬 문서' }), // role 없음
      doc({ id: 'd3', title: '공유받음(편집)', role: 'edit' }),
      doc({ id: 'd4', title: '공유받음(보기)', role: 'view' }),
    ]
    const plan = planWorkspaceExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const ids = plan.directories.flatMap((d) => d.docs.map((x) => x.doc.id))
    expect(ids.sort()).toEqual(['d1', 'd2'])
    const manifestIds = plan.manifest.docs.map((d) => d.id).sort()
    expect(manifestIds).toEqual(['d1', 'd2'])
  })
})

describe('planWorkspaceExport (F-281 A2) zip 경로', () => {
  it('최상위 + 폴더 + 하위 폴더 경로가 규칙대로 나온다', () => {
    const folders = [
      folder({ id: 'f1', name: '폴더' }),
      folder({ id: 'f2', name: '하위', parentId: 'f1' }),
    ]
    const docs = [
      doc({ id: 'd1', title: '루트문서', createdAt: 1 }),
      doc({ id: 'd2', title: '폴더문서', folderId: 'f1', createdAt: 2 }),
      doc({ id: 'd3', title: '하위문서', folderId: 'f2', createdAt: 3 }),
    ]
    const plan = planWorkspaceExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
    const paths = new Map(plan.directories.flatMap((d) => d.docs.map((x) => [x.doc.id, x.path] as const)))
    expect(paths.get('d1')).toBe('루트문서.md')
    expect(paths.get('d2')).toBe('폴더/폴더문서.md')
    expect(paths.get('d3')).toBe('폴더/하위/하위문서.md')
  })
})

describe('planWorkspaceExport (F-281 A3) 이름 충돌', () => {
  it('같은 제목 문서 3개 → (2)(3), 대소문자만 다른 것도 충돌, 폴더 attachments 예약어', () => {
    const folders = [folder({ id: 'f1', name: 'attachments' })]
    const docs = [
      doc({ id: 'd1', title: '이름', createdAt: 1 }),
      doc({ id: 'd2', title: '이름', createdAt: 2 }),
      doc({ id: 'd3', title: '이름', createdAt: 3 }),
      doc({ id: 'd4', title: 'ABC', createdAt: 4 }),
      doc({ id: 'd5', title: 'abc', createdAt: 5 }),
    ]
    const plan = planWorkspaceExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
    const paths = new Map(plan.directories.flatMap((d) => d.docs.map((x) => [x.doc.id, x.path] as const)))
    expect(paths.get('d1')).toBe('이름.md')
    expect(paths.get('d2')).toBe('이름 (2).md')
    expect(paths.get('d3')).toBe('이름 (3).md')
    expect(paths.get('d4')).toBe('ABC.md')
    expect(paths.get('d5')).toBe('abc (2).md')

    const folderPath = plan.manifest.folders.find((f) => f.id === 'f1')?.path
    expect(folderPath).toBe('attachments (2)')
  })
})

describe('exportWorkspace (F-281 A4) .md 바이트', () => {
  it('CRLF·LF 문서 바이트가 fromEditorText 인코딩과 같다. BOM 없음', async () => {
    const docs = [
      doc({ id: 'd1', title: '문서1', content: '첫\n\n둘\n', lineEnding: 'crlf', createdAt: 1 }),
      doc({ id: 'd2', title: '문서2', content: '셋\n넷\n', lineEnding: 'lf', createdAt: 2 }),
    ]
    const plan = planWorkspaceExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const store: WorkspaceExportStore = { getAttachment: async () => null }
    const result = await exportWorkspace({ plan, store })
    const unzipped = unzipSync(result.bytes)

    expect(unzipped['문서1.md']).toEqual(new TextEncoder().encode(fromEditorText('첫\n\n둘\n', 'crlf')))
    expect(unzipped['문서2.md']).toEqual(new TextEncoder().encode(fromEditorText('셋\n넷\n', 'lf')))
    // BOM 없음
    expect(unzipped['문서1.md'][0]).not.toBe(0xef)
  })
})

describe('planWorkspaceExport (F-281 A5) manifest.json', () => {
  it('format·필수 필드·docs[].path 가 zip 항목과 같고, 빈 폴더도 folders 에 있고 부모가 먼저다', async () => {
    const folders = [
      folder({ id: 'f1', name: '폴더' }),
      folder({ id: 'f2', name: '빈폴더', parentId: 'f1' }),
    ]
    const docs = [doc({ id: 'd1', title: '문서', folderId: 'f1', createdAt: 1 })]
    const plan = planWorkspaceExport({ docs, folders, scope: { kind: 'all' }, now: NOW })

    expect(plan.manifest.format).toBe(1)
    expect(plan.manifest.scope).toBe('all')
    expect(plan.manifest.rootFolderId).toBeNull()
    expect(typeof plan.manifest.exportedAt).toBe('number')

    const store: WorkspaceExportStore = { getAttachment: async () => null }
    const result = await exportWorkspace({ plan, store })
    const unzipped = unzipSync(result.bytes)
    const entryNames = new Set(Object.keys(unzipped))

    for (const d of plan.manifest.docs) {
      expect(entryNames.has(d.path)).toBe(true)
    }
    expect(plan.manifest.folders.map((f) => f.id)).toEqual(['f1', 'f2']) // 부모 먼저
    expect(plan.manifest.folders.some((f) => f.id === 'f2')).toBe(true) // 빈 폴더도 있다
  })
})

describe('exportWorkspace (F-281 A6) 이미지 복사', () => {
  it('같은 id 를 두 폴더가 쓰면 각 폴더에 한 번씩, 한 폴더 안 중복은 한 번만', async () => {
    const id = '0f3a9c2e7b1d4a58'
    const imgText = `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n`
    const folders = [folder({ id: 'fA', name: 'A' }), folder({ id: 'fB', name: 'B' })]
    const docs = [
      doc({ id: 'd1', title: '문서1', folderId: 'fA', content: imgText, createdAt: 1 }),
      doc({ id: 'd2', title: '문서2', folderId: 'fA', content: imgText, createdAt: 2 }),
      doc({ id: 'd3', title: '문서3', folderId: 'fB', content: imgText, createdAt: 3 }),
    ]
    const plan = planWorkspaceExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
    const store: WorkspaceExportStore = {
      getAttachment: async (attId) =>
        attId === id ? { id, ext: 'png', blob: new Blob([new Uint8Array([1, 2, 3])]) } : null,
    }
    const result = await exportWorkspace({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(Array.from(unzipped[`A/attachments/${id}.png`])).toEqual([1, 2, 3])
    expect(Array.from(unzipped[`B/attachments/${id}.png`])).toEqual([1, 2, 3])
    expect(result.missingCount).toBe(0)
  })
})

describe('exportWorkspace (F-281 A7) 없는 첨부', () => {
  it('null 인 첨부는 빠지고 missingCount 는 서로 다른 id 개수다', async () => {
    const idOk = '0f3a9c2e7b1d4a58'
    const idMissing1 = '1111111111111111'
    const idMissing2 = '2222222222222222'
    const textOf = (id: string) => `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n`
    const folders = [folder({ id: 'fA', name: 'A' }), folder({ id: 'fB', name: 'B' })]
    const docs = [
      doc({ id: 'd1', title: '문서1', folderId: 'fA', content: textOf(idOk) + textOf(idMissing1), createdAt: 1 }),
      doc({ id: 'd2', title: '문서2', folderId: 'fB', content: textOf(idMissing1) + textOf(idMissing2), createdAt: 2 }),
    ]
    const plan = planWorkspaceExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
    const store: WorkspaceExportStore = {
      getAttachment: async (attId) =>
        attId === idOk ? { id: idOk, ext: 'png', blob: new Blob([new Uint8Array([9])]) } : null,
    }
    const result = await exportWorkspace({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(unzipped[`A/attachments/${idOk}.png`]).toBeTruthy()
    expect(unzipped[`A/attachments/${idMissing1}.png`]).toBeUndefined()
    expect(unzipped[`B/attachments/${idMissing1}.png`]).toBeUndefined()
    expect(unzipped[`B/attachments/${idMissing2}.png`]).toBeUndefined()
    expect(result.missingCount).toBe(2)
  })
})

describe('planWorkspaceExport (F-281 A8) 폴더 범위', () => {
  it('scope: folder — 그 폴더가 zip 루트, 바깥 문서·폴더는 없다', () => {
    const folders = [
      folder({ id: 'outside', name: '바깥' }),
      folder({ id: 'f1', name: '대상' }),
      folder({ id: 'f1sub', name: '하위', parentId: 'f1' }),
    ]
    const docs = [
      doc({ id: 'outDoc', title: '바깥문서', folderId: 'outside', createdAt: 1 }),
      doc({ id: 'd1', title: '루트문서', folderId: 'f1', createdAt: 2 }),
      doc({ id: 'd2', title: '하위문서', folderId: 'f1sub', createdAt: 3 }),
    ]
    const plan = planWorkspaceExport({ docs, folders, scope: { kind: 'folder', folderId: 'f1' }, now: NOW })

    expect(plan.manifest.scope).toBe('folder')
    expect(plan.manifest.rootFolderId).toBe('f1')
    expect(plan.manifest.folders.map((f) => f.id)).toEqual(['f1sub'])

    const paths = new Map(plan.directories.flatMap((d) => d.docs.map((x) => [x.doc.id, x.path] as const)))
    expect(paths.get('d1')).toBe('루트문서.md')
    expect(paths.get('d2')).toBe('하위/하위문서.md')
    expect(paths.has('outDoc')).toBe(false)
  })
})

describe('F-409 U7 selectExportScope 잠긴 문서 빼기', () => {
  it('전체 범위 — 잠긴 내 문서만 빠지고 lockedCount, 공유받은 잠긴 문서는 세지 않는다', () => {
    const docs = [
      doc({ id: 'd1', title: '내문서' }),
      doc({ id: 'locked', title: '', content: '', e2ee: 'locked' }),
      doc({ id: 'sharedLocked', title: '', content: '', e2ee: 'locked', role: 'view' }),
    ]
    const result = selectExportScope(docs, [], { kind: 'all' })
    expect(result.docs.map((d) => d.id)).toEqual(['d1'])
    expect(result.lockedCount).toBe(1)
  })

  it('폴더 범위 — 범위 밖 잠긴 문서는 안 센다, 금고 폴더는 folders 에 남는다', () => {
    const folders = [
      folder({ id: 'vault', name: '금고폴더', e2ee: true }),
      folder({ id: 'other', name: '다른폴더' }),
    ]
    const docs = [
      doc({ id: 'locked-in', title: '', content: '', e2ee: 'locked', folderId: 'vault' }),
      doc({ id: 'locked-out', title: '', content: '', e2ee: 'locked', folderId: 'other' }),
    ]
    const result = selectExportScope(docs, folders, { kind: 'folder', folderId: 'vault' })
    expect(result.docs).toEqual([])
    expect(result.lockedCount).toBe(1)
    expect(result.folders.map((f) => f.id)).toEqual([])
  })
})

describe('F-409 U8 planWorkspaceExport·exportWorkspace 열린 금고 문서', () => {
  it('평문으로 들어가고 manifest 에도 있다. 잠긴 문서는 어디에도 없다', async () => {
    const docs = [
      doc({ id: 'open', title: '비밀 제목', content: '비밀 본문', lineEnding: 'crlf', e2ee: 'open' }),
      doc({ id: 'locked', title: '', content: '', e2ee: 'locked' }),
    ]
    const plan = planWorkspaceExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    expect(plan.lockedCount).toBe(1)
    expect(plan.manifest.docs.map((d) => d.id)).toEqual(['open'])

    const store: WorkspaceExportStore = { getAttachment: async () => null }
    const result = await exportWorkspace({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(unzipped['비밀 제목.md']).toEqual(new TextEncoder().encode(fromEditorText('비밀 본문', 'crlf')))
    expect(Object.keys(unzipped)).not.toContain('제목 없음.md')
  })
})

describe('F-409 U9 downloadWorkspaceExport 알림', () => {
  function storeOf(docs: Doc[], folders: Folder[] = []): WorkspaceExportSourceStore {
    return {
      list: async () => docs,
      listFolders: async () => folders,
      getAttachment: async () => null,
    }
  }

  it('0개 + 잠김 → E32 하나만', async () => {
    const notices: Array<{ type: string; message: string }> = []
    await downloadWorkspaceExport({
      store: storeOf([doc({ id: 'locked', title: '', content: '', e2ee: 'locked' })]),
      scope: { kind: 'all' },
      now: NOW,
      onNotice: (n) => notices.push(n),
    })
    expect(notices).toEqual([{ type: 'warn', message: '금고가 잠겨 있어 내보낼 문서가 없습니다. 금고를 연 뒤 다시 해 주세요.' }])
  })

  it('0개, 잠김 없음 → 지금 그대로 info', async () => {
    const notices: Array<{ type: string; message: string }> = []
    await downloadWorkspaceExport({
      store: storeOf([]),
      scope: { kind: 'all' },
      now: NOW,
      onNotice: (n) => notices.push(n),
    })
    expect(notices).toEqual([{ type: 'info', message: '내보낼 문서가 없습니다.' }])
  })

  it('내보냄, 잠김 있음, 누락 0 → 성공 info 뒤 warn S3', async () => {
    const notices: Array<{ type: string; message: string }> = []
    await downloadWorkspaceExport({
      store: storeOf([
        doc({ id: 'd1', title: '문서' }),
        doc({ id: 'locked', title: '', content: '', e2ee: 'locked' }),
      ]),
      scope: { kind: 'all' },
      now: NOW,
      onNotice: (n) => notices.push(n),
    })
    expect(notices).toEqual([
      { type: 'info', message: '문서 1개를 내보냈습니다.' },
      { type: 'warn', message: '금고가 잠겨 있어 금고 문서 1개는 빼고 내보냈습니다.' },
    ])
  })

  it('내보냄, 잠김 있음, 누락 K>0 → warn 하나로 합친다(E31)', async () => {
    const notices: Array<{ type: string; message: string }> = []
    const id = '0f3a9c2e7b1d4a58'
    await downloadWorkspaceExport({
      store: {
        list: async () => [
          doc({ id: 'd1', title: '문서', content: `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n` }),
          doc({ id: 'locked', title: '', content: '', e2ee: 'locked' }),
        ],
        listFolders: async () => [],
        getAttachment: async () => null,
      },
      scope: { kind: 'all' },
      now: NOW,
      onNotice: (n) => notices.push(n),
    })
    expect(notices).toEqual([
      { type: 'info', message: '문서 1개를 내보냈습니다.' },
      { type: 'warn', message: '금고가 잠겨 있어 금고 문서 1개는 빼고 내보냈습니다. 이미지 1개를 찾을 수 없어 빼고 내보냈습니다.' },
    ])
  })

  it('잠김 0 → 지금 알림 배열과 같다(이미지 누락 warn 따로)', async () => {
    const notices: Array<{ type: string; message: string }> = []
    const id = '0f3a9c2e7b1d4a58'
    await downloadWorkspaceExport({
      store: {
        list: async () => [doc({ id: 'd1', title: '문서', content: `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n` })],
        listFolders: async () => [],
        getAttachment: async () => null,
      },
      scope: { kind: 'all' },
      now: NOW,
      onNotice: (n) => notices.push(n),
    })
    expect(notices).toEqual([
      { type: 'info', message: '문서 1개를 내보냈습니다.' },
      { type: 'warn', message: '이미지 1개를 찾을 수 없어 빼고 내보냈습니다.' },
    ])
  })
})

describe('F-409 U14 exportWorkspace 금고 첨부 거르기', () => {
  const id = '0f3a9c2e7b1d4a58'
  const imgText = `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n`

  it('① 일반 문서만 참조하면 빠지고 missingCount 1', async () => {
    const docs = [doc({ id: 'd1', title: '문서1', content: imgText })]
    const plan = planWorkspaceExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const store: WorkspaceExportStore = {
      getAttachment: async (attId) => (attId === id ? { id, ext: 'png', blob: new Blob([new Uint8Array([1])]), e2ee: true } : null),
    }
    const result = await exportWorkspace({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(unzipped[`attachments/${id}.png`]).toBeUndefined()
    expect(result.missingCount).toBe(1)
  })

  it('② 같은 디렉터리의 열린 금고 문서도 참조하면 들어간다', async () => {
    const docs = [
      doc({ id: 'd1', title: '문서1', content: imgText }),
      doc({ id: 'd2', title: '금고문서', content: imgText, e2ee: 'open' }),
    ]
    const plan = planWorkspaceExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const store: WorkspaceExportStore = {
      getAttachment: async (attId) => (attId === id ? { id, ext: 'png', blob: new Blob([new Uint8Array([1])]), e2ee: true } : null),
    }
    const result = await exportWorkspace({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(unzipped[`attachments/${id}.png`]).toBeTruthy()
    expect(result.missingCount).toBe(0)
  })
})

describe('exportWorkspace (F-281 A9) 스트리밍·진행', () => {
  it('end() 전에 이미 출력 조각이 나오고, onProgress 가 순서대로 M 번 불린다', async () => {
    const id = '0f3a9c2e7b1d4a58'
    const docs = [
      doc({ id: 'd1', title: '문서1', createdAt: 1 }),
      doc({ id: 'd2', title: '문서2', createdAt: 2 }),
      doc({
        id: 'd3',
        title: '문서3',
        createdAt: 3,
        content: `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n`,
      }),
    ]
    const plan = planWorkspaceExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })

    let chunkCount = 0
    let chunkCountAtAttachmentRead = -1
    const store: WorkspaceExportStore = {
      getAttachment: async () => {
        chunkCountAtAttachmentRead = chunkCount
        return null
      },
    }
    const progress: Array<{ done: number; total: number }> = []
    const result = await exportWorkspace({
      plan,
      store,
      onProgress: (p) => progress.push(p),
      onChunk: () => {
        chunkCount += 1
      },
    })

    // getAttachment 는 문서 3개를 다 넣은 뒤 불리는데, 그때 이미(manifest.json + 문서 3개 분) 조각이 나와 있다
    expect(chunkCountAtAttachmentRead).toBeGreaterThan(0)
    expect(chunkCount).toBeGreaterThan(0)
    expect(progress).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ])
    expect(result.docCount).toBe(3)
  })
})
