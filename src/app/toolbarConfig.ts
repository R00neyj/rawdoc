// 상단바 탭바 명령 목록 — F-167·168·169 StateCommand 를 가져다 목록화만 한다 (specs/features/F-233.md 2·3.2·3.3)
import type { ComponentType } from 'react'
import type { StateCommand } from '@codemirror/state'

import {
  toggleStrong,
  toggleEmphasis,
  insertLink,
  toggleStrike,
  toggleHighlight,
  toggleInlineCode,
  toggleMath,
  toggleComment,
  insertWikiLink,
  clearFormatting,
} from '../editor/formatCommands'
import {
  setBulletList,
  setOrderedList,
  setTaskList,
  setHeading,
  setParagraph,
  toggleQuote,
} from '../editor/blockCommands'
import {
  insertFootnote,
  insertTable,
  insertCallout,
  insertHorizontalRule,
  insertCodeBlock,
  insertMathBlock,
} from '../editor/insertCommands'
import {
  IconAddLink,
  IconExternalLink,
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconHighlight,
  IconInlineCode,
  IconFunctions,
  IconCalculate,
  IconComment,
  IconFormatClear,
  IconBulletList,
  IconOrderedList,
  IconChecklist,
  IconTitle,
  IconNotes,
  IconQuote,
  IconSuperscript,
  IconTable,
  IconCallout,
  IconHorizontalRule,
  IconCodeBlock,
  IconTabFormat,
  IconTabBlock,
  IconTabInsert,
} from './icons'

type IconComponent = ComponentType<{ size?: number; className?: string }>

export type ToolbarCommandItem = {
  kind: 'command'
  id: string
  label: string
  Icon: IconComponent
  run: StateCommand
}

export type ToolbarHeadingLevel = { level: number; label: string; run: StateCommand }

// 제목 1~6 은 아이콘 6개가 아니라 버튼 하나 + 작은 목록으로 (F-233.md 3.3)
export type ToolbarHeadingItem = {
  kind: 'heading'
  id: 'heading'
  label: string
  Icon: IconComponent
  levels: ToolbarHeadingLevel[]
}

export type ToolbarItem = ToolbarCommandItem | ToolbarHeadingItem
export type ToolbarTabId = 'format' | 'block' | 'insert'
// Icon 은 좁은 창 탭바에서 글자 대신 쓴다 (F-233.md 3.6, 2026-09-16 재개정 "아이콘으로 공간 최소화")
export type ToolbarTab = { id: ToolbarTabId; label: string; Icon: IconComponent; items: ToolbarItem[] }

const headingLevels: ToolbarHeadingLevel[] = [1, 2, 3, 4, 5, 6].map((level) => ({
  level,
  label: `제목 ${level}`,
  run: setHeading(level),
}))

// 순서는 F-167·168·169 3장 그대로 (F-233.md 3.2)
export const toolbarTabs: ToolbarTab[] = [
  {
    id: 'format',
    label: '서식',
    Icon: IconTabFormat,
    items: [
      { kind: 'command', id: 'wikilink', label: '링크 추가', Icon: IconAddLink, run: insertWikiLink },
      { kind: 'command', id: 'link', label: '외부 링크 추가', Icon: IconExternalLink, run: insertLink },
      { kind: 'command', id: 'bold', label: '볼드체', Icon: IconBold, run: toggleStrong },
      { kind: 'command', id: 'italic', label: '기울이기', Icon: IconItalic, run: toggleEmphasis },
      { kind: 'command', id: 'strike', label: '취소선', Icon: IconStrikethrough, run: toggleStrike },
      { kind: 'command', id: 'highlight', label: '하이라이트', Icon: IconHighlight, run: toggleHighlight },
      { kind: 'command', id: 'code', label: '코드', Icon: IconInlineCode, run: toggleInlineCode },
      { kind: 'command', id: 'math', label: '수식', Icon: IconFunctions, run: toggleMath },
      { kind: 'command', id: 'comment', label: '주석', Icon: IconComment, run: toggleComment },
      { kind: 'command', id: 'clear', label: '서식 지우기', Icon: IconFormatClear, run: clearFormatting },
    ],
  },
  {
    id: 'block',
    label: '단락',
    Icon: IconTabBlock,
    items: [
      { kind: 'command', id: 'bullet', label: '글머리 목록', Icon: IconBulletList, run: setBulletList },
      { kind: 'command', id: 'ordered', label: '숫자 목록', Icon: IconOrderedList, run: setOrderedList },
      { kind: 'command', id: 'task', label: '체크박스', Icon: IconChecklist, run: setTaskList },
      { kind: 'heading', id: 'heading', label: '제목', Icon: IconTitle, levels: headingLevels },
      { kind: 'command', id: 'paragraph', label: '본문', Icon: IconNotes, run: setParagraph },
      { kind: 'command', id: 'quote', label: '인용', Icon: IconQuote, run: toggleQuote },
    ],
  },
  {
    id: 'insert',
    label: '삽입',
    Icon: IconTabInsert,
    items: [
      { kind: 'command', id: 'footnote', label: '각주', Icon: IconSuperscript, run: insertFootnote },
      { kind: 'command', id: 'table', label: '표', Icon: IconTable, run: insertTable },
      { kind: 'command', id: 'callout', label: '콜아웃', Icon: IconCallout, run: insertCallout },
      { kind: 'command', id: 'hr', label: '수평선', Icon: IconHorizontalRule, run: insertHorizontalRule },
      { kind: 'command', id: 'codeblock', label: '코드 블럭', Icon: IconCodeBlock, run: insertCodeBlock },
      { kind: 'command', id: 'mathblock', label: '수식 블럭', Icon: IconCalculate, run: insertMathBlock },
    ],
  },
]
