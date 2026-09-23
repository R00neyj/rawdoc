// wikiResolve 단위 테스트 (specs/features/F-2018.md 15.1 U2~U8)
import { describe, expect, it } from 'vitest'
import { createWikiResolver, shortestWikiTarget, type WikiDocRef, type WikiFolderRef } from './wikiResolve'
import { resolveWikiTarget } from './wikiLink'

const folder = (id: string, name: string, parentId: string | null = null): WikiFolderRef => ({ id, name, parentId })
const doc = (id: string, title: string, folderId: string | null = null): WikiDocRef => ({ id, title, folderId })

describe('U2 — 제목 전체 일치', () => {
  it('먼 폴더의 정확 일치가 같은 폴더의 대소문자 일치를 이긴다', () => {
    const folders = [folder('fA', 'A'), folder('fB', 'B')]
    const docs = [doc('lower-same', 'meeting', 'fA'), doc('exact-far', 'Meeting', 'fB')]
    const r = createWikiResolver(docs, folders)
    expect(r.resolve('Meeting', 'fA')?.id).toBe('exact-far')
    expect(r.resolve('MEETING', 'fA')?.id).toBe('lower-same')
  })

  it('제목이 빈 문서는 후보가 아니고, 빈 대상은 null', () => {
    const r = createWikiResolver([doc('e', ''), doc('s', '   '), doc('a', 'a')], [])
    expect(r.resolve('', null)).toBeNull()
    expect(r.resolve('   ', null)).toBeNull()
    expect(r.resolve('a', null)?.id).toBe('a')
  })

  it('돌려주는 것은 docs 의 그 원소 자체다', () => {
    const docs = [doc('a', 'a')]
    expect(createWikiResolver(docs, []).resolve('a', null)).toBe(docs[0])
  })
})

describe('U3 — 모두 최상위면 resolveWikiTarget 과 같다 (4.9)', () => {
  const cases: [string, WikiDocRef[]][] = [
    ['회의록', [doc('1', '회의록'), doc('2', '다른 문서'), doc('3', '')]],
    ['meeting', [doc('a', 'Meeting')]],
    ['기록', [doc('new', '기록'), doc('old', '기록')]],
    ['없는 문서', [doc('1', '회의록'), doc('2', '다른 문서')]],
    ['', [doc('1', '회의록'), doc('3', '')]],
    ['   ', [doc('1', '회의록'), doc('3', '')]],
    ['  회의록  ', [doc('1', '회의록')]],
  ]
  for (const [target, docs] of cases) {
    it(JSON.stringify(target), () => {
      const expected = resolveWikiTarget(target, docs)
      expect(createWikiResolver(docs, []).resolve(target, null)).toBe(expected)
    })
  }
})

describe('U4 — 경로식', () => {
  const folders = [
    folder('o', '옵시디언'),
    folder('v', '내 볼트', 'o'),
    folder('g1', '교안', 'v'),
    folder('g2', '교안'),
    folder('h', '과제'),
    folder('n', 'Notes'),
    folder('a', 'a'),
    folder('A', 'A'),
  ]

  it('[[교안/1주차]] 는 옵시디언/내 볼트/교안/1주차 를 찾고 과제/1주차 는 안 찾는다', () => {
    const r = createWikiResolver([doc('hw', '1주차', 'h'), doc('deep', '1주차', 'g1')], folders)
    expect(r.resolve('교안/1주차', null)?.id).toBe('deep')
    expect(r.resolve('교안/1주차', 'h')?.id).toBe('deep')
  })

  it('[[교안/1주차]] 는 최상위 교안/1주차 도 찾는다', () => {
    const r = createWikiResolver([doc('hw', '1주차', 'h'), doc('top', '1주차', 'g2')], folders)
    expect(r.resolve('교안/1주차', 'h')?.id).toBe('top')
    expect(r.resolve('내 볼트/교안/1주차', 'h')).toBeNull()
  })

  it('폴더 이름은 대소문자 무시, 맨 앞 / 는 뗀다', () => {
    const r = createWikiResolver([doc('x', '노트', 'n'), doc('g', '1주차', 'g2')], folders)
    expect(r.resolve('notes/노트', null)?.id).toBe('x')
    expect(r.resolve('/교안/1주차', null)?.id).toBe('g')
    expect(r.resolve('//교안/1주차', null)?.id).toBe('g')
  })

  it('[[a//b]]·[[a/]] 는 경로식이 아니다', () => {
    const r = createWikiResolver([doc('b', 'b', 'a')], folders)
    expect(r.resolve('a/b', null)?.id).toBe('b')
    expect(r.resolve('a//b', null)).toBeNull()
    expect(r.resolve('a/', null)).toBeNull()
  })

  it('제목 A/B 테스트 문서가 있으면 폴더 A 안 B 테스트 보다 먼저', () => {
    const r = createWikiResolver([doc('inA', 'B 테스트', 'A'), doc('slash', 'A/B 테스트')], folders)
    expect(r.resolve('A/B 테스트', 'A')?.id).toBe('slash')
  })

  it('공유받은 문서(폴더 모름)는 경로로 안 걸린다', () => {
    const r = createWikiResolver([doc('shared', '1주차', 'foreign')], folders)
    expect(r.resolve('교안/1주차', null)).toBeNull()
    expect(r.resolve('1주차', null)?.id).toBe('shared')
  })

  it('정확 일치 제목에 경로가 맞는 문서가 없을 때만 대소문자 접은 제목', () => {
    const r = createWikiResolver([doc('lower', 'week', 'g2'), doc('exactOther', 'Week', 'h')], folders)
    expect(r.resolve('교안/Week', null)?.id).toBe('lower')
  })
})

describe('U5 — 끝 .md', () => {
  const folders = [folder('g', '교안')]

  it('제목 회의록.md 문서가 있으면 그것', () => {
    const r = createWikiResolver([doc('plain', '회의록'), doc('md', '회의록.md')], folders)
    expect(r.resolve('회의록.md', null)?.id).toBe('md')
  })

  it('없으면 .md 를 뗀 회의록, .MD 도', () => {
    const r = createWikiResolver([doc('plain', '회의록')], folders)
    expect(r.resolve('회의록.md', null)?.id).toBe('plain')
    expect(r.resolve('회의록.MD', null)?.id).toBe('plain')
    expect(r.resolve('.md', null)).toBeNull()
  })

  it('떼고 난 뒤 경로식도', () => {
    const r = createWikiResolver([doc('w', '1주차', 'g')], folders)
    expect(r.resolve('교안/1주차.md', null)?.id).toBe('w')
  })
})

describe('U6 — 가까운 폴더 (4.4)', () => {
  const folders = [
    folder('w', '위키'),
    folder('c', '개념', 'w'),
    folder('p', '인물', 'w'),
    folder('s', '하위', 'c'),
    folder('j', '일기'),
  ]
  // 목록 순서 = 최근 수정 순. 일기/색인 이 가장 최근
  const all = [
    doc('diary', '색인', 'j'),
    doc('person', '색인', 'p'),
    doc('top', '색인', null),
    doc('wiki', '색인', 'w'),
    doc('sub', '색인', 's'),
    doc('same', '색인', 'c'),
  ]
  const without = (...ids: string[]) => all.filter((d) => !ids.includes(d.id))
  const pick = (docs: WikiDocRef[], source: string | null = 'c') => createWikiResolver(docs, folders).resolve('색인', source)?.id

  it('같은 폴더 > 위키/색인 > 최상위 색인 > 위키/개념/하위 > 위키/인물/색인 > 일기/색인', () => {
    expect(pick(all)).toBe('same')
    expect(pick(without('same'))).toBe('wiki')
    expect(pick(without('same', 'wiki'))).toBe('top')
    expect(pick(without('same', 'wiki', 'top'))).toBe('sub')
    expect(pick(without('same', 'wiki', 'top', 'sub'))).toBe('person')
    expect(pick(without('same', 'wiki', 'top', 'sub', 'person'))).toBe('diary')
  })

  it('원본 자손 폴더 후보는 조상 후보에 진다', () => {
    expect(pick([doc('sub', '색인', 's'), doc('wiki', '색인', 'w')])).toBe('wiki')
  })

  it('17장 Q2 — 최상위 후보가 볼트 안 사촌 후보를 이긴다', () => {
    expect(pick([doc('person', '색인', 'p'), doc('top', '색인', null)])).toBe('top')
  })

  it('같은 단계 안은 목록 앞', () => {
    expect(pick([doc('first', '색인', 'c'), doc('second', '색인', 'c')])).toBe('first')
    expect(pick([doc('first', '색인', 'j'), doc('second', '색인', 'j')])).toBe('first')
  })

  it('최상위 원본은 최상위 후보가 1단계', () => {
    expect(pick(all, null)).toBe('top')
  })

  it('공유받은 원본은 같은 남의 폴더 후보, 없으면 4단계(목록 앞)', () => {
    expect(pick(all, 'foreign')).toBe('diary')
    expect(pick([...all, doc('mine', '색인', 'foreign')], 'foreign')).toBe('mine')
  })
})

describe('U7 — 순환·없는 부모에서도 끝난다', () => {
  const folders = [
    folder('A', 'A', 'B'),
    folder('B', 'B', 'A'),
    folder('C', 'C', 'A'),
    folder('S', 'S', 'S'),
    folder('O', 'O', 'missing'),
  ]
  const docs = [doc('inA', 'x', 'A'), doc('inB', 'x', 'B'), doc('inC', 'x', 'C'), doc('inS', 'x', 'S'), doc('inO', 'x', 'O')]
  const r = createWikiResolver(docs, folders)

  it('folderNames — C→A, A↔B 에서 C 는 [A, C], A 는 [A]', () => {
    expect(r.folderNames('C')).toEqual(['A', 'C'])
    expect(r.folderNames('A')).toEqual(['A'])
    expect(r.folderNames('B')).toEqual(['B'])
    expect(r.folderNames('S')).toEqual(['S'])
    expect(r.folderNames('O')).toEqual(['O'])
  })

  it('resolve·findLinkFolder 가 끝난다', () => {
    for (const source of ['A', 'B', 'C', 'S', 'O', null]) {
      expect(r.resolve('x', source)).not.toBeNull()
      expect(r.resolve('A/C/x', source)?.id).toBe('inC')
      expect(r.resolve('B/A/x', source)).toBeNull()
      expect(r.findLinkFolder('A/C/새', source)).toEqual({ folderId: 'C', title: '새' })
      expect(r.findLinkFolder('B/A/새', source)).toBeNull()
    }
    expect(r.resolve('x', 'C')?.id).toBe('inC')
    expect(r.resolve('x', 'A')?.id).toBe('inA')
  })
})

describe('U8 — findLinkFolder·shortestWikiTarget·folderNames', () => {
  const folders = [
    folder('g1', '교안'),
    folder('h', '과제'),
    folder('y1', '2024'),
    folder('y1g', '교안', 'y1'),
    folder('y2', '2025'),
    folder('y2g', '교안', 'y2'),
    folder('y2x', '기타', 'y2'),
  ]

  it('맞는 폴더 하나', () => {
    const r = createWikiResolver([], folders)
    expect(r.findLinkFolder('과제/새 글', null)).toEqual({ folderId: 'h', title: '새 글' })
    expect(r.findLinkFolder('2025/교안/새 글', null)).toEqual({ folderId: 'y2g', title: '새 글' })
  })

  it('여럿이면 4.4 순서, 같은 단계 안은 folders 배열 순서', () => {
    const r = createWikiResolver([], folders)
    expect(r.findLinkFolder('교안/새 글', 'y2x')?.folderId).toBe('y2g')
    expect(r.findLinkFolder('교안/새 글', 'y1g')?.folderId).toBe('y1g')
    expect(r.findLinkFolder('교안/새 글', null)?.folderId).toBe('g1')
    expect(r.findLinkFolder('교안/새 글', 'h')?.folderId).toBe('g1')
  })

  it('없으면 null, .md 는 떼지 않는다', () => {
    const r = createWikiResolver([], folders)
    expect(r.findLinkFolder('없는폴더/새 글', null)).toBeNull()
    expect(r.findLinkFolder('새 글', null)).toBeNull()
    expect(r.findLinkFolder('교안//새 글', null)).toBeNull()
    expect(r.findLinkFolder('과제/새 글.md', null)).toEqual({ folderId: 'h', title: '새 글.md' })
  })

  it('shortestWikiTarget — 제목만 풀리면 제목, 아니면 과제/1주차', () => {
    const docs = [doc('hw', '1주차', 'h'), doc('lec', '1주차', 'g1'), doc('solo', '혼자')]
    const r = createWikiResolver(docs, folders)
    expect(shortestWikiTarget(r, docs[1], 'g1')).toBe('1주차')
    expect(shortestWikiTarget(r, docs[0], 'g1')).toBe('과제/1주차')
    expect(shortestWikiTarget(r, docs[2], 'g1')).toBe('혼자')
  })

  it('shortestWikiTarget — 두 칸 위까지 늘린다', () => {
    const docs = [doc('a', '1주차', 'y1g'), doc('b', '1주차', 'y2g')]
    const r = createWikiResolver(docs, folders)
    expect(shortestWikiTarget(r, docs[1], 'y1g')).toBe('2025/교안/1주차')
  })

  it('shortestWikiTarget — 어느 형태로도 안 되면 제목', () => {
    const docs = [doc('top', '1주차'), doc('shared', '1주차', 'foreign')]
    const r = createWikiResolver(docs, folders)
    expect(shortestWikiTarget(r, docs[1], null)).toBe('1주차')
  })

  it('folderNames — 최상위 [], 모르는 폴더 null, 폴더 안은 위 → 아래', () => {
    const r = createWikiResolver([], folders)
    expect(r.folderNames(null)).toEqual([])
    expect(r.folderNames('foreign')).toBeNull()
    expect(r.folderNames('y2g')).toEqual(['2025', '교안'])
  })

  it('docs 는 받은 그대로', () => {
    const docs = [doc('a', 'a')]
    expect(createWikiResolver(docs, []).docs).toBe(docs)
  })
})
