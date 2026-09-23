import { describe, expect, it } from 'vitest'
import { listTemplates, formatTemplateDate, expandTemplateVariables, planTemplateInsert, isTemplateFolderName } from './templates'
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
