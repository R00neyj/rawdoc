// F-2020.md 4·5장·11.1 U2·U5~U8 — 옵시디언 볼트 내보내기 계획·본문 변환·zip
// F-409 9.1 U10·U14 — 금고 문서 빼기·알림·금고 첨부 거르기
import { describe, it, expect, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { planExportPaths, selectExportScope, type WorkspaceExportSourceStore, type WorkspaceExportStore } from './exportWorkspace'
import { planVaultExport, toVaultMarkdown, exportVault, downloadVaultExport, type VaultLinkContext } from './exportVault'
import { toObsidianFileName, toObsidianFolderName } from '../lib/filename'
import { fromEditorText } from '../lib/lineEnding'
import { createWikiResolver } from '../lib/wikiResolve'
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

describe('planExportPaths · selectExportScope 옵시디언 이름 (F-2020 U2)', () => {
  it('왜? → 왜_.md, 같은 폴더 a#·a^(생성순) → a_.md·a_ (2).md, 폴더 교안#1 → 교안_1, 폴더 attachments → attachments (2)', () => {
    const folders = [folder({ id: 'f1', name: '교안#1' }), folder({ id: 'f2', name: 'attachments' })]
    const docs = [
      doc({ id: 'd0', title: '왜?', createdAt: 0 }),
      doc({ id: 'd1', title: 'a#', createdAt: 1 }),
      doc({ id: 'd2', title: 'a^', createdAt: 2 }),
    ]
    const naming = { fileName: toObsidianFileName, folderName: toObsidianFolderName }
    const { docPaths, folderPaths } = planExportPaths(docs, folders, null, naming)
    expect(docPaths.get('d0')).toBe('왜_.md')
    expect(docPaths.get('d1')).toBe('a_.md')
    expect(docPaths.get('d2')).toBe('a_ (2).md')
    expect(folderPaths.get('f1')).toBe('교안_1')
    expect(folderPaths.get('f2')).toBe('attachments (2)')
  })

  it('selectExportScope 가 edit·view 문서를 빼고 폴더 범위에서 루트 폴더 자신을 뺀다', () => {
    const folders = [folder({ id: 'root', name: '루트' }), folder({ id: 'child', name: '하위', parentId: 'root' })]
    const docs = [
      doc({ id: 'o', title: '내문서', role: 'owner', folderId: 'root' }),
      doc({ id: 'e', title: '편집', role: 'edit', folderId: 'root' }),
      doc({ id: 'v', title: '보기', role: 'view', folderId: 'root' }),
      doc({ id: 'c', title: '하위문서', folderId: 'child' }),
    ]
    const { docs: scopedDocs, folders: scopedFolders, rootFolderId } = selectExportScope(docs, folders, {
      kind: 'folder',
      folderId: 'root',
    })
    expect(scopedDocs.map((d) => d.id).sort()).toEqual(['c', 'o'])
    expect(scopedFolders.map((f) => f.id)).toEqual(['child'])
    expect(rootFolderId).toBe('root')
  })
})

const EMPTY_LINKS: VaultLinkContext = { resolver: createWikiResolver([], []), exportedIds: new Set(), vaultPathOf: new Map() }

describe('toVaultMarkdown — 이미지 블록 (F-2020 U5)', () => {
  it('보통 블록 — 임베드 한 줄로, 앞뒤 빈 줄은 그대로', () => {
    const content = '텍스트\n\n<div align="center">\n  <img src="attachments/0f3a9c2e7b1d4a58.png" alt="설명" width="300">\n</div>\n\n다음\n'
    const { text, rewrittenLinks } = toVaultMarkdown(content, null, EMPTY_LINKS)
    expect(text).toBe('텍스트\n\n![[0f3a9c2e7b1d4a58.png|300]]\n\n다음\n')
    expect(rewrittenLinks).toBe(0)
  })

  it('width 없는 블록', () => {
    const content = '<div align="left">\n  <img src="attachments/1111111111111111.png" alt="">\n</div>\n'
    const { text } = toVaultMarkdown(content, null, EMPTY_LINKS)
    expect(text).toBe('![[1111111111111111.png]]\n')
  })

  it('줄 앞 공백 3칸 블록도 된다', () => {
    const content = '<div align="center">\n   <img src="attachments/2222222222222222.png" alt="">\n</div>\n'
    const { text } = toVaultMarkdown(content, null, EMPTY_LINKS)
    expect(text).toBe('![[2222222222222222.png]]\n')
  })

  it('연달아 둘 — 둘 다 임베드로 바뀐다', () => {
    const content =
      '<div align="center">\n  <img src="attachments/3333333333333333.png" alt="">\n</div>\n\n<div align="center">\n  <img src="attachments/4444444444444444.png" alt="">\n</div>\n'
    const { text } = toVaultMarkdown(content, null, EMPTY_LINKS)
    expect(text).toBe('![[3333333333333333.png]]\n\n![[4444444444444444.png]]\n')
  })

  it('블록이 아닌 것 — 글이 붙음·목록·인용·펜스·주석 안은 원문 그대로', () => {
    const cases = [
      '<div align="center">\n  <img src="attachments/5555555555555555.png" alt="">\n</div>\n붙은글\n',
      '- 항목\n  <div align="center">\n    <img src="attachments/7777777777777777.png" alt="">\n  </div>\n',
      '> <div align="center">\n>   <img src="attachments/8888888888888888.png" alt="">\n> </div>\n',
      '```\n<div align="center">\n  <img src="attachments/9999999999999999.png" alt="">\n</div>\n```\n',
      '%%\n<div align="center">\n  <img src="attachments/aaaaaaaaaaaaaaaa.png" alt="">\n</div>\n%%\n',
    ]
    for (const content of cases) {
      const { text, rewrittenLinks } = toVaultMarkdown(content, null, EMPTY_LINKS)
      expect(text).toBe(content)
      expect(rewrittenLinks).toBe(0)
    }
  })

  it('프론트매터가 있으면 프론트매터 뒤 블록의 줄이 맞게 바뀐다', () => {
    const content = '---\ntitle: 문서\n---\n<div align="center">\n  <img src="attachments/0f3a9c2e7b1d4a58.png" alt="" width="100">\n</div>\n'
    const { text } = toVaultMarkdown(content, null, EMPTY_LINKS)
    expect(text).toBe('---\ntitle: 문서\n---\n![[0f3a9c2e7b1d4a58.png|100]]\n')
  })

  it('블록이 이겨 alt 안 [[왜?]] 는 임베드로 바뀌고 링크 개수에 안 든다', () => {
    const resolver = createWikiResolver([{ id: 'why', title: '왜?', folderId: null }], [])
    const linksWithDoc: VaultLinkContext = {
      resolver,
      exportedIds: new Set(['why']),
      vaultPathOf: new Map([['why', '왜_']]),
    }
    const content = '<div align="center">\n  <img src="attachments/bbbbbbbbbbbbbbbb.png" alt="[[왜?]]">\n</div>\n'
    const { text, rewrittenLinks } = toVaultMarkdown(content, null, linksWithDoc)
    expect(text).toBe('![[bbbbbbbbbbbbbbbb.png]]\n')
    expect(rewrittenLinks).toBe(0)
  })

  it('attachments/ 참조가 없는 문서는 링크를 뺀 나머지 글자가 입력과 같다', () => {
    const content = '그냥 글\n\n[[왜?]]\n'
    const { text } = toVaultMarkdown(content, null, EMPTY_LINKS)
    expect(text).toBe(content)
  })
})

// 5.4 표 아홉 행 — planVaultExport 로 실제 링크 맥락을 만들어 확인한다 (F-2020 U6)
describe('toVaultMarkdown — 위키링크 고쳐 쓰기 (F-2020 U6)', () => {
  const folders: Folder[] = [
    folder({ id: 'gyoan', name: '교안' }),
    folder({ id: 'gwaje', name: '과제' }),
    folder({ id: 'wiki', name: '위키' }),
  ]
  const docs: Doc[] = [
    doc({ id: 'why', title: '왜?', createdAt: 1 }),
    doc({ id: 'gyoanMeeting', title: '회의록', folderId: 'gyoan', createdAt: 2 }),
    doc({ id: 'gwajeMeeting', title: '회의록', folderId: 'gwaje', createdAt: 3 }),
    doc({
      id: 'toc',
      title: '목차',
      folderId: 'gyoan',
      createdAt: 4,
      content: '[[회의록]]\n\n[[회의록#결정|결정 보기]]\n\n[[교안/회의록]]\n',
    }),
    doc({ id: 'topIndex', title: '색인', createdAt: 5 }),
    doc({ id: 'wikiIndex', title: '색인', folderId: 'wiki', createdAt: 6 }),
    doc({ id: 'linkerTop', title: '링커1', createdAt: 7, content: '[[왜?]]\n\n[[색인]]\n' }),
    doc({ id: 'wikiA', title: 'a', folderId: 'wiki', createdAt: 8, content: '[[색인]]\n' }),
    doc({ id: 'tableDoc', title: '표문서', createdAt: 9, content: '| 문서 | 값 |\n| --- | --- |\n| [[왜?]] | 1 |\n' }),
    doc({
      id: 'edgeDoc',
      title: '엣지',
      createdAt: 10,
      content: '[[#결정]]\n\n[[없는 문서]]\n\n![[그림.png]]\n',
    }),
    doc({
      id: 'codeDoc',
      title: '코드',
      createdAt: 11,
      content: '---\ntitle: 문서\n---\n`[[왜?]]`\n\n```\n[[왜?]]\n```\n',
    }),
    doc({ id: 'spaceDoc', title: '공백', folderId: 'gyoan', createdAt: 12, content: '[[ 회의록 ]]\n' }),
    doc({ id: 'hashDoc', title: '해시', folderId: 'gyoan', createdAt: 13, content: '[[회의록#상위#하위]]\n' }),
  ]

  const plan = planVaultExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
  function contentOf(id: string): string {
    return docs.find((d) => d.id === id)!.content
  }
  function folderIdOf(id: string): string | null {
    return docs.find((d) => d.id === id)!.folderId
  }
  function run(id: string) {
    return toVaultMarkdown(contentOf(id), folderIdOf(id), plan.links)
  }

  it('1. [[왜?]] (최상위) → [[왜_|왜?]]', () => {
    const { text, rewrittenLinks } = run('linkerTop')
    expect(text).toContain('[[왜_|왜?]]')
    expect(rewrittenLinks).toBe(1) // linkerTop 안 [[색인]] 은 4행(그대로) — 이 문서 안에서는 1개만 고쳐진다
  })

  it('4. [[색인]] (최상위, linkerTop 도 최상위) → 그대로', () => {
    const { text } = run('linkerTop')
    expect(text).toContain('[[색인]]\n')
    expect(text).not.toContain('[[위키/색인')
  })

  it('2·3. 교안/목차 — [[회의록]] → [[교안/회의록|회의록]], [[회의록#결정|결정 보기]] → [[교안/회의록#결정|결정 보기]], [[교안/회의록]] 은 그대로', () => {
    const { text, rewrittenLinks } = run('toc')
    expect(text).toBe('[[교안/회의록|회의록]]\n\n[[교안/회의록#결정|결정 보기]]\n\n[[교안/회의록]]\n')
    expect(rewrittenLinks).toBe(2)
  })

  it('5. [[색인]] (위키/a) → [[위키/색인|색인]]', () => {
    const { text, rewrittenLinks } = run('wikiA')
    expect(text).toBe('[[위키/색인|색인]]\n')
    expect(rewrittenLinks).toBe(1)
  })

  it('6. 표 줄 — | [[왜?]] | 1 | → | [[왜_]] | 1 | (별칭 없음)', () => {
    const { text, rewrittenLinks } = run('tableDoc')
    expect(text).toBe('| 문서 | 값 |\n| --- | --- |\n| [[왜_]] | 1 |\n')
    expect(rewrittenLinks).toBe(1)
  })

  it('7. [[#결정]]·[[없는 문서]]·![[그림.png]] 는 그대로', () => {
    const { text, rewrittenLinks } = run('edgeDoc')
    expect(text).toBe('[[#결정]]\n\n[[없는 문서]]\n\n![[그림.png]]\n')
    expect(rewrittenLinks).toBe(0)
  })

  it('8. 인라인 코드·펜스·프론트매터 안은 그대로', () => {
    const { text, rewrittenLinks } = run('codeDoc')
    expect(text).toBe(contentOf('codeDoc'))
    expect(rewrittenLinks).toBe(0)
  })

  it('[[ 회의록 ]] 처럼 공백이 있는 대상은 고칠 때 공백이 사라지고 별칭은 회의록', () => {
    const { text } = run('spaceDoc')
    expect(text).toBe('[[교안/회의록|회의록]]\n')
  })

  it('[[회의록#상위#하위]] 는 #상위#하위 가 그대로 붙는다', () => {
    const { text } = run('hashDoc')
    expect(text).toContain('교안/회의록#상위#하위')
  })

  it('폴더 내보내기에서 폴더 밖 문서로 풀리는 링크는 그대로', () => {
    const folderPlan = planVaultExport({ docs, folders, scope: { kind: 'folder', folderId: 'gyoan' }, now: NOW })
    const { text, rewrittenLinks } = toVaultMarkdown('[[왜?]]\n', 'gyoan', folderPlan.links)
    expect(text).toBe('[[왜?]]\n')
    expect(rewrittenLinks).toBe(0)
  })

  it('공유받은 문서(role: view)로 풀리는 링크는 그대로', () => {
    const sharedDocs: Doc[] = [...docs, doc({ id: 'shared', title: '공유문서', role: 'view', createdAt: 20 })]
    const sharedPlan = planVaultExport({ docs: sharedDocs, folders, scope: { kind: 'all' }, now: NOW })
    const { text, rewrittenLinks } = toVaultMarkdown('[[공유문서]]\n', null, sharedPlan.links)
    expect(text).toBe('[[공유문서]]\n')
    expect(rewrittenLinks).toBe(0)
  })
})

describe('planVaultExport (F-2020 U7)', () => {
  it('zipFilename — 전체는 로컬 날짜-vault.zip, 폴더는 {toFolderName(이름)}-vault.zip', () => {
    const folders = [folder({ id: 'f1', name: '폴더 이름' })]
    const docs = [doc({ id: 'd1', title: '문서', folderId: 'f1' })]
    const all = planVaultExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
    expect(all.zipFilename).toMatch(/^\d{4}-\d{2}-\d{2}-vault\.zip$/)
    const one = planVaultExport({ docs, folders, scope: { kind: 'folder', folderId: 'f1' }, now: NOW })
    expect(one.zipFilename).toBe('폴더 이름-vault.zip')
  })

  it('docs 순서가 같은 입력의 planWorkspaceExport directories 순서와 같다', async () => {
    const { planWorkspaceExport } = await import('./exportWorkspace')
    const folders = [folder({ id: 'f1', name: '폴더' }), folder({ id: 'f2', name: '하위', parentId: 'f1' })]
    const docs = [
      doc({ id: 'd1', title: '루트문서', createdAt: 3 }),
      doc({ id: 'd2', title: '폴더문서', folderId: 'f1', createdAt: 2 }),
      doc({ id: 'd3', title: '하위문서', folderId: 'f2', createdAt: 1 }),
      doc({ id: 'd4', title: '루트문서2', createdAt: 1 }),
    ]
    const workspacePlan = planWorkspaceExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
    const workspaceOrder = workspacePlan.directories.flatMap((d) => d.docs.map((x) => x.doc.id))

    const vaultPlan = planVaultExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
    const vaultOrder = vaultPlan.docs.map((d) => d.doc.id)
    expect(vaultOrder).toEqual(workspaceOrder)
  })

  it('해석기 입력이 updatedAt 내림차순이다 (입력 순서를 섞어도 결과가 같다)', () => {
    const docsA = [
      doc({ id: 'old', title: '중복', updatedAt: 100, createdAt: 1 }),
      doc({ id: 'new', title: '중복', updatedAt: 200, createdAt: 2 }),
      doc({ id: 'linker', title: 'L', updatedAt: 300, createdAt: 3, content: '[[중복]]\n' }),
    ]
    const docsB = [docsA[2], docsA[0], docsA[1]] // 순서를 섞는다
    const planA = planVaultExport({ docs: docsA, folders: [], scope: { kind: 'all' }, now: NOW })
    const planB = planVaultExport({ docs: docsB, folders: [], scope: { kind: 'all' }, now: NOW })
    const resultA = planA.links.resolver.resolve('중복', null)
    const resultB = planB.links.resolver.resolve('중복', null)
    // updatedAt 내림차순 앞(=new) 이 잡힌다
    expect(resultA?.id).toBe('new')
    expect(resultB?.id).toBe('new')
  })
})

describe('exportVault (F-2020 U8)', () => {
  it('manifest.json 이 없고, .md 바이트가 fromEditorText 인코딩과 같다 (CRLF·LF)', async () => {
    const docs = [
      doc({ id: 'd1', title: '문서1', content: '첫\n\n둘\n', lineEnding: 'crlf', createdAt: 1 }),
      doc({ id: 'd2', title: '문서2', content: '셋\n넷\n', lineEnding: 'lf', createdAt: 2 }),
    ]
    const plan = planVaultExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const result = await exportVault({ plan, store: { getAttachment: async () => null } })
    const unzipped = unzipSync(result.bytes)
    expect(unzipped['manifest.json']).toBeUndefined()
    expect(unzipped['문서1.md']).toEqual(new TextEncoder().encode(fromEditorText('첫\n\n둘\n', 'crlf')))
    expect(unzipped['문서2.md']).toEqual(new TextEncoder().encode(fromEditorText('셋\n넷\n', 'lf')))
    expect(unzipped['문서1.md'][0]).not.toBe(0xef)
  })

  it('같은 첨부를 두 폴더 문서가 쓰면 attachments/ 루트에 한 번, {폴더}/attachments/ 는 없다', async () => {
    const id = '0f3a9c2e7b1d4a58'
    const imgText = `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n`
    const folders = [folder({ id: 'fA', name: 'A' }), folder({ id: 'fB', name: 'B' })]
    const docs = [
      doc({ id: 'd1', title: '문서1', folderId: 'fA', content: imgText, createdAt: 1 }),
      doc({ id: 'd2', title: '문서2', folderId: 'fB', content: imgText, createdAt: 2 }),
    ]
    const plan = planVaultExport({ docs, folders, scope: { kind: 'all' }, now: NOW })
    const store = {
      getAttachment: async (attId: string) =>
        attId === id ? { id, ext: 'png', blob: new Blob([new Uint8Array([1, 2, 3])]) } : null,
    }
    const result = await exportVault({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(Array.from(unzipped[`attachments/${id}.png`])).toEqual([1, 2, 3])
    expect(unzipped[`A/attachments/${id}.png`]).toBeUndefined()
    expect(unzipped[`B/attachments/${id}.png`]).toBeUndefined()
    expect(result.missingCount).toBe(0)
  })

  it('목록 안 블록(임베드로 안 바뀜)의 첨부도 들어간다', async () => {
    const id = '1234567890abcdef'
    const listImg = `- 항목\n  <div align="center">\n    <img src="attachments/${id}.png" alt="a">\n  </div>\n`
    const docs = [doc({ id: 'd1', title: '문서1', content: listImg, createdAt: 1 })]
    const plan = planVaultExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const store = {
      getAttachment: async (attId: string) =>
        attId === id ? { id, ext: 'png', blob: new Blob([new Uint8Array([9])]) } : null,
    }
    const result = await exportVault({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(Array.from(unzipped[`attachments/${id}.png`])).toEqual([9])
  })

  it('없는 첨부는 빠지고 missingCount 는 서로 다른 id 수, onProgress 는 done 1..M 순서', async () => {
    const idOk = '0f3a9c2e7b1d4a58'
    const idMissing = '1111111111111111'
    const textOf = (i: string) => `<div align="center">\n  <img src="attachments/${i}.png" alt="a">\n</div>\n`
    const docs = [
      doc({ id: 'd1', title: '문서1', content: textOf(idOk) + textOf(idMissing), createdAt: 1 }),
      doc({ id: 'd2', title: '문서2', content: textOf(idMissing), createdAt: 2 }),
    ]
    const plan = planVaultExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const store = {
      getAttachment: async (attId: string) =>
        attId === idOk ? { id: idOk, ext: 'png', blob: new Blob([new Uint8Array([1])]) } : null,
    }
    const progress: Array<{ done: number; total: number }> = []
    const result = await exportVault({ plan, store, onProgress: (p) => progress.push(p) })
    expect(result.missingCount).toBe(1)
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
    expect(result.docCount).toBe(2)
  })

  it('문서 50개마다 한 번 이벤트 루프에 양보한다 (마이크로태스크가 아니라 매크로태스크)', async () => {
    const docs = Array.from({ length: 120 }, (_, i) => doc({ id: `d${i}`, title: `문서${i}`, createdAt: i }))
    const plan = planVaultExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const progress: Array<{ done: number; total: number }> = []

    let countAtTimeout = -1
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        countAtTimeout = progress.length
        resolve()
      }, 0)
    })

    const exportPromise = exportVault({ plan, store: { getAttachment: async () => null }, onProgress: (p) => progress.push(p) })

    await timeoutPromise
    expect(countAtTimeout).toBe(50)
    await exportPromise
    expect(progress).toHaveLength(120)
  })

  it('rewrittenLinks 가 문서별 결과의 합이다', async () => {
    const docs = [
      doc({ id: 'why', title: '왜?', createdAt: 1 }),
      doc({ id: 'linker', title: '링커', createdAt: 2, content: '[[왜?]]\n' }),
    ]
    const plan = planVaultExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const result = await exportVault({ plan, store: { getAttachment: async () => null } })
    expect(result.rewrittenLinks).toBe(1)
  })
})

describe('F-409 U10 잠긴 금고 문서', () => {
  it('locked 문서는 lockedCount 로 빠지고 docs 에 없다', () => {
    const docs = [
      doc({ id: 'd1', title: '일반' }),
      doc({ id: 'locked', title: '', content: '', e2ee: 'locked' }),
    ]
    const plan = planVaultExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    expect(plan.lockedCount).toBe(1)
    expect(plan.docs.map((d) => d.doc.id)).toEqual(['d1'])
  })

  it('열린 모양은 위키링크가 이어지고, 잠긴 모양(제목 "")은 해석되지 않아 원문 그대로 남는다', () => {
    const linker = doc({ id: 'linker', title: '링커', content: '[[비밀 제목]]\n', createdAt: 2 })
    const openPlan = planVaultExport({
      docs: [linker, doc({ id: 'secret', title: '비밀 제목', content: '비밀 본문', e2ee: 'open', createdAt: 1 })],
      folders: [],
      scope: { kind: 'all' },
      now: NOW,
    })
    const lockedPlan = planVaultExport({
      docs: [linker, doc({ id: 'secret', title: '', content: '', e2ee: 'locked', createdAt: 1 })],
      folders: [],
      scope: { kind: 'all' },
      now: NOW,
    })
    // 열린 모양은 해석기가 그 문서를 찾아 exportedIds 에도 들어 있다 — 이어진다 (c4)
    expect(openPlan.links.resolver.resolve('비밀 제목', null)?.id).toBe('secret')
    expect(openPlan.links.exportedIds.has('secret')).toBe(true)
    // 잠긴 모양은 제목이 '' 라 해석기가 애초에 후보로 넣지 않는다 — 해석되지 않는다
    expect(lockedPlan.links.resolver.resolve('비밀 제목', null)).toBeNull()

    const lockedLinkerDoc = lockedPlan.docs.find((d) => d.doc.id === 'linker')!.doc
    const lockedResult = toVaultMarkdown(lockedLinkerDoc.content, lockedLinkerDoc.folderId, lockedPlan.links)
    expect(lockedResult.rewrittenLinks).toBe(0)
    expect(lockedResult.text).toBe('[[비밀 제목]]\n')
  })

  function storeOf(docs: Doc[], folders: Folder[] = []): WorkspaceExportSourceStore {
    return { list: async () => docs, listFolders: async () => folders, getAttachment: async () => null }
  }

  it('downloadVaultExport — 0개 + 잠김 → E32 하나만', async () => {
    const notices: Array<{ type: string; message: string }> = []
    await downloadVaultExport({
      store: storeOf([doc({ id: 'locked', title: '', content: '', e2ee: 'locked' })]),
      scope: { kind: 'all' },
      now: NOW,
      onNotice: (n) => notices.push(n),
    })
    expect(notices).toEqual([{ type: 'warn', message: '금고가 잠겨 있어 내보낼 문서가 없습니다. 금고를 연 뒤 다시 해 주세요.' }])
  })

  it('downloadVaultExport — 내보냄, 잠김 있음, 누락 0 → 성공 info 뒤 warn S3', async () => {
    const notices: Array<{ type: string; message: string }> = []
    await downloadVaultExport({
      store: storeOf([doc({ id: 'd1', title: '문서' }), doc({ id: 'locked', title: '', content: '', e2ee: 'locked' })]),
      scope: { kind: 'all' },
      now: NOW,
      onNotice: (n) => notices.push(n),
    })
    expect(notices).toEqual([
      { type: 'info', message: '옵시디언 볼트로 내보냈습니다.' },
      { type: 'warn', message: '금고가 잠겨 있어 금고 문서 1개는 빼고 내보냈습니다.' },
    ])
  })
})

describe('F-409 U14 exportVault 금고 첨부 거르기 (zip 전체 기준)', () => {
  const id = '0f3a9c2e7b1d4a58'
  const imgText = `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n`

  it('일반 문서만 참조하면 빠지고 missingCount 1', async () => {
    const docs = [doc({ id: 'd1', title: '문서1', content: imgText })]
    const plan = planVaultExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const store: WorkspaceExportStore = {
      getAttachment: async (attId: string) => (attId === id ? { id, ext: 'png', blob: new Blob([new Uint8Array([1])]), e2ee: true } : null),
    }
    const result = await exportVault({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(unzipped[`attachments/${id}.png`]).toBeUndefined()
    expect(result.missingCount).toBe(1)
  })

  it('zip 안 다른 열린 금고 문서가 참조하면 들어간다', async () => {
    const docs = [
      doc({ id: 'd1', title: '문서1', content: imgText }),
      doc({ id: 'd2', title: '금고문서', content: imgText, e2ee: 'open' }),
    ]
    const plan = planVaultExport({ docs, folders: [], scope: { kind: 'all' }, now: NOW })
    const store: WorkspaceExportStore = {
      getAttachment: async (attId: string) => (attId === id ? { id, ext: 'png', blob: new Blob([new Uint8Array([1])]), e2ee: true } : null),
    }
    const result = await exportVault({ plan, store })
    const unzipped = unzipSync(result.bytes)
    expect(unzipped[`attachments/${id}.png`]).toBeTruthy()
    expect(result.missingCount).toBe(0)
  })
})
