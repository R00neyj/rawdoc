// F-407 U1~U16 (specs/features/F-407.md 9.1) — 계획·비용·글·메뉴 판정은 순수, 실행기는 가짜 저장소·가짜 시계로 돈다
import { describe, expect, it } from 'vitest'
import {
  E2EE_CONVERT_MAX_RATE_RETRIES,
  E2EE_CONVERT_WRITE_GAP_MS,
  attachmentLinksOf,
  buildE2eeConvertDialogText,
  createE2eeConvertMemory,
  e2eeMenuForDoc,
  e2eeMenuForFolder,
  encryptLocalPlainAttachment,
  estimateE2eeConvertCost,
  planE2eeConvert,
  planLocalE2eeMigration,
  rekeyLocalE2eeAttachment,
  rekeyLocalE2eeDoc,
  rewriteAttachmentLinks,
  runE2eeConvert,
  type E2eeConvertDeps,
  type E2eeConvertMemory,
  type E2eeConvertPlan,
  type E2eeConvertProgress,
  type LocalE2eeKeys,
} from './convert'
import { ApiError } from '../storage/docsApi'
import { createDocKey, decryptAttachment, decryptDocField, encryptAttachment, encryptDocField, openDocKey } from './crypto'
import { envelopeBase64Length, utf8ByteLength } from '../lib/e2eeLimits'
import { nextUtcMidnight } from '../lib/usageLimits'
import type { Attachment, AttachmentExt, Doc, Folder, Store } from '../types'

type PlanDoc = Pick<Doc, 'id' | 'folderId' | 'e2ee' | 'content' | 'updatedAt'>
type PlanFolder = Pick<Folder, 'id' | 'parentId' | 'e2ee'>

function pdoc(id: string, folderId: string | null, updatedAt: number, extra: Partial<PlanDoc> = {}): PlanDoc {
  return { id, folderId, updatedAt, content: '', ...extra }
}

function pfolder(id: string, parentId: string | null, e2ee?: true): PlanFolder {
  return e2ee ? { id, parentId, e2ee } : { id, parentId }
}

function attId(n: number): string {
  return n.toString(16).padStart(16, '0')
}

describe('F-407 U1 planE2eeConvert to-e2ee', () => {
  it('가장 깊은 폴더부터, 폴더마다 바로 아래 일반 문서(최근 것 먼저) 뒤 folder-on', () => {
    const folders = [pfolder('A', null), pfolder('B', 'A'), pfolder('C', 'B')]
    const docs = [
      pdoc('a1', 'A', 10),
      pdoc('b1', 'B', 20),
      pdoc('b2', 'B', 30),
      pdoc('c1', 'C', 5),
      pdoc('b3', 'B', 40, { e2ee: 'open' }),
    ]
    const plan = planE2eeConvert({ direction: 'to-e2ee', target: { kind: 'folder', id: 'A' }, docs, folders })
    expect(plan.steps).toEqual([
      { kind: 'doc', id: 'c1' },
      { kind: 'folder-on', id: 'C' },
      { kind: 'doc', id: 'b2' },
      { kind: 'doc', id: 'b1' },
      { kind: 'folder-on', id: 'B' },
      { kind: 'doc', id: 'a1' },
      { kind: 'folder-on', id: 'A' },
    ])
    expect(plan.docCount).toBe(4)
    expect(plan.folderCount).toBe(2)
    expect(plan.blocked).toEqual({ tooLarge: [], tooManyRefs: [] })
  })
})

describe('F-407 U2 planE2eeConvert 이어 옮기기', () => {
  it('이미 금고인 폴더·문서는 계획에 들지 않는다', () => {
    const folders = [pfolder('A', null), pfolder('B', 'A'), pfolder('C', 'B', true)]
    const docs = [
      pdoc('a1', 'A', 10),
      pdoc('b1', 'B', 20),
      pdoc('b2', 'B', 30, { e2ee: 'locked' }),
      pdoc('c1', 'C', 5, { e2ee: 'locked' }),
      pdoc('b3', 'B', 40, { e2ee: 'open' }),
    ]
    const plan = planE2eeConvert({ direction: 'to-e2ee', target: { kind: 'folder', id: 'A' }, docs, folders })
    expect(plan.steps).toEqual([
      { kind: 'doc', id: 'b1' },
      { kind: 'folder-on', id: 'B' },
      { kind: 'doc', id: 'a1' },
      { kind: 'folder-on', id: 'A' },
    ])
    expect(plan.docCount).toBe(2)
  })
})

describe('F-407 U3 planE2eeConvert from-e2ee', () => {
  it('금고 폴더 끄기가 얕은 것부터 문서 단계보다 앞', () => {
    const folders = [pfolder('P', null), pfolder('A', 'P', true), pfolder('B', 'A', true)]
    const docs = [pdoc('a1', 'A', 10, { e2ee: 'open' }), pdoc('b1', 'B', 20, { e2ee: 'open' })]
    const plan = planE2eeConvert({ direction: 'from-e2ee', target: { kind: 'folder', id: 'A' }, docs, folders })
    expect(plan.steps.slice(0, 2)).toEqual([
      { kind: 'folder-off', id: 'A' },
      { kind: 'folder-off', id: 'B' },
    ])
    expect(plan.steps.slice(2).map((s) => s.kind)).toEqual(['doc', 'doc'])
    expect(new Set(plan.steps.slice(2).map((s) => s.id))).toEqual(new Set(['a1', 'b1']))
    expect(plan.docCount).toBe(2)
    expect(plan.folderCount).toBe(1)
  })
})

describe('F-407 U4 planE2eeConvert 이어 빼기', () => {
  it('A 는 이미 일반, B 는 금고 — folder-off B, doc b1', () => {
    const folders = [pfolder('A', null), pfolder('B', 'A', true)]
    const docs = [pdoc('a1', 'A', 10), pdoc('b1', 'B', 20, { e2ee: 'open' })]
    const plan = planE2eeConvert({ direction: 'from-e2ee', target: { kind: 'folder', id: 'A' }, docs, folders })
    expect(plan.steps).toEqual([
      { kind: 'folder-off', id: 'B' },
      { kind: 'doc', id: 'b1' },
    ])
  })
})

describe('F-407 U5 blocked', () => {
  it('749,972 B 는 tooLarge, 749,971 B 는 통과, 첨부 줄 1,001개는 tooManyRefs', () => {
    const big = 'a'.repeat(749_972)
    const edge = 'a'.repeat(749_971)
    const refs = Array.from({ length: 1001 }, (_, i) => `![](attachments/${attId(i + 1)}.png)`).join('\n')
    const docs = [pdoc('big', 'F', 1, { content: big }), pdoc('edge', 'F', 2, { content: edge }), pdoc('refs', 'F', 3, { content: refs })]
    const plan = planE2eeConvert({ direction: 'to-e2ee', target: { kind: 'folder', id: 'F' }, docs, folders: [pfolder('F', null)] })
    expect(plan.blocked.tooLarge).toEqual(['big'])
    expect(plan.blocked.tooManyRefs).toEqual(['refs'])

    const one = planE2eeConvert({ direction: 'to-e2ee', target: { kind: 'doc', id: 'edge' }, docs, folders: [pfolder('F', null)] })
    expect(one.blocked).toEqual({ tooLarge: [], tooManyRefs: [] })
    expect(one.steps).toEqual([{ kind: 'doc', id: 'edge' }])
  })
})

describe('F-407 U6 메뉴 판정', () => {
  const folders = [
    pfolder('plain', null),
    pfolder('outer', null, true),
    pfolder('inner', 'outer', true),
    pfolder('mixed', null),
    pfolder('mixedChild', 'mixed'),
  ]
  const docs = [
    pdoc('d-plain', null, 1),
    pdoc('d-in-plain', 'plain', 1, { e2ee: 'open' }),
    pdoc('d-in-outer', 'outer', 1, { e2ee: 'locked' }),
    pdoc('d-deep', 'mixedChild', 1, { e2ee: 'locked' }),
  ]

  it('문서', () => {
    expect(e2eeMenuForDoc(docs[0], folders)).toEqual({ convert: 'enabled', unconvert: 'hidden' })
    expect(e2eeMenuForDoc(docs[1], folders)).toEqual({ convert: 'hidden', unconvert: 'enabled' })
    expect(e2eeMenuForDoc(docs[2], folders)).toEqual({ convert: 'hidden', unconvert: 'inside-e2ee-folder' })
  })

  it('폴더', () => {
    expect(e2eeMenuForFolder('outer', docs, folders)).toEqual({ convert: 'hidden', unconvert: 'enabled' })
    expect(e2eeMenuForFolder('inner', docs, folders)).toEqual({ convert: 'hidden', unconvert: 'hidden' })
    expect(e2eeMenuForFolder('plain', docs, folders)).toEqual({ convert: 'enabled', unconvert: 'enabled' })
    expect(e2eeMenuForFolder('mixed', docs, folders)).toEqual({ convert: 'enabled', unconvert: 'enabled' })
    expect(e2eeMenuForFolder('mixedChild', docs, folders)).toEqual({ convert: 'enabled', unconvert: 'enabled' })
    expect(e2eeMenuForFolder('mixed', [docs[0]], folders)).toEqual({ convert: 'enabled', unconvert: 'hidden' })
  })
})

describe('F-407 U7 첨부 줄', () => {
  const aa = '00000000000000aa'
  const bb = '00000000000000bb'
  const cc = '00000000000000cc'
  const content = `# 제목\r\n\r\n  ![a](attachments/${aa}.png)  \r\n<img src="attachments/${bb}.webp" width="100">\r\n\t![again](attachments/${aa}.png)\r\n끝 attachments/zz.png\r\n`

  it('attachmentLinksOf — 등장 순서, 중복 없음', () => {
    expect(attachmentLinksOf(content)).toEqual([
      { id: aa, ext: 'png' },
      { id: bb, ext: 'webp' },
    ])
  })

  it('rewriteAttachmentLinks — 두 자리 모두 바뀌고 나머지 글자는 그대로', () => {
    const out = rewriteAttachmentLinks(content, new Map([[aa, { id: cc, ext: 'png' as AttachmentExt }]]))
    expect(out).toBe(content.split(`attachments/${aa}.png`).join(`attachments/${cc}.png`))
    expect(out).not.toContain(aa)
    expect(out.length).toBe(content.length)
    expect(out.match(/\r\n/g)?.length).toBe(content.match(/\r\n/g)?.length)
  })
})

describe('F-407 U8 estimateE2eeConvertCost', () => {
  it('쓰기 = 문서 + 폴더 켜기 + 2 × 서로 다른 평문 첨부, deltaBytes 는 봉투 길이 − 평문', () => {
    const c0 = ''
    const c1 = `${'가'.repeat(33_000)}![](attachments/${attId(1)}.png)`
    const c2 = `![](attachments/${attId(2)}.jpg)${'b'.repeat(749_971 - 41)}![](attachments/${attId(1)}.png)`
    const docs = [pdoc('x', 'F', 3, { content: c0 }), pdoc('y', 'F', 2, { content: c1 }), pdoc('z', 'F', 1, { content: c2 })]
    const plan = planE2eeConvert({ direction: 'to-e2ee', target: { kind: 'folder', id: 'F' }, docs, folders: [pfolder('F', null)] })
    const cost = estimateE2eeConvertCost({ plan, docs })
    expect(cost.writes).toBe(8)
    const expected = [c0, c1, c2].reduce((sum, c) => sum + envelopeBase64Length(utf8ByteLength(c)) - utf8ByteLength(c), 0)
    expect(cost.deltaBytes).toBe(expected)
  })
})

describe('F-407 U9 상수', () => {
  it('600·5', () => {
    expect(E2EE_CONVERT_WRITE_GAP_MS).toBe(600)
    expect(E2EE_CONVERT_MAX_RATE_RETRIES).toBe(5)
  })
})

const D9_BODY = '"메모"을(를) 암호화해 금고에 넣습니다. 공유 링크와 초대는 끊깁니다. 다른 기기에서 열어 둔 편집 중 저장되지 않은 내용은 사라질 수 있습니다.'
const D9_BACKUP = '옮기기 전의 내용은 서버의 자동 백업(장애 복구용)에 최대 30일 남았다가 사라집니다. 백업은 화면에서 볼 수 없고 서버 장애를 되돌릴 때만 씁니다.'
const NO_USAGE = { writesLeft: null, bytesLeft: null }

describe('F-407 U10 D-9 서버 문서', () => {
  it('F-400 문구 그대로, 백업 안내', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'account',
      name: '메모',
      targetKind: 'doc',
      docCount: 1,
      folderCount: 0,
      showBackupNotice: true,
      usage: NO_USAGE,
      cost: { writes: 1, deltaBytes: 10 },
    })
    expect(text).toEqual({ title: '금고로 옮기기', body: D9_BODY, notes: [], backupNotice: D9_BACKUP, confirmLabel: '옮기기' })
  })
})

describe('F-407 U11 로컬·쓰기 모자람·D-10 로컬', () => {
  it('로컬 폴더', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'local',
      name: '폴더',
      targetKind: 'folder',
      docCount: 12,
      folderCount: 0,
      showBackupNotice: true,
      usage: NO_USAGE,
      cost: { writes: 13, deltaBytes: 0 },
    })
    expect(text.body).toBe('"폴더"을(를) 암호화해 이 브라우저의 금고에 넣습니다.')
    expect(text.notes).toEqual(['폴더 안 문서 12개를 함께 옮깁니다.'])
    expect(text.backupNotice).toBeNull()
  })

  it('서버 폴더 — 하루 쓰기가 모자라면 N3 가 끝', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'account',
      name: '큰 폴더',
      targetKind: 'folder',
      docCount: 1000,
      folderCount: 9,
      showBackupNotice: false,
      usage: { writesLeft: 100, bytesLeft: null },
      cost: { writes: 1010, deltaBytes: 0 },
    })
    expect(text.notes[0]).toBe('폴더 안 문서 1,000개와 하위 폴더 9개를 함께 옮깁니다.')
    expect(text.notes.at(-1)).toBe(
      '오늘 남은 저장 횟수(100번)보다 옮기는 데 드는 횟수(약 1,010번)가 많아 중간에 멈출 수 있습니다. 멈추면 다음 날 다시 눌러 이어 옮길 수 있습니다.',
    )
    expect(text.backupNotice).toBeNull()
  })

  it('저장 공간이 모자라면 N2, 빼기는 N3 의 동사가 바뀐다', () => {
    const to = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'account',
      name: 'a',
      targetKind: 'doc',
      docCount: 1,
      folderCount: 0,
      showBackupNotice: false,
      usage: { writesLeft: 10, bytesLeft: 5 },
      cost: { writes: 1, deltaBytes: 6 },
    })
    expect(to.notes).toEqual(['계정의 문서 저장 공간이 모자라 중간에 멈출 수 있습니다. 금고 문서는 암호화로 약 1.34배 커집니다.'])
    const from = buildE2eeConvertDialogText({
      direction: 'from-e2ee',
      scope: 'account',
      name: 'a',
      targetKind: 'folder',
      docCount: 3,
      folderCount: 2,
      showBackupNotice: true,
      usage: { writesLeft: 1, bytesLeft: 0 },
      cost: { writes: 5, deltaBytes: 0 },
    })
    expect(from.notes).toEqual([
      '폴더 안 금고 문서 3개와 금고 폴더 2개를 모두 뺍니다.',
      '오늘 남은 저장 횟수(1번)보다 빼는 데 드는 횟수(약 5번)가 많아 중간에 멈출 수 있습니다. 멈추면 다음 날 다시 눌러 이어 뺄 수 있습니다.',
    ])
    expect(from.backupNotice).toBeNull()
    expect(from.body).toBe('"a"을(를) 복호화해 일반 문서로 저장합니다. 서버가 내용을 읽을 수 있게 됩니다.')
  })

  it('D-10 로컬 문서·폴더', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'from-e2ee',
      scope: 'local',
      name: '비밀',
      targetKind: 'folder',
      docCount: 4,
      folderCount: 0,
      showBackupNotice: true,
      usage: NO_USAGE,
      cost: { writes: 5, deltaBytes: 0 },
    })
    expect(text.title).toBe('금고에서 빼기')
    expect(text.body).toBe('"비밀"을(를) 복호화해 일반 문서로 저장합니다. 이 브라우저에 암호화하지 않은 채 저장됩니다.')
    expect(text.notes).toEqual(['폴더 안 금고 문서 4개를 모두 뺍니다.'])
    expect(text.confirmLabel).toBe('빼기')
  })
})

describe('F-407 U12 빈 제목', () => {
  it('넘긴 이름 그대로', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'local',
      name: '제목 없음',
      targetKind: 'doc',
      docCount: 1,
      folderCount: 0,
      showBackupNotice: false,
      usage: NO_USAGE,
      cost: { writes: 1, deltaBytes: 0 },
    })
    expect(text.body).toBe('"제목 없음"을(를) 암호화해 이 브라우저의 금고에 넣습니다.')
  })
})

// ----- 실행기 (U13~U16) — 가짜 저장소는 앱 층 모양(금고 문서는 e2ee:'open' + 평문) -----

type FakeCall = { name: string; args: unknown[]; at: number }
type ThrowRule = { name: string; id?: string; errors: unknown[] }

function makeFakeRun(init: { docs: Doc[]; folders: Folder[]; attachments?: Array<{ id: string; ext: AttachmentExt; e2ee?: true }> }) {
  let t = 1_000_000
  const docs = new Map(init.docs.map((d) => [d.id, { ...d }]))
  const folders = new Map(init.folders.map((f) => [f.id, { ...f }]))
  const attachments = new Map((init.attachments ?? []).map((a) => [a.id, { ...a }]))
  const calls: FakeCall[] = []
  const sleeps: number[] = []
  const rules: ThrowRule[] = []
  let seq = 0
  let onCall: ((c: FakeCall) => void) | null = null

  function record(name: string, args: unknown[]) {
    const c = { name, args, at: t }
    calls.push(c)
    onCall?.(c)
    const id = typeof args[0] === 'string' ? args[0] : undefined
    const rule = rules.find((r) => r.name === name && (r.id === undefined || r.id === id) && r.errors.length > 0)
    if (rule) throw rule.errors.shift()
  }

  const store = {
    kind: 'server',
    list: async () => [...docs.values()].map((d) => ({ ...d })),
    listFolders: async () => [...folders.values()].map((f) => ({ ...f })),
    get: async (id: string) => {
      const d = docs.get(id)
      return d ? { ...d } : null
    },
    refreshDocFromServer: async (id: string) => {
      record('refreshDocFromServer', [id])
      const d = docs.get(id)
      return d ? { ...d } : null
    },
    hasPendingChanges: async () => false,
    getAttachment: async (id: string): Promise<Attachment | null> => {
      const a = attachments.get(id)
      if (!a) return null
      return { id, ext: a.ext, mime: 'image/png', size: 4, width: 2, height: 2, createdAt: 0, blob: new Blob([new Uint8Array([1, 2, 3, 4])]), ...(a.e2ee ? { e2ee: true as const } : {}) }
    },
    putAttachmentNow: async (input: { ext: AttachmentExt; e2ee?: true }) => {
      record('putAttachmentNow', [input])
      seq += 1
      const id = `ff${seq.toString(16).padStart(14, '0')}`
      attachments.set(id, { id, ext: input.ext, ...(input.e2ee ? { e2ee: true as const } : {}) })
      return { id, ext: input.ext }
    },
    setDocE2ee: async (id: string, input: { e2ee: boolean; title: string; content: string }) => {
      record('setDocE2ee', [id, input])
      const d = docs.get(id)!
      const next: Doc = { ...d, title: input.title, content: input.content }
      if (input.e2ee) next.e2ee = 'open'
      else delete next.e2ee
      docs.set(id, next)
      return { doc: { ...next }, purged: true }
    },
    setFolderE2ee: async (id: string, on: boolean) => {
      record('setFolderE2ee', [id, on])
      const f = folders.get(id)!
      const next: Folder = { ...f }
      if (on) next.e2ee = true
      else delete next.e2ee
      folders.set(id, next)
      return next
    },
    discardAttachment: async (id: string, ext: AttachmentExt) => {
      record('discardAttachment', [id, ext])
      attachments.delete(id)
      return 'deleted' as const
    },
  } as unknown as Store

  const controller = new AbortController()
  const progress: E2eeConvertProgress[] = []
  const yjsRemoved: string[] = []
  const memory: E2eeConvertMemory = createE2eeConvertMemory()

  function deps(overrides: Partial<E2eeConvertDeps> = {}): E2eeConvertDeps {
    return {
      store,
      scope: 'account',
      memory,
      signal: controller.signal,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms)
        t += ms
      },
      isOnline: () => true,
      noteActivity: () => {},
      isOpen: () => true,
      prepareDoc: async () => null,
      finishDoc: () => {},
      hasUnsyncedYjs: async () => false,
      removeYjsRecord: async (id) => {
        yjsRemoved.push(id)
      },
      ...overrides,
    }
  }

  function plan(direction: 'to-e2ee' | 'from-e2ee', target: { kind: 'doc' | 'folder'; id: string }): E2eeConvertPlan {
    return planE2eeConvert({ direction, target, docs: [...docs.values()], folders: [...folders.values()] })
  }

  return {
    store,
    docs,
    folders,
    attachments,
    calls,
    sleeps,
    rules,
    progress,
    yjsRemoved,
    memory,
    controller,
    deps,
    plan,
    onProgress: (p: E2eeConvertProgress) => {
      progress.push(p)
    },
    setOnCall(fn: (c: FakeCall) => void) {
      onCall = fn
    },
    writeCalls: () => calls.filter((c) => c.name !== 'refreshDocFromServer'),
  }
}

function doc(id: string, folderId: string | null, updatedAt: number, content = '', extra: Partial<Doc> = {}): Doc {
  return { id, title: `제목 ${id}`, content, lineEnding: 'lf', createdAt: 0, updatedAt, folderId, pinnedAt: null, ...extra }
}

function folder(id: string, parentId: string | null, e2ee?: true): Folder {
  return { id, name: `폴더 ${id}`, parentId, createdAt: 0, updatedAt: 0, ...(e2ee ? { e2ee } : {}) }
}

const OLD_ATT = '0000000000000001'

function threeDocFolder() {
  return makeFakeRun({
    folders: [folder('F', null)],
    docs: [doc('d1', 'F', 30), doc('d2', 'F', 20, `본문\n![](attachments/${OLD_ATT}.png)\n`), doc('d3', 'F', 10)],
    attachments: [{ id: OLD_ATT, ext: 'png' }],
  })
}

describe('F-407 U13 runE2eeConvert 서버 흐름', () => {
  it('첨부 올리기 → 옮기기(새 id) → 옛 첨부 지우기, 쓰기 간격 ≥ 600ms, 진행 0/3→3/3', async () => {
    const run = threeDocFolder()
    const outcome = await runE2eeConvert(run.plan('to-e2ee', { kind: 'folder', id: 'F' }), run.deps(), run.onProgress)
    expect(outcome).toEqual({ kind: 'done', done: 3, keptAttachments: 0, purgeFailed: 0 })

    const writes = run.writeCalls()
    const put = writes.findIndex((c) => c.name === 'putAttachmentNow')
    expect(writes.slice(put, put + 3).map((c) => c.name)).toEqual(['putAttachmentNow', 'setDocE2ee', 'discardAttachment'])
    expect((writes[put].args[0] as { e2ee?: true }).e2ee).toBe(true)
    expect(writes[put + 1].args[0]).toBe('d2')
    const moved = writes[put + 1].args[1] as { e2ee: boolean; content: string }
    expect(moved.e2ee).toBe(true)
    expect(moved.content).not.toContain(OLD_ATT)
    expect(moved.content).toMatch(/attachments\/ff[0-9a-f]{14}\.png/)
    expect(writes[put + 2].args).toEqual([OLD_ATT, 'png'])

    for (let i = 1; i < writes.length; i++) expect(writes[i].at - writes[i - 1].at).toBeGreaterThanOrEqual(600)
    expect(writes.at(-1)).toMatchObject({ name: 'setFolderE2ee', args: ['F', true] })

    expect(run.progress.map((p) => `${p.done}/${p.total}`)).toEqual(['0/3', '1/3', '2/3', '3/3'])
    expect(run.yjsRemoved).toHaveLength(3)
  })
})

describe('F-407 U14 429', () => {
  const rateMinute = () => new ApiError('rate_limited', { scope: 'minute', retryAfter: 60 })

  it('minute 두 번 뒤 성공 — 60초 기다림이 두 번, waiting 진행, done', async () => {
    const run = threeDocFolder()
    run.rules.push({ name: 'setDocE2ee', id: 'd2', errors: [rateMinute(), rateMinute()] })
    const outcome = await runE2eeConvert(run.plan('to-e2ee', { kind: 'folder', id: 'F' }), run.deps(), run.onProgress)
    expect(outcome.kind).toBe('done')
    expect(run.sleeps.filter((ms) => ms === 60_000)).toHaveLength(2)
    expect(run.progress.some((p) => p.phase === 'waiting' && p.secondsLeft === 60)).toBe(true)
  })

  it('여섯 번 던지면 멈춘다(rate-limited, done 1)', async () => {
    const run = threeDocFolder()
    run.rules.push({ name: 'setDocE2ee', id: 'd2', errors: Array.from({ length: 6 }, rateMinute) })
    const outcome = await runE2eeConvert(run.plan('to-e2ee', { kind: 'folder', id: 'F' }), run.deps(), run.onProgress)
    expect(outcome).toMatchObject({ kind: 'stopped', reason: 'rate-limited', done: 1, total: 3 })
  })

  it('day 는 곧바로 멈추고 resetAt 은 다음 UTC 자정', async () => {
    const run = threeDocFolder()
    run.rules.push({ name: 'setDocE2ee', id: 'd1', errors: [new ApiError('rate_limited', { scope: 'day', retryAfter: 3600 })] })
    const deps = run.deps()
    const outcome = await runE2eeConvert(run.plan('to-e2ee', { kind: 'folder', id: 'F' }), deps, run.onProgress)
    expect(outcome).toMatchObject({ kind: 'stopped', reason: 'day-limit', done: 0 })
    expect(outcome.kind === 'stopped' && outcome.resetAt).toBe(nextUtcMidnight(deps.now()))
    expect(run.sleeps.filter((ms) => ms >= 60_000)).toHaveLength(0)
  })
})

describe('F-407 U15 멈춤과 이어 옮기기', () => {
  it('같은 memory 로 다시 돌리면 올려 둔 첨부를 다시 올리지 않는다', async () => {
    const run = makeFakeRun({
      folders: [folder('F', null)],
      docs: [doc('d1', 'F', 30), doc('d2', 'F', 20), doc('d3', 'F', 10, `![](attachments/${OLD_ATT}.png)`)],
      attachments: [{ id: OLD_ATT, ext: 'png' }],
    })
    run.rules.push({ name: 'setDocE2ee', id: 'd3', errors: [new ApiError('server_error')] })
    const first = await runE2eeConvert(run.plan('to-e2ee', { kind: 'folder', id: 'F' }), run.deps(), run.onProgress)
    expect(first).toMatchObject({ kind: 'stopped', reason: 'failed', done: 2, total: 3 })
    expect(run.memory.uploaded.has(`to-e2ee:${OLD_ATT}`)).toBe(true)

    const putsBefore = run.calls.filter((c) => c.name === 'putAttachmentNow').length
    const second = await runE2eeConvert(run.plan('to-e2ee', { kind: 'folder', id: 'F' }), run.deps(), run.onProgress)
    expect(second).toEqual({ kind: 'done', done: 1, keptAttachments: 0, purgeFailed: 0 })
    expect(run.calls.filter((c) => c.name === 'putAttachmentNow').length).toBe(putsBefore)
    expect(run.docs.get('d3')?.e2ee).toBe('open')
    expect(run.folders.get('F')?.e2ee).toBe(true)
  })
})

describe('F-407 U16 끝난 것으로 치기·충돌·취소', () => {
  it('409 e2ee_doc 는 끝난 것으로 치고 계속', async () => {
    const run = threeDocFolder()
    run.rules.push({ name: 'setDocE2ee', id: 'd1', errors: [new ApiError('e2ee_doc')] })
    const outcome = await runE2eeConvert(run.plan('to-e2ee', { kind: 'folder', id: 'F' }), run.deps(), run.onProgress)
    expect(outcome).toMatchObject({ kind: 'done', done: 3 })
  })

  it('conflict 한 번 — 판을 새로 받고 같은 글로 다시', async () => {
    const run = threeDocFolder()
    run.rules.push({ name: 'setDocE2ee', id: 'd1', errors: [new ApiError('conflict')] })
    const outcome = await runE2eeConvert(run.plan('to-e2ee', { kind: 'doc', id: 'd1' }), run.deps(), run.onProgress)
    expect(outcome).toMatchObject({ kind: 'done', done: 1 })
    const d1Moves = run.calls.filter((c) => c.name === 'setDocE2ee' && c.args[0] === 'd1')
    expect(d1Moves).toHaveLength(2)
    expect((d1Moves[0].args[1] as { content: string }).content).toBe((d1Moves[1].args[1] as { content: string }).content)
    const refreshes = run.calls.filter((c) => c.name === 'refreshDocFromServer' && c.args[0] === 'd1')
    expect(refreshes.length).toBeGreaterThanOrEqual(1)
    const lastRefresh = run.calls.lastIndexOf(refreshes.at(-1)!)
    expect(lastRefresh).toBeGreaterThan(run.calls.indexOf(d1Moves[0]))
    expect(lastRefresh).toBeLessThan(run.calls.indexOf(d1Moves[1]))
  })

  it('둘째 문서 도중 멈추기 — 셋째 문서는 건드리지 않는다', async () => {
    const run = threeDocFolder()
    run.setOnCall((c) => {
      if (c.name === 'setDocE2ee' && c.args[0] === 'd2') run.controller.abort()
    })
    const outcome = await runE2eeConvert(run.plan('to-e2ee', { kind: 'folder', id: 'F' }), run.deps(), run.onProgress)
    expect(outcome).toMatchObject({ kind: 'stopped', reason: 'cancelled' })
    expect(run.calls.some((c) => c.args[0] === 'd3')).toBe(false)
    expect(run.calls.some((c) => c.name === 'setFolderE2ee')).toBe(false)
  })
})

describe('F-407 실행기 — 빼기 (4.5)', () => {
  it('금고 첨부는 평문으로 새 id 에 올리고, 폴더 끄기 먼저, 옛 암호 첨부를 지운다', async () => {
    const run = makeFakeRun({
      folders: [folder('V', null, true)],
      docs: [doc('v1', 'V', 10, `![](attachments/${OLD_ATT}.png)`, { e2ee: 'open' })],
      attachments: [{ id: OLD_ATT, ext: 'png', e2ee: true }],
    })
    const outcome = await runE2eeConvert(run.plan('from-e2ee', { kind: 'folder', id: 'V' }), run.deps(), run.onProgress)
    expect(outcome).toMatchObject({ kind: 'done', done: 1 })
    const names = run.writeCalls().map((c) => c.name)
    expect(names).toEqual(['setFolderE2ee', 'putAttachmentNow', 'setDocE2ee', 'discardAttachment'])
    expect((run.writeCalls()[1].args[0] as { e2ee?: true }).e2ee).toBeUndefined()
    expect(run.docs.get('v1')?.e2ee).toBeUndefined()
    expect(run.yjsRemoved).toHaveLength(0)
  })
})

// ---- F-408 로그인 이관 — planLocalE2eeMigration·rekeyLocalE2eeDoc·rekeyLocalE2eeAttachment·encryptLocalPlainAttachment ----

function vFolder(id: string, parentId: string | null): Folder {
  return { id, name: id, parentId, createdAt: 1, updatedAt: 1, e2ee: true }
}
function plainFolder(id: string, parentId: string | null): Folder {
  return { id, name: id, parentId, createdAt: 1, updatedAt: 1 }
}
function vDoc(id: string, folderId: string | null, updatedAt = 1): Doc {
  return { id, title: 't', content: 'c', lineEnding: 'lf', createdAt: 1, updatedAt, folderId, pinnedAt: null, e2eeKey: 'k' }
}

async function genMk(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey'])
}

describe('F-408 V1~V2 planLocalE2eeMigration', () => {
  it('V1: 계정에 같은 id 가 있는 문서는 건너뛰고, 폴더는 부모 먼저', () => {
    const A = vFolder('A', null)
    const B = vFolder('B', 'A')
    const C = plainFolder('C', null)
    const a1 = vDoc('a1', 'A')
    const b1 = vDoc('b1', 'B')
    const c1 = vDoc('c1', 'C')
    const r1 = vDoc('r1', null)
    const n1: Doc = { id: 'n1', title: 't', content: 'c', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null }
    const plan = planLocalE2eeMigration({
      local: { folders: [A, B, C], docs: [a1, b1, c1, r1, n1] },
      account: { docIds: new Set(['r1']), folderIds: new Set(['C']) },
    })
    expect(plan.folders.map((f) => f.id)).toEqual(['A', 'B'])
    expect(plan.docs.map((d) => d.id)).toEqual(['a1', 'b1', 'c1'])
    expect(plan.skippedDocIds).toEqual(['r1'])
    expect(plan.docs.find((d) => d.id === 'c1')?.folderId).toBe('C')
  })

  it('V2: 부모 고치기 — 계정 폴더 id 가 빈 집합이면 밖의 부모를 null 로', () => {
    const D = plainFolder('D', null) // 로컬 일반 폴더
    const A = vFolder('A', 'D')
    const B = vFolder('B', 'A')
    const C = plainFolder('C', null)
    const c1 = vDoc('c1', 'C')
    const plan = planLocalE2eeMigration({
      local: { folders: [D, A, B, C], docs: [c1] },
      account: { docIds: new Set(), folderIds: new Set() },
    })
    expect(plan.docs.find((d) => d.id === 'c1')?.folderId).toBeNull()
    expect(plan.folders.find((f) => f.id === 'A')?.parentId).toBeNull()
  })
})

describe('F-408 V3~V5 rekeyLocalE2eeDoc', () => {
  it('V3: adopt, 짝 없음 — title·content·e2eeKey 가 입력과 ===', async () => {
    const mk = await genMk()
    const { docKey, wrappedDocKey } = await createDocKey(mk)
    const title = await encryptDocField(docKey, 'd1', 'title', '제목')
    const content = await encryptDocField(docKey, 'd1', 'content', '본문')
    const doc: Doc = { id: 'd1', title, content, lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null, e2eeKey: wrappedDocKey }
    const keys: LocalE2eeKeys = { mode: 'adopt', localKey: mk, accountKey: mk }
    const out = await rekeyLocalE2eeDoc(doc, keys, new Map())
    expect(out.title).toBe(title)
    expect(out.content).toBe(content)
    expect(out.e2eeKey).toBe(wrappedDocKey)
  })

  it('V4: rewrap, 짝 없음 — e2eeKey 만 바뀐다', async () => {
    const localMk = await genMk()
    const accountMk = await genMk()
    const { docKey, wrappedDocKey } = await createDocKey(localMk)
    const title = await encryptDocField(docKey, 'd1', 'title', '제목')
    const content = await encryptDocField(docKey, 'd1', 'content', '본문')
    const doc: Doc = { id: 'd1', title, content, lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null, e2eeKey: wrappedDocKey }
    const keys: LocalE2eeKeys = { mode: 'rewrap', localKey: localMk, accountKey: accountMk }
    const out = await rekeyLocalE2eeDoc(doc, keys, new Map())
    expect(out.title).toBe(title)
    expect(out.content).toBe(content)
    expect(out.e2eeKey).not.toBe(wrappedDocKey)
    expect(out.e2eeKey).toHaveLength(56)
    const accountDocKey = await openDocKey(accountMk, out.e2eeKey as string)
    expect(await decryptDocField(accountDocKey, 'd1', 'title', out.title)).toBe('제목')
    expect(await decryptDocField(accountDocKey, 'd1', 'content', out.content)).toBe('본문')
    await expect(openDocKey(localMk, out.e2eeKey as string)).rejects.toThrow()
  })

  it('V5: 짝 있음(평문 aa.png → 새 cc.png), rewrap — CRLF 를 포함한 나머지 글자는 같다', async () => {
    const localMk = await genMk()
    const accountMk = await genMk()
    const { docKey, wrappedDocKey } = await createDocKey(localMk)
    const AA = '00000000000000aa'
    const CC = '00000000000000cc'
    const plainContent = `이미지\r\n![](attachments/${AA}.png)\r\n끝`
    const title = await encryptDocField(docKey, 'd1', 'title', '제목')
    const content = await encryptDocField(docKey, 'd1', 'content', plainContent)
    const doc: Doc = {
      id: 'd1', title, content, lineEnding: 'crlf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null,
      e2eeKey: wrappedDocKey, attachmentRefs: [AA],
    }
    const keys: LocalE2eeKeys = { mode: 'rewrap', localKey: localMk, accountKey: accountMk }
    const links = new Map([[AA, { id: CC, ext: 'png' as AttachmentExt }]])
    const out = await rekeyLocalE2eeDoc(doc, keys, links)
    expect(out.title).toBe(title)
    expect(out.content).not.toBe(content)
    const accountDocKey = await openDocKey(accountMk, out.e2eeKey as string)
    const newPlain = await decryptDocField(accountDocKey, 'd1', 'content', out.content)
    expect(newPlain).toBe(`이미지\r\n![](attachments/${CC}.png)\r\n끝`)
    expect(out.attachmentRefs).toContain(CC)
    expect(out.attachmentRefs).not.toContain(AA)
  })
})

describe('F-408 V6 rekeyLocalE2eeAttachment·encryptLocalPlainAttachment', () => {
  it('rewrap 은 머리 40B 만 바뀌고, adopt 는 바이트가 같다. 평문 암호화는 새 id·같은 ext', async () => {
    const localMk = await genMk()
    const accountMk = await genMk()
    const id = '00000000000000aa'
    const plain = new TextEncoder().encode('hello world')
    const envelope = await encryptAttachment(localMk, id, plain)
    const attachment: Attachment = {
      id, mime: 'application/octet-stream', ext: 'png', size: envelope.length, width: 1, height: 1, createdAt: 1, e2ee: true,
      blob: new Blob([envelope as BlobPart]),
    }

    const rewrapKeys: LocalE2eeKeys = { mode: 'rewrap', localKey: localMk, accountKey: accountMk }
    const rewrapped = await rekeyLocalE2eeAttachment(attachment, rewrapKeys)
    const rewrappedBytes = new Uint8Array(await rewrapped.blob.arrayBuffer())
    expect(rewrappedBytes[0]).toBe(envelope[0])
    expect(rewrappedBytes.slice(41)).toEqual(envelope.slice(41))
    expect(rewrappedBytes.slice(1, 41)).not.toEqual(envelope.slice(1, 41))
    const decrypted = await decryptAttachment(accountMk, id, rewrappedBytes)
    expect(new TextDecoder().decode(decrypted)).toBe('hello world')

    const adoptKeys: LocalE2eeKeys = { mode: 'adopt', localKey: localMk, accountKey: localMk }
    const adopted = await rekeyLocalE2eeAttachment(attachment, adoptKeys)
    const adoptedBytes = new Uint8Array(await adopted.blob.arrayBuffer())
    expect(adoptedBytes).toEqual(envelope)

    const plainAttachment: Attachment = {
      id: 'ignored', mime: 'image/png', ext: 'png', size: plain.length, width: 2, height: 3, createdAt: 1,
      blob: new Blob([plain as BlobPart]),
    }
    const encrypted = await encryptLocalPlainAttachment(plainAttachment, rewrapKeys)
    expect(encrypted).not.toBeNull()
    expect(encrypted!.id).toHaveLength(16)
    expect(encrypted!.id).not.toBe('ignored')
    expect(encrypted!.e2ee).toBe(true)
    expect(encrypted!.ext).toBe('png')
    const decryptedPlain = await decryptAttachment(accountMk, encrypted!.id, new Uint8Array(await encrypted!.blob.arrayBuffer()))
    expect(new TextDecoder().decode(decryptedPlain)).toBe('hello world')

    const bigBytes = new Uint8Array(5_242_812)
    const bigAttachment: Attachment = {
      id: 'big', mime: 'image/png', ext: 'png', size: bigBytes.length, width: 2, height: 3, createdAt: 1,
      blob: new Blob([bigBytes as BlobPart]),
    }
    expect(await encryptLocalPlainAttachment(bigAttachment, rewrapKeys)).toBeNull()
  })
})
