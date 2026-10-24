import { IconDownload, IconNotes, IconPrint, IconRaw, IconCopy } from '../icons'
import type { MenuAction } from '../share/ShareMenu'

// 상단바 ⋯ 의 `내보내기` 하위 항목 (specs/features/F-278.md 3장, F-279.md 3장, F-280.md 3.3, small 2026-10-21)
export type ExportMenuProps = {
  disabled: boolean // 문서가 없을 때·공유 문서일 때 비활성 (3.2)
  onExportMd: () => void
  onExportTxt: () => void
  onPrintDoc: () => void
  onExportHtml: () => void
  onCopyRich: () => void
}

export function exportMenuItems({ onExportMd, onExportTxt, onPrintDoc, onExportHtml, onCopyRich }: Omit<ExportMenuProps, 'disabled'>): MenuAction[] {
  return [
    { key: 'md', label: '.md', icon: IconDownload, onSelect: onExportMd },
    { key: 'txt', label: '.txt (평문)', icon: IconNotes, onSelect: onExportTxt },
    { key: 'html', label: 'HTML 파일', icon: IconRaw, onSelect: onExportHtml },
    { key: 'print', label: 'PDF (A4 인쇄)', icon: IconPrint, onSelect: onPrintDoc },
    { key: 'copy-rich', label: '서식 있는 복사', icon: IconCopy, onSelect: onCopyRich },
  ]
}
