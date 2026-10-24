import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import AppScreens, { type AppScreensProps } from '../../../src/app/AppScreens'
import SharedView from '../../../src/app/share/SharedView'
import SharesPage from '../../../src/app/share/SharesPage'
import HelpPage from '../../../src/app/help/HelpPage'
import TrashPage from '../../../src/app/trash/TrashPage'
import EmptyState from '../../../src/app/document/EmptyState'

// jsdom 없이 컴포넌트 함수를 직접 불러 엘리먼트 트리를 훑는다 (F-2081 6장)
type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } }

function collect(node: unknown, className: string, out: El[] = []): El[] {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, className, out))
    return out
  }
  const el = node as El
  if (el.props?.className === className) out.push(el)
  if (el.props?.children !== undefined) collect(el.props.children, className, out)
  return out
}

const firstChild = (el: El) => (Array.isArray(el.props.children) ? el.props.children[0] : el.props.children) as El

const allOn = {
  bootPhase: 'ready',
  sharedDoc: { title: '공유', content: '' },
  sharesOpen: true,
  helpOpen: true,
  mapRoute: { centerDocId: null },
  isEmpty: true,
  account: { state: 'in', id: 'u1' },
  docs: [],
  ownedDocs: [],
  sharesLinks: [],
  sharesGrants: [],
  dbBlockedMessage: null,
  localFile: { session: null },
}

function areas(props: Record<string, unknown>) {
  return collect(AppScreens(props as unknown as AppScreensProps), 'content-area')
}

describe('F-2081 U1~U6 AppScreens 갈래', () => {
  it('U1 모두 참이면 공유 보기', () => {
    const found = areas(allOn)
    expect(found).toHaveLength(1)
    expect(firstChild(found[0]).type).toBe(SharedView)
  })
  it('U2 공유 문서가 없으면 공유 관리', () => {
    const found = areas({ ...allOn, sharedDoc: null })
    expect(found).toHaveLength(1)
    expect(firstChild(found[0]).type).toBe(SharesPage)
  })
  it('U3 공유 관리가 닫히면 도움말', () => {
    const found = areas({ ...allOn, sharedDoc: null, sharesOpen: false })
    expect(found).toHaveLength(1)
    expect(firstChild(found[0]).type).toBe(HelpPage)
  })
  it('U3b 도움말이 닫히고 휴지통이 열리면 휴지통, 지도보다 앞', () => {
    const found = areas({ ...allOn, sharedDoc: null, sharesOpen: false, helpOpen: false, trashOpen: true, trashPage: {} })
    expect(found).toHaveLength(1)
    expect(firstChild(found[0]).type).toBe(TrashPage)
  })
  it('U4 도움말이 닫히면 지도(Suspense)', () => {
    const found = areas({ ...allOn, sharedDoc: null, sharesOpen: false, helpOpen: false })
    expect(found).toHaveLength(1)
    expect(firstChild(found[0]).type).toBe(Suspense)
  })
  it('U5 지도가 없으면 홈', () => {
    const found = areas({ ...allOn, sharedDoc: null, sharesOpen: false, helpOpen: false, mapRoute: null })
    expect(found).toHaveLength(1)
    expect(firstChild(found[0]).type).toBe(EmptyState)
  })
  it('U6 부팅 중 막힘 문구', () => {
    const found = areas({ ...allOn, bootPhase: 'booting', dbBlockedMessage: '막힘', sharedDoc: null, sharesOpen: false, helpOpen: false, mapRoute: null, isEmpty: false })
    expect(found).toHaveLength(1)
    expect(found[0].props['data-editor-slot']).toBe(true)
    const p = firstChild(found[0])
    expect(p.type).toBe('p')
    expect(p.props.className).toBe('boot-blocked-notice')
    expect(p.props.children).toBe('막힘')
  })
})
