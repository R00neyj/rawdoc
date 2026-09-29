import { describe, expect, it } from 'vitest'
import { helpMenuItems } from '../../../src/app/helpMenuRules'

describe('F-2090 A1 helpMenuItems', () => {
  it('도움말·사용법·새 소식 세 항목이 이 순서', () => {
    expect(helpMenuItems()).toEqual([
      { key: 'help', label: '도움말', href: null },
      { key: 'guides', label: '사용법', href: '/guides' },
      { key: 'changelog', label: '새 소식', href: '/changelog' },
    ])
  })
})
