import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AppDialogs, { type AppDialogsProps } from '../../../src/app/AppDialogs'
import Dialog from '../../../src/app/Dialog'
import ConfirmDeleteDialog from '../../../src/app/ConfirmDeleteDialog'
import E2eeMigrateDialog from '../../../src/app/E2eeMigrateDialog'

// jsdom 없이 컴포넌트 함수를 직접 불러 엘리먼트 트리를 훑는다 (F-2081 6장)
type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } }

function find(node: unknown, match: (el: El) => boolean, out: El[] = []): El[] {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    node.forEach((n) => find(n, match, out))
    return out
  }
  const el = node as El
  if (match(el)) out.push(el)
  if (el.props?.children !== undefined) find(el.props.children, match, out)
  return out
}

const render = (props: Record<string, unknown>) => AppDialogs(props as unknown as AppDialogsProps)

function bulkDialog(props: Record<string, unknown>) {
  const [dialog] = find(render(props), (el) => el.type === Dialog)
  const [p] = find(dialog.props.children, (el) => el.type === 'p')
  return { open: dialog.props.open, text: ([] as unknown[]).concat(p.props.children).join('') }
}

const migrateOn = {
  e2ee: { keyring: { scope: { kind: 'server' } }, openSettingsDialogs: {}, dialogs: null },
  store: { kind: 'server', userId: 'u1' },
  account: { state: 'in', id: 'u1' },
}
const hasMigrate = (props: Record<string, unknown>) => find(render(props), (el) => el.type === E2eeMigrateDialog).length > 0

describe('F-2081 U7~U8 여러 항목 삭제 대화상자', () => {
  it('U7 항목 3개면 열리고 개수를 말한다', () => {
    expect(bulkDialog({ bulkDeleteItems: [{}, {}, {}], account: { state: 'out' } })).toEqual({ open: true, text: '선택한 3개 항목을 삭제할까요? 되돌릴 수 없습니다.' })
  })
  it('U8 항목이 없으면 닫히고 0개', () => {
    expect(bulkDialog({ bulkDeleteItems: null, account: { state: 'out' } })).toEqual({ open: false, text: '선택한 0개 항목을 삭제할까요? 되돌릴 수 없습니다.' })
  })
})

describe('F-2145 U9·U10 서버 저장소 지우기 문구', () => {
  const server = { store: { kind: 'server', userId: 'u1' }, account: { state: 'in', id: 'u1' } }

  it('U9 여러 항목 삭제는 휴지통 문구', () => {
    expect(bulkDialog({ ...server, bulkDeleteItems: [{}, {}, {}] }).text).toBe('선택한 3개 항목을 삭제할까요? 문서는 휴지통으로 옮겨지고 30일 뒤 영구히 지워집니다.')
  })
  it('U9 로컬 저장소는 지금 문구', () => {
    expect(bulkDialog({ store: { kind: 'idb' }, account: { state: 'out' }, bulkDeleteItems: [{}] }).text).toBe('선택한 1개 항목을 삭제할까요? 되돌릴 수 없습니다.')
  })
  it('U10 D-1 문서·폴더 아래 줄 — 서버는 휴지통, 로컬은 그대로', () => {
    const doc = { type: 'doc', id: 'd', name: '메모' }
    const folder = { type: 'folder', id: 'f', name: '폴더', empty: false }
    const dialogFor = (target: unknown, trash: boolean) =>
      renderToStaticMarkup(createElement(ConfirmDeleteDialog, { target, trash, onCancel: () => {}, onConfirm: () => {} } as never))
    expect(dialogFor(doc, true).replaceAll('&quot;', '"')).toContain('"메모" 을(를) 휴지통으로 옮길까요? 30일 뒤 영구히 지워집니다.')
    expect(dialogFor(doc, false).replaceAll('&quot;', '"')).toContain('"메모" 을(를) 삭제할까요? 되돌릴 수 없습니다.')
    expect(dialogFor(folder, true).replaceAll('&quot;', '"')).toContain('전부 삭제하면 안의 문서는 휴지통으로 옮겨집니다. 폴더와 폴더 공유는 되살릴 수 없습니다.')
    expect(dialogFor(folder, false).replaceAll('&quot;', '"')).toContain('전부 삭제하면 되돌릴 수 없습니다.')
  })
})

describe('F-2081 U9~U12 금고 옮기기 대화상자 조건', () => {
  it('U9 셋 다 참이면 있다', () => {
    expect(hasMigrate(migrateOn)).toBe(true)
  })
  it('U10 e2ee 가 없으면 없다', () => {
    expect(hasMigrate({ ...migrateOn, e2ee: null })).toBe(false)
  })
  it('U11 로컬 저장소면 없다', () => {
    expect(hasMigrate({ ...migrateOn, store: { kind: 'idb' } })).toBe(false)
  })
  it('U12 로그아웃이면 없다', () => {
    expect(hasMigrate({ ...migrateOn, account: { state: 'out' } })).toBe(false)
  })
})
