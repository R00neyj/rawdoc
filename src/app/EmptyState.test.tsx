import { describe, expect, it, vi } from 'vitest'
import EmptyState from './EmptyState'

// jsdom 없이(새 의존성 없음) 컴포넌트 함수를 직접 호출해 나온 엘리먼트 트리를 순회해 onClick 까지 검증한다
type Node = { type: unknown; props?: { className?: unknown; children?: unknown; onClick?: () => void } } | null | undefined | boolean | string | number

function collect(node: Node | Node[], className: string, out: Extract<Node, object>[] = []) {
  if (node == null || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n as Node, className, out))
    return out
  }
  if (typeof node !== 'object') return out
  if (node.props?.className === className) out.push(node)
  if (node.props?.children !== undefined) collect(node.props.children as Node, className, out)
  return out
}

const baseProps = {
  hasDocs: true,
  onCreateDoc: () => {},
  onImportDoc: () => {},
  onSelectDoc: () => {},
}

function makeDocs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `doc-${i}`,
    title: `문서 ${i}`,
    updatedAt: 1_700_000_000_000 + i,
  }))
}

describe('F-241 A1 5개 자르기', () => {
  it('문서 8개를 넘겨도 항목은 5개만 렌더한다', () => {
    const tree = EmptyState({ ...baseProps, recentDocs: makeDocs(8) })
    expect(collect(tree, 'empty-state-recent-item')).toHaveLength(5)
  })
})

describe('F-241 A2 빈 목록', () => {
  it('문서 0개면 머리글도 목록도 렌더하지 않는다', () => {
    const tree = EmptyState({ ...baseProps, recentDocs: [] })
    expect(collect(tree, 'empty-state-recent-heading')).toHaveLength(0)
    expect(collect(tree, 'empty-state-recent')).toHaveLength(0)
    expect(collect(tree, 'empty-state-recent-item')).toHaveLength(0)
  })
})

describe('F-241 A3 클릭', () => {
  it('항목을 누르면 onSelectDoc 이 그 문서 id 로 불린다', () => {
    const onSelectDoc = vi.fn()
    const docs = makeDocs(3)
    const tree = EmptyState({ ...baseProps, recentDocs: docs, onSelectDoc })
    const items = collect(tree, 'empty-state-recent-item')
    expect(items).toHaveLength(3)

    items[1].props?.onClick?.()

    expect(onSelectDoc).toHaveBeenCalledTimes(1)
    expect(onSelectDoc).toHaveBeenCalledWith('doc-1')
  })
})
