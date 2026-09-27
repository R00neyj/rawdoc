// 서식·단락·삽입 팔레트 명령 — 우클릭 메뉴 목록(EDITOR_COMMANDS)에서 파생, 순수 (specs/features/F-2055.md 3.3)
import { EDITOR_COMMANDS, isEditorCommandDisabled, type EditorCommandGroup } from './contextMenuItems'
import type { PaletteActionCommand } from './paletteContract'

// 링크 둘은 메뉴에서 맨 위 낱개지만 팔레트에서는 삽입 묶음으로 보인다 (5.1)
export const EDITOR_PALETTE_GROUP_LABEL: Record<EditorCommandGroup, string> = {
  link: '삽입',
  format: '서식',
  paragraph: '단락',
  insert: '삽입',
}

export const EDITOR_PALETTE_COMMANDS: readonly PaletteActionCommand[] = EDITOR_COMMANDS.map((spec) => ({
  id: `editor.${spec.id}`,
  kind: 'action',
  label: `${EDITOR_PALETTE_GROUP_LABEL[spec.group]}: ${spec.label}`,
  shortcut: spec.shortcut,
  keywords: spec.keywords,
  // 없으면 본문에서 연 팔레트가 아니다(4.1). 비활성 명령은 흐리게 두지 않고 뺀다(F-2022 3.2)
  when: (ctx) => Boolean(ctx.editor) && !isEditorCommandDisabled(spec, ctx.editor!.disabled),
  run: (ctx) => ctx.editor?.run(spec.run),
}))
