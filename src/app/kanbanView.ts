// 칸반 문서의 보드·원문 보기 전이 — 문서마다 두고 저장하지 않는다 (F-2140 2장)
export type KanbanView = 'board' | 'source'
export type KanbanViewEvent =
  | { kind: 'open'; isKanban: boolean }
  | { kind: 'kanbanChanged'; isKanban: boolean }
  | { kind: 'choose'; view: KanbanView }
  | { kind: 'chooseMode'; mode: 'live' | 'raw' | 'view' }

export function nextKanbanView(prev: KanbanView, e: KanbanViewEvent): KanbanView {
  switch (e.kind) {
    case 'open':
      return e.isKanban ? 'board' : 'source'
    // 원문에서 `kanban: true` 를 치는 도중에는 화면을 바꾸지 않는다
    case 'kanbanChanged':
      return e.isKanban ? prev : 'source'
    case 'choose':
      return e.view
    case 'chooseMode':
      return 'source'
  }
}
