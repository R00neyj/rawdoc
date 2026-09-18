// F-244 A3 도움말 페이지 — jsdom 없이 컴포넌트 함수를 직접 호출해 트리를 순회한다 (SharesPage.test.tsx 와 같은 방식)
import { describe, expect, it, vi } from 'vitest'
import HelpPage from './HelpPage'
import Viewer from '../viewer/Viewer'

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

function findByType(node: Node | Node[], type: unknown, out: Extract<Node, object>[] = []) {
  if (node == null || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    node.forEach((n) => findByType(n as Node, type, out))
    return out
  }
  if (typeof node !== 'object') return out
  if (node.type === type) out.push(node)
  if (node.props?.children !== undefined) findByType(node.props.children as Node, type, out)
  return out
}

function textOf(node: Node | Node[]): string {
  if (node == null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  return textOf(node.props?.children as Node)
}

describe('F-244 A3 HelpPage', () => {
  it('제목·내 문서로 복사·닫기가 렌더된다', () => {
    const tree = HelpPage({ onClose: () => {}, onCopy: () => {} })
    expect(textOf(tree)).toContain('도움말')
    expect(textOf(tree)).toContain('내 문서로 복사')
    expect(textOf(tree)).toContain('닫기')
  })

  it('닫기 버튼이 onClose 를 부른다', () => {
    const onClose = vi.fn()
    const tree = HelpPage({ onClose, onCopy: () => {} })
    const buttons = collect(tree, 'help-page-close')
    expect(buttons).toHaveLength(1)
    buttons[0].props?.onClick?.()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('내 문서로 복사 버튼이 onCopy 를 부른다', () => {
    const onCopy = vi.fn()
    const tree = HelpPage({ onClose: () => {}, onCopy })
    const buttons = collect(tree, 'help-page-copy')
    expect(buttons).toHaveLength(1)
    buttons[0].props?.onClick?.()
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  it('본문에 렌더된 HTML 이 Viewer 로 전달되고, 코드블록 복사가 켜져 있다', () => {
    const tree = HelpPage({ onClose: () => {}, onCopy: () => {} })
    const viewers = findByType(tree, Viewer)
    expect(viewers).toHaveLength(1)
    const props = viewers[0].props as unknown as { html: string; codeCopy?: boolean }
    expect(props.html).toContain('<strong>굵게</strong>')
    expect(props.codeCopy).toBe(true)
  })
})
