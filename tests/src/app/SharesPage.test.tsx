// F-243 A6 공유 관리 화면 — jsdom 없이 컴포넌트 함수를 직접 호출해 트리를 순회한다 (EmptyState.test.tsx 와 같은 방식)
import { describe, expect, it, vi } from 'vitest'
import SharesPage from '../../../src/app/SharesPage'
import type { ShareLinkRow, ShareGrantRow } from '../../../src/app/sharesApi'
import type { AccessRequestRow } from '../../../src/lib/accessRequest'

type Node =
  | { type: unknown; props?: { className?: unknown; children?: unknown; onClick?: (...a: unknown[]) => unknown } }
  | null
  | undefined
  | boolean
  | string
  | number

function collect(node: Node | Node[], className: string, out: Extract<Node, object>[] = []) {
  if (node == null || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n as Node, className, out))
    return out
  }
  if (typeof node !== 'object') return out
  const classes = String(node.props?.className ?? '').split(/\s+/)
  if (classes.includes(className)) out.push(node)
  if (node.props?.children !== undefined) collect(node.props.children as Node, className, out)
  return out
}

function textOf(node: Node | Node[]): string {
  if (node == null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  return textOf(node.props?.children as Node)
}

const CREATED_AT = 1_700_000_000_000
const CREATED_DATE = new Date(CREATED_AT)
const CREATED_DATE_STR = `${CREATED_DATE.getFullYear()}-${String(CREATED_DATE.getMonth() + 1).padStart(2, '0')}-${String(CREATED_DATE.getDate()).padStart(2, '0')}`

const link1: ShareLinkRow = { token: 't1', targetType: 'doc', targetId: 'd1', targetName: '회의록', createdAt: CREATED_AT }
const grant1: ShareGrantRow = { targetType: 'folder', targetId: 'f1', targetName: '업무', email: 'a@b.com', role: 'edit', createdAt: CREATED_AT }

const baseProps = {
  loggedIn: true,
  loading: false,
  links: [] as ShareLinkRow[],
  grants: [] as ShareGrantRow[],
  requests: [] as AccessRequestRow[],
  busyRequestIds: [] as string[],
  onClose: () => {},
  onOpenTarget: () => {},
  onRevokeLink: async () => {},
  onRevokeGrant: async () => {},
  onApproveRequest: async () => {},
  onRejectRequest: async () => {},
  onLogin: () => {},
  onNotice: () => {},
}

describe('F-243 A6 링크·초대 줄 렌더', () => {
  it('링크 1개 — 대상 이름·배지·날짜가 보인다', () => {
    const tree = SharesPage({ ...baseProps, links: [link1] })
    const rows = collect(tree, 'shares-link-row')
    expect(rows).toHaveLength(1)
    expect(textOf(rows[0])).toContain('회의록')
    expect(textOf(rows[0])).toContain('문서')
    expect(textOf(rows[0])).toContain(CREATED_DATE_STR)
  })

  it('초대 1개 — 대상 이름·이메일·권한 배지가 보인다', () => {
    const tree = SharesPage({ ...baseProps, grants: [grant1] })
    const rows = collect(tree, 'shares-grant-row')
    expect(rows).toHaveLength(1)
    expect(textOf(rows[0])).toContain('업무')
    expect(textOf(rows[0])).toContain('폴더')
    expect(textOf(rows[0])).toContain('a@b.com')
    expect(textOf(rows[0])).toContain('편집')
  })
})

describe('F-243 A6 빈 상태', () => {
  it('둘 다 비면 안내 문구 한 줄', () => {
    const tree = SharesPage({ ...baseProps })
    const empty = collect(tree, 'shares-empty')
    expect(empty).toHaveLength(1)
    expect(textOf(empty[0])).toBe('공유 중인 문서와 폴더가 없습니다.')
  })

  it('한쪽만 비면 그 묶음 자리에 없음', () => {
    const tree = SharesPage({ ...baseProps, links: [link1] })
    expect(collect(tree, 'shares-empty')).toHaveLength(0)
    const groupEmpty = collect(tree, 'shares-group-empty')
    expect(groupEmpty).toHaveLength(1)
    expect(textOf(groupEmpty[0])).toBe('없음')
  })
})

describe('F-243 A6 불러오는 중', () => {
  it('loading 이면 불러오는 중… 문구', () => {
    const tree = SharesPage({ ...baseProps, loading: true })
    expect(textOf(tree)).toContain('불러오는 중…')
  })
})

describe('F-243 A6 로그인 필요', () => {
  it('loggedIn=false 면 로그인 안내와 버튼', () => {
    const onLogin = vi.fn()
    const tree = SharesPage({ ...baseProps, loggedIn: false, onLogin })
    expect(textOf(tree)).toContain('로그인이 필요합니다.')
    const buttons = collect(tree, 'shares-login-btn')
    expect(buttons).toHaveLength(1)
    buttons[0].props?.onClick?.()
    expect(onLogin).toHaveBeenCalledTimes(1)
  })
})

describe('F-243 A6 해제·초대 삭제 콜백', () => {
  it('링크 해제 버튼을 누르면 onRevokeLink 가 그 링크로 불린다', () => {
    const onRevokeLink = vi.fn().mockResolvedValue(undefined)
    const tree = SharesPage({ ...baseProps, links: [link1], onRevokeLink })
    const buttons = collect(tree, 'shares-link-revoke')
    expect(buttons).toHaveLength(1)
    buttons[0].props?.onClick?.()
    expect(onRevokeLink).toHaveBeenCalledWith(link1)
  })

  it('초대 삭제 버튼을 누르면 onRevokeGrant 가 그 초대로 불린다', () => {
    const onRevokeGrant = vi.fn().mockResolvedValue(undefined)
    const tree = SharesPage({ ...baseProps, grants: [grant1], onRevokeGrant })
    const buttons = collect(tree, 'shares-grant-revoke')
    expect(buttons).toHaveLength(1)
    buttons[0].props?.onClick?.()
    expect(onRevokeGrant).toHaveBeenCalledWith(grant1)
  })
})

describe('F-243 A6 닫기', () => {
  it('닫기 버튼이 onClose 를 부른다', () => {
    const onClose = vi.fn()
    const tree = SharesPage({ ...baseProps, onClose })
    const buttons = collect(tree, 'shares-close')
    expect(buttons).toHaveLength(1)
    buttons[0].props?.onClick?.()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('F-243 A6 대상 이동', () => {
  it('대상 이름을 누르면 onOpenTarget 이 종류·id 로 불린다', () => {
    const onOpenTarget = vi.fn()
    const tree = SharesPage({ ...baseProps, links: [link1], onOpenTarget })
    const buttons = collect(tree, 'shares-target-btn')
    expect(buttons).toHaveLength(1)
    buttons[0].props?.onClick?.()
    expect(onOpenTarget).toHaveBeenCalledWith('doc', 'd1')
  })
})

describe('F-2136 U3 권한 요청 묶음', () => {
  const req1: AccessRequestRow = { id: 'r1', targetType: 'doc', targetId: 'd1', targetName: '기획안', email: 'a@x.com', name: '가나다', role: 'edit', createdAt: CREATED_AT }
  const req2: AccessRequestRow = { id: 'r2', targetType: 'folder', targetId: 'f1', targetName: '업무', email: 'b@x.com', name: '', role: 'view', createdAt: CREATED_AT }

  it('요청 0개면 묶음을 그리지 않는다', () => {
    const tree = SharesPage({ ...baseProps, links: [link1] })
    expect(collect(tree, 'shares-request-row')).toHaveLength(0)
    expect(textOf(tree)).not.toContain('권한 요청')
  })

  it('요청 2개면 행 2개, 머리에 수 2', () => {
    const tree = SharesPage({ ...baseProps, requests: [req1, req2] })
    expect(collect(tree, 'shares-request-row')).toHaveLength(2)
    expect(textOf(collect(tree, 'shares-group-title')[0])).toBe('권한 요청 2')
  })

  it('행 내용: 요청자 이름·이메일, 이름이 비면 이메일만, 권한·날짜', () => {
    const rows = collect(SharesPage({ ...baseProps, requests: [req1, req2] }), 'shares-request-row')
    expect(textOf(rows[0])).toContain('기획안')
    expect(textOf(rows[0])).toContain('문서')
    expect(textOf(rows[0])).toContain('가나다 · a@x.com')
    expect(textOf(rows[0])).toContain('편집')
    expect(textOf(rows[0])).toContain(CREATED_DATE_STR)
    expect(textOf(rows[1])).toContain('폴더')
    expect(textOf(rows[1])).toContain('보기')
    expect(textOf(collect(rows[1], 'shares-request-who')[0])).toBe('b@x.com')
  })

  it('요청만 있어도 빈 상태 문구는 없다', () => {
    expect(collect(SharesPage({ ...baseProps, requests: [req1] }), 'shares-empty')).toHaveLength(0)
  })

  it('승인·거절 버튼은 그 행으로 콜백을 부른다', () => {
    const onApproveRequest = vi.fn().mockResolvedValue(undefined)
    const onRejectRequest = vi.fn().mockResolvedValue(undefined)
    const tree = SharesPage({ ...baseProps, requests: [req1, req2], onApproveRequest, onRejectRequest })
    collect(tree, 'shares-request-approve')[1].props?.onClick?.()
    collect(tree, 'shares-request-reject')[0].props?.onClick?.()
    expect(onApproveRequest).toHaveBeenCalledWith(req2)
    expect(onRejectRequest).toHaveBeenCalledWith(req1)
  })

  it('보내는 중인 행은 두 버튼이 비활성', () => {
    const tree = SharesPage({ ...baseProps, requests: [req1, req2], busyRequestIds: ['r1'] })
    const approve = collect(tree, 'shares-request-approve') as { props: { disabled?: boolean } }[]
    const reject = collect(tree, 'shares-request-reject') as { props: { disabled?: boolean } }[]
    expect([approve[0].props.disabled, reject[0].props.disabled]).toEqual([true, true])
    expect([approve[1].props.disabled, reject[1].props.disabled]).toEqual([false, false])
  })
})
