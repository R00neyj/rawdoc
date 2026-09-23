// 등록된 명령 목록 — 1차는 템플릿 삽입·인쇄 두 개 (specs/features/F-2022.md 3.3). 명령을 더할 때 고치는 곳이 여기다
import type { PaletteCommand } from './paletteContract'

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  {
    id: 'template.insert',
    kind: 'pick',
    label: '템플릿 삽입',
    keywords: ['템플릿', 'template', '서식', '양식', '틀', '넣기'],
    when: (ctx) => ctx.canInsertTemplate,
    stageTitle: '템플릿 삽입',
    placeholder: '템플릿 이름',
    emptyText: '맞는 템플릿이 없습니다',
    hint: (ctx) => (ctx.templates.some((t) => t.source.kind === 'doc') ? null : "최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다."),
    items: (ctx) => ctx.templates.map((t) => ({ id: t.id, label: t.title, detail: t.detail })),
    pick: (item, ctx, signal) => ctx.insertTemplate(item.id, signal),
  },
  {
    id: 'doc.print',
    kind: 'action',
    label: 'PDF (A4 인쇄)',
    keywords: ['인쇄', 'print', 'pdf', 'a4', '내보내기'],
    when: (ctx) => ctx.canPrint,
    run: (ctx) => ctx.printDoc(),
  },
]
