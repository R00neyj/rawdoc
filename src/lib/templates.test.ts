import { describe, expect, it } from 'vitest'
import {
  listTemplates,
  formatTemplateDate,
  expandTemplateVariables,
  planTemplateInsert,
  isTemplateFolderName,
  resolveNewDocTemplate,
  newDocContentFromTemplate,
  newDocTemplateOptions,
  type TemplateEntry,
} from './templates'
import { BUILTIN_TEMPLATES } from './builtinTemplates'
import type { FolderLike } from './folderTree'

describe('isTemplateFolderName — 4.2', () => {
  it('템플릿·templates(대소문자 무시)만 인정', () => {
    expect(isTemplateFolderName('템플릿')).toBe(true)
    expect(isTemplateFolderName('Templates')).toBe(true)
    expect(isTemplateFolderName('TEMPLATES')).toBe(true)
    expect(isTemplateFolderName(' 템플릿 ')).toBe(true)
    expect(isTemplateFolderName('템플릿함')).toBe(false)
    expect(isTemplateFolderName('일반')).toBe(false)
  })
})

describe('listTemplates — U4 (F-2022.md 11.1)', () => {
  const folders: FolderLike[] = [
    { id: 'A', name: '템플릿', parentId: null },
    { id: 'B', name: '회의', parentId: 'A' },
    { id: 'C', name: 'Templates', parentId: null },
    { id: 'D', name: '일반', parentId: null },
    { id: 'E', name: '템플릿', parentId: 'D' },
  ]
  const docs = [
    { id: 'doc-na', title: '나', folderId: 'A' },
    { id: 'doc-ga', title: '가', folderId: 'B' },
    { id: 'doc-da', title: '다', folderId: 'C' },
    { id: 'doc-ra', title: '라', folderId: 'E' },
    { id: 'doc-ma', title: '마', folderId: 'A', role: 'edit' as const },
    { id: 'doc-blank', title: '  ', folderId: 'A' },
  ]

  it('최상위 템플릿·Templates 폴더 하위 문서만 — 공유받은 것·중첩 템플릿 폴더 제외, 제목 가나다순', () => {
    const entries = listTemplates({ folders, docs })
    const userEntries = entries.filter((e) => e.source.kind === 'doc')
    expect(userEntries.map((e) => ({ title: e.title, detail: e.detail, id: e.id }))).toEqual([
      { title: '가', detail: '템플릿 / 회의', id: 'doc:doc-ga' },
      { title: '나', detail: '템플릿', id: 'doc:doc-na' },
      { title: '다', detail: 'Templates', id: 'doc:doc-da' },
      { title: '제목 없는 문서', detail: '템플릿', id: 'doc:doc-blank' },
    ])
  })

  it('사용자 템플릿 뒤에 내장 4개가 4.4 순서로, detail 내장', () => {
    const entries = listTemplates({ folders, docs })
    const builtin = entries.filter((e) => e.source.kind === 'builtin')
    expect(builtin.map((e) => e.id)).toEqual(BUILTIN_TEMPLATES.map((t) => `builtin:${t.key}`))
    expect(builtin.every((e) => e.detail === '내장')).toBe(true)
    expect(entries.slice(-BUILTIN_TEMPLATES.length)).toEqual(builtin)
  })
})

describe('formatTemplateDate — U5 (2026-09-23 09:05:07 수요일 기준)', () => {
  const now = new Date(2026, 8, 23, 9, 5, 7)

  it.each([
    ['YYYY-MM-DD', '2026-09-23'],
    ['HH:mm', '09:05'],
    ['YY.M.D H:mm:ss', '26.9.23 9:05:07'],
    ['YYYY년 M월 D일 dddd', '2026년 9월 23일 수요일'],
    ['ddd', '수'],
    ['[오늘] YYYY', '오늘 2026'],
    ['Do', '23o'],
  ])('%s → %s', (format, expected) => {
    expect(formatTemplateDate(now, format)).toBe(expected)
  })
})

describe('expandTemplateVariables — U6', () => {
  const now = new Date(2026, 8, 23, 9, 5, 7)

  it('{{date}} {{time}} {{title}}', () => {
    expect(expandTemplateVariables('{{date}} {{time}} {{title}}', { title: '주간 회의', now })).toBe('2026-09-23 09:05 주간 회의')
  })

  it('{{date:형식}}', () => {
    expect(expandTemplateVariables('{{date:YYYY}}', { title: '주간 회의', now })).toBe('2026')
  })

  it('안쪽 공백·대문자·형식 없는 title·모르는 이름은 글자 그대로', () => {
    const input = '{{ date }} {{Date}} {{title:x}} {{모름}}'
    expect(expandTemplateVariables(input, { title: '주간 회의', now })).toBe(input)
  })

  it('제목이 공백뿐이면 제목 없는 문서', () => {
    expect(expandTemplateVariables('{{title}}', { title: '   ', now })).toBe('제목 없는 문서')
  })
})

describe('planTemplateInsert — U7', () => {
  it('① 프론트매터 둘 다 없음 — 본문만, 앞뒤 빈 줄 뗀다', () => {
    const plan = planTemplateInsert('본문', '\n\n## A\n\n')
    expect(plan).toEqual({ frontmatterChange: null, body: '## A', frontmatterSkipped: false })
  })

  it('② 문서 빈 문자열 — 템플릿 전체를 그대로(프론트매터 합치기 안 함)', () => {
    const plan = planTemplateInsert('', '\n---\nk: v\n---\n\n## A\n\n')
    expect(plan).toEqual({ frontmatterChange: null, body: '---\nk: v\n---\n\n## A', frontmatterSkipped: false })
  })

  it('③ 문서 없음·템플릿 있음 — 문서 맨 앞(0)에 통째로', () => {
    const plan = planTemplateInsert('본문', '---\nk: v\n---\n\n## A')
    expect(plan).toEqual({ frontmatterChange: { from: 0, to: 0, insert: '---\nk: v\n---\n' }, body: '## A', frontmatterSkipped: false })
  })

  it('④ 둘 다 있고 파싱 성공 — 없는 키만 원래 줄 그대로 문서 닫는 줄 앞에', () => {
    const doc = '---\ntags: 기존\n---\n\n본문'
    const tpl = '---\ndate: 1\ntags:\n  - 회의\n---\n\n## A'
    const plan = planTemplateInsert(doc, tpl)
    expect(plan.frontmatterChange).toEqual({ from: 13, to: 13, insert: 'date: 1\n' })
    expect(plan.body).toBe('## A')
    expect(plan.frontmatterSkipped).toBe(false)
  })

  it('⑤ 어느 한쪽 파싱 실패 — 프론트매터는 그대로, 본문만, skipped true', () => {
    const doc = '---\na:\n  b: c\n---\n본문'
    const tpl = '---\ndate: 1\ntags:\n  - 회의\n---\n\n## A'
    const plan = planTemplateInsert(doc, tpl)
    expect(plan.frontmatterChange).toBeNull()
    expect(plan.body).toBe('## A')
    expect(plan.frontmatterSkipped).toBe(true)
  })

  it('⑥ 템플릿이 프론트매터뿐 — body 는 빈 문자열', () => {
    const plan = planTemplateInsert('본문', '---\nk: v\n---')
    expect(plan.frontmatterChange).toEqual({ from: 0, to: 0, insert: '---\nk: v\n---\n' })
    expect(plan.body).toBe('')
  })

  it('⑦ 마지막 줄 끝 공백은 다듬지 않는다', () => {
    const plan = planTemplateInsert('본문', '- [ ] ')
    expect(plan.body).toBe('- [ ] ')
  })
})

// F-2037.md 8.1 U1~U3, U7
describe('resolveNewDocTemplate — F-2037 U1', () => {
  const entries: TemplateEntry[] = [
    { id: 'doc:1', title: '주간 보고', detail: '템플릿', source: { kind: 'doc', docId: '1' } },
    ...BUILTIN_TEMPLATES.map((t) => ({ id: `builtin:${t.key}`, title: t.title, detail: '내장', source: { kind: 'builtin' as const, body: t.body } })),
  ]

  it.each([
    ['none', { kind: 'none' }],
    ['builtin:meeting', { kind: 'found', title: '회의록' }],
    ['doc:1', { kind: 'found', title: '주간 보고' }],
    ['doc:9', { kind: 'missing' }],
    ['builtin:nope', { kind: 'missing' }],
    ['', { kind: 'missing' }],
    ['xyz', { kind: 'missing' }],
  ])('pref=%s', (pref, expected) => {
    const result = resolveNewDocTemplate(pref, entries)
    expect(result.kind).toBe(expected.kind)
    if (result.kind === 'found') expect(result.entry.title).toBe((expected as { title: string }).title)
  })
})

describe('newDocContentFromTemplate — F-2037 U2 (2026-09-25 09:05:07 기준)', () => {
  const now = new Date(2026, 8, 25, 9, 5, 7)
  const meetingBody = BUILTIN_TEMPLATES.find((t) => t.key === 'meeting')!.body

  it('① 내장 meeting body, 제목 빈 글자·keep-empty, crlf', () => {
    expect(newDocContentFromTemplate(meetingBody, { title: '', now, emptyTitle: 'keep-empty' }, 'crlf')).toBe(
      '## 회의 — 2026-09-25\r\n\r\n- 참석:\r\n- 안건:\r\n\r\n### 논의\r\n\r\n### 결정\r\n\r\n### 할 일\r\n\r\n- [ ] ',
    )
  })

  it('② 프론트매터 있는 사용자 템플릿, 제목 팀 회의, lf', () => {
    const tpl = '\r\n\r\n---\r\ntitle: {{title}}\r\n---\r\n\r\n## {{title}}\r\n\r\n- \r\n\r\n'
    expect(newDocContentFromTemplate(tpl, { title: '팀 회의', now }, 'lf')).toBe('---\ntitle: 팀 회의\n---\n\n## 팀 회의\n\n- ')
  })

  it('③ 공백뿐인 템플릿 — 빈 문서', () => {
    expect(newDocContentFromTemplate('  \n \n', { title: '', now, emptyTitle: 'keep-empty' }, 'crlf')).toBe('')
  })

  it('④ 빈 템플릿 — 빈 문서', () => {
    expect(newDocContentFromTemplate('', { title: '', now, emptyTitle: 'keep-empty' }, 'crlf')).toBe('')
  })

  it('⑤ {{title}} 빈 글자로, crlf', () => {
    expect(newDocContentFromTemplate('## {{title}}\n\n- ', { title: '', now, emptyTitle: 'keep-empty' }, 'crlf')).toBe('## \r\n\r\n- ')
  })

  it('⑥ 템플릿이 {{title}} 하나뿐 — 빈 글자로 바뀌면 빈 문서', () => {
    expect(newDocContentFromTemplate('{{title}}', { title: '', now, emptyTitle: 'keep-empty' }, 'crlf')).toBe('')
  })

  it('⑦ 프론트매터 + {{title}}, keep-empty, crlf', () => {
    const tpl = '---\ntitle: {{title}}\n---\n\n## {{title}}'
    expect(newDocContentFromTemplate(tpl, { title: '', now, emptyTitle: 'keep-empty' }, 'crlf')).toBe('---\r\ntitle: \r\n---\r\n\r\n## ')
  })

  it('⑧ emptyTitle 없음 — 기본은 제목 없는 문서로 대체', () => {
    expect(newDocContentFromTemplate('## {{title}}', { title: '   ', now }, 'crlf')).toBe('## 제목 없는 문서')
  })
})

describe('newDocTemplateOptions — F-2037 U3', () => {
  const builtinOnly: TemplateEntry[] = BUILTIN_TEMPLATES.map((t) => ({
    id: `builtin:${t.key}`,
    title: t.title,
    detail: '내장',
    source: { kind: 'builtin' as const, body: t.body },
  }))

  it('ⓐ pref none, 내장만', () => {
    const options = newDocTemplateOptions('none', builtinOnly)
    expect(options.map((o) => o.label)).toEqual(['없음', '회의록', '일일 노트', '버그 보고', '주간 회고'])
    expect(options.map((o) => o.group)).toEqual(['none', 'builtin', 'builtin', 'builtin', 'builtin'])
  })

  it('ⓑ pref doc:1, 사용자 템플릿 둘 + 내장', () => {
    const entries: TemplateEntry[] = [
      { id: 'doc:2', title: '가', detail: '템플릿 / 회의', source: { kind: 'doc', docId: '2' } },
      { id: 'doc:1', title: '주간 보고', detail: '템플릿', source: { kind: 'doc', docId: '1' } },
      ...builtinOnly,
    ]
    const options = newDocTemplateOptions('doc:1', entries)
    expect(options.map((o) => o.label)).toEqual(['없음', '회의록', '일일 노트', '버그 보고', '주간 회고', '가 (템플릿 / 회의)', '주간 보고 (템플릿)'])
    expect(options.map((o) => o.group)).toEqual(['none', 'builtin', 'builtin', 'builtin', 'builtin', 'user', 'user'])
  })

  it('ⓒ pref doc:9(없음) — 맨 끝에 찾을 수 없는 템플릿', () => {
    const options = newDocTemplateOptions('doc:9', builtinOnly)
    expect(options.at(-1)).toEqual({ value: 'doc:9', label: '찾을 수 없는 템플릿', group: 'missing' })
    expect(options).toHaveLength(6)
  })
})

describe('expandTemplateVariables — emptyTitle 옵션 (F-2037 U7)', () => {
  const now = new Date(2026, 8, 25, 9, 5, 7)

  it.each([
    [undefined, '', '[제목 없는 문서]'],
    ['fallback', '', '[제목 없는 문서]'],
    ['keep-empty', '', '[]'],
    ['keep-empty', '   ', '[]'],
    ['keep-empty', '가', '[가]'],
  ] as const)('emptyTitle=%s title=%s', (emptyTitle, title, expected) => {
    expect(expandTemplateVariables('[{{title}}]', { title, now, emptyTitle })).toBe(expected)
  })
})
