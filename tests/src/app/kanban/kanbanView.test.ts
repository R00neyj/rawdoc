import { describe, expect, it } from 'vitest'
import { nextKanbanView } from '../../../../src/app/kanban/kanbanView'

describe('F-2140 U1 nextKanbanView', () => {
  it('open — 칸반 문서는 늘 보드, 아니면 원문 (이전 보기와 무관)', () => {
    expect(nextKanbanView('source', { kind: 'open', isKanban: true })).toBe('board')
    expect(nextKanbanView('board', { kind: 'open', isKanban: false })).toBe('source')
  })

  it('kanbanChanged — 거짓이면 원문, 참이면 그대로', () => {
    expect(nextKanbanView('board', { kind: 'kanbanChanged', isKanban: false })).toBe('source')
    expect(nextKanbanView('source', { kind: 'kanbanChanged', isKanban: true })).toBe('source')
    expect(nextKanbanView('board', { kind: 'kanbanChanged', isKanban: true })).toBe('board')
  })

  it('chooseMode — 편집·원문·보기 어느 것이든 원문', () => {
    expect(nextKanbanView('board', { kind: 'chooseMode', mode: 'live' })).toBe('source')
    expect(nextKanbanView('board', { kind: 'chooseMode', mode: 'raw' })).toBe('source')
    expect(nextKanbanView('board', { kind: 'chooseMode', mode: 'view' })).toBe('source')
  })

  it('choose — 고른 보기로', () => {
    expect(nextKanbanView('source', { kind: 'choose', view: 'board' })).toBe('board')
    expect(nextKanbanView('board', { kind: 'choose', view: 'source' })).toBe('source')
  })
})
