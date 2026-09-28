import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorStateConfig, Extension } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import {
  SHORTCUT_CATALOG,
  SHORTCUT_GROUPS,
  isMacPlatform,
  formatChord,
  formatEntryKeys,
  visibleShortcuts,
  type ShortcutEntry,
} from '../../../src/app/shortcutCatalog'
import { buildEditorContextMenu, buildViewContextMenu, type ContextMenuNode } from '../../../src/app/contextMenuItems'
import { frontmatterExtension } from '../../../src/editor/frontmatter'
import { PALETTE_COMMANDS } from '../../../src/app/paletteCommands'

const ID_RE = /^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/

describe('SHORTCUT_CATALOG — U1', () => {
  it('23개, id 겹치지 않고 모양을 지킨다', () => {
    expect(SHORTCUT_CATALOG.length).toBe(23)
    const ids = SHORTCUT_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(ID_RE)
  })

  it('모든 group 이 SHORTCUT_GROUPS 에 있고 카탈로그가 묶음 순서대로 모여 있다', () => {
    for (const e of SHORTCUT_CATALOG) expect(SHORTCUT_GROUPS).toContain(e.group)
    const seen = new Set<string>()
    let lastGroup: string | null = null
    for (const e of SHORTCUT_CATALOG) {
      if (e.group !== lastGroup) {
        expect(seen.has(e.group), `묶음 ${e.group} 이 흩어져 있다`).toBe(false)
        seen.add(e.group)
        lastGroup = e.group
      }
    }
  })

  it('keys.length >= 1, label 이 비지 않았다', () => {
    for (const e of SHORTCUT_CATALOG) {
      expect(e.keys.length).toBeGreaterThanOrEqual(1)
      expect(e.label.length).toBeGreaterThan(0)
    }
  })

  it('hideOnMac 은 nav.contextMenu 하나, then 은 nav.leaveEditor 하나', () => {
    const hideOnMac = SHORTCUT_CATALOG.filter((e) => e.hideOnMac)
    expect(hideOnMac.map((e) => e.id)).toEqual(['nav.contextMenu'])
    const withThen = SHORTCUT_CATALOG.filter((e) => e.then)
    expect(withThen.map((e) => e.id)).toEqual(['nav.leaveEditor'])
  })
})

function entry(id: string): ShortcutEntry {
  const found = SHORTCUT_CATALOG.find((e) => e.id === id)
  if (!found) throw new Error(`${id} not found`)
  return found
}

describe('formatChord — U2 (맥 아님)', () => {
  it.each([
    [{ mod: true, key: 'KeyB' }, 'Ctrl+B'],
    [{ mod: true, shift: true, key: 'Slash' }, 'Ctrl+Shift+/'],
    [{ mod: true, alt: true, key: 'KeyM' }, 'Ctrl+Alt+M'],
    [{ shift: true, alt: true, key: 'ArrowUp' }, 'Shift+Alt+↑'],
    [{ key: 'Escape' }, 'Esc'],
    [{ key: 'ContextMenu' }, '메뉴 키'],
    [{ shift: true, key: 'F10' }, 'Shift+F10'],
    [{ ctrl: true, key: 'KeyM' }, 'Ctrl+M'],
  ])('%o → %s', (chord, expected) => {
    expect(formatChord(chord, false)).toBe(expected)
  })

  it('formatEntryKeys(nav.leaveEditor, false) → ["Esc 다음 Tab"]', () => {
    expect(formatEntryKeys(entry('nav.leaveEditor'), false)).toEqual(['Esc 다음 Tab'])
  })
})

describe('formatChord — U3 (맥)', () => {
  it.each([
    [{ mod: true, shift: true, key: 'Slash' }, '⇧⌘/'],
    [{ mod: true, alt: true, key: 'KeyM' }, '⌥⌘M'],
    [{ alt: true, key: 'Enter' }, '⌥Enter'],
    [{ shift: true, alt: true, key: 'ArrowUp' }, '⌥⇧↑'],
    [{ ctrl: true, key: 'KeyM' }, '⌃M'],
  ])('%o → %s', (chord, expected) => {
    expect(formatChord(chord, true)).toBe(expected)
  })

  it('formatEntryKeys(edit.redo, true) → ["⇧⌘Z"], (edit.redo, false) → ["Ctrl+Y","Ctrl+Shift+Z"]', () => {
    expect(formatEntryKeys(entry('edit.redo'), true)).toEqual(['⇧⌘Z'])
    expect(formatEntryKeys(entry('edit.redo'), false)).toEqual(['Ctrl+Y', 'Ctrl+Shift+Z'])
  })

  it('visibleShortcuts(true).length === 22, visibleShortcuts(false).length === 23', () => {
    expect(visibleShortcuts(true).length).toBe(22)
    expect(visibleShortcuts(false).length).toBe(23)
  })
})

describe('isMacPlatform — U4', () => {
  it.each([
    ['MacIntel', true],
    ['macOS', true],
    ['Win32', false],
    ['Windows', false],
    ['Linux x86_64', false],
    ['', false],
    [undefined, false],
    [null, false],
  ])('%s → %s', (platform, expected) => {
    expect(isMacPlatform(platform as string | undefined | null)).toBe(expected)
  })
})

// U9 — 카탈로그 ↔ 우클릭 메뉴·팔레트 키 문자열 일치 검사 (3장 표, 결정 11)
describe('U9 — 우클릭 메뉴·팔레트 키 문자열이 카탈로그와 같다', () => {
  const extensions: Extension[] = [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })]
  function makeState(doc: string, selection: EditorStateConfig['selection']) {
    const state = EditorState.create({ doc, selection, extensions })
    ensureSyntaxTree(state, doc.length, 5000)
    return state
  }

  function collectShortcutItems(nodes: ContextMenuNode[]): { id: string; shortcut: string }[] {
    const out: { id: string; shortcut: string }[] = []
    for (const n of nodes) {
      if (n.kind === 'item' && n.shortcut) out.push({ id: n.id, shortcut: n.shortcut })
      if (n.kind === 'submenu') out.push(...collectShortcutItems(n.items))
    }
    return out
  }

  const MENU_TO_CATALOG: Record<string, string> = {
    bold: 'format.bold',
    italic: 'format.italic',
    link: 'format.link',
    'comment-add': 'comment.add',
    palette: 'nav.palette',
  }
  const OUTSIDE_CATALOG = new Set(['cut', 'copy', 'paste', 'paste-text', 'select-all'])

  function assertMatches(items: { id: string; shortcut: string }[]) {
    for (const { id, shortcut } of items) {
      if (OUTSIDE_CATALOG.has(id)) continue
      const catalogId = MENU_TO_CATALOG[id]
      expect(catalogId, `메뉴 항목 ${id} 은 대응표에도 카탈로그 밖 목록에도 없다`).toBeDefined()
      const expected = formatChord(entry(catalogId).keys[0], false)
      expect(shortcut, `${id} ↔ ${catalogId}`).toBe(expected)
    }
  }

  it('buildEditorContextMenu(editor)', () => {
    const state = makeState('본문 줄', EditorSelection.cursor(0))
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: false, comment: { disabled: false } })
    assertMatches(collectShortcutItems(nodes))
  })

  it('buildEditorContextMenu(cell)', () => {
    const state = makeState('칸 글자', EditorSelection.cursor(0))
    const nodes = buildEditorContextMenu({ place: 'cell', state, hasSelection: false })
    assertMatches(collectShortcutItems(nodes))
  })

  it('buildViewContextMenu', () => {
    const nodes = buildViewContextMenu({ hasSelection: false })
    assertMatches(collectShortcutItems(nodes))
  })

  it('PALETTE_COMMANDS', () => {
    const items = PALETTE_COMMANDS.filter((c) => c.shortcut).map((c) => ({ id: c.id, shortcut: c.shortcut as string }))
    const MENU = {
      'comment.add': 'comment.add',
      'comment.toggleRail': 'comment.toggleRail',
      'shortcuts.open': 'nav.shortcuts',
      'search.open': 'find.search',
      // F-2055 서식 명령 — 우클릭 메뉴와 같은 글
      'editor.link': 'format.link',
      'editor.bold': 'format.bold',
      'editor.italic': 'format.italic',
    } as Record<string, string>
    for (const { id, shortcut } of items) {
      const catalogId = MENU[id]
      expect(catalogId, `팔레트 명령 ${id} 이 대응표에 없다`).toBeDefined()
      const expected = formatChord(entry(catalogId).keys[0], false)
      expect(shortcut).toBe(expected)
    }
  })
})
