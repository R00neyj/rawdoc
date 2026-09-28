import { describe, expect, it } from 'vitest'
import AppDialogs, { type AppDialogsProps } from '../../../src/app/AppDialogs'
import Dialog from '../../../src/app/Dialog'
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
    expect(bulkDialog({ bulkDeleteItems: [{}, {}, {}] })).toEqual({ open: true, text: '선택한 3개 항목을 삭제할까요? 되돌릴 수 없습니다.' })
  })
  it('U8 항목이 없으면 닫히고 0개', () => {
    expect(bulkDialog({ bulkDeleteItems: null })).toEqual({ open: false, text: '선택한 0개 항목을 삭제할까요? 되돌릴 수 없습니다.' })
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
