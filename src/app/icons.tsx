// 인라인 SVG 아이콘 (Google Material Symbols Outlined 400, specs/design.md 4장, F-142 2장)
// `?raw` 로 가져온 파일 콘텐츠에서 내부 마크업만 꺼내 쓴다. 색은 CSS `fill: currentColor` 만 쓴다
import editSvg from '@material-symbols/svg-400/outlined/edit.svg?raw'
import codeSvg from '@material-symbols/svg-400/outlined/code.svg?raw'
import visibilitySvg from '@material-symbols/svg-400/outlined/visibility.svg?raw'
import iosShareSvg from '@material-symbols/svg-400/outlined/ios_share.svg?raw'
import downloadSvg from '@material-symbols/svg-400/outlined/download.svg?raw'
import chevronRightSvg from '@material-symbols/svg-400/outlined/chevron_right.svg?raw'
// 사이드바 `새 문서` — note_add(페이지+플러스)는 가져오기(upload_file, 역시 페이지 모양)와
// 나란히 놓으면 작은 크기에서 헷갈려 note_stack_add(쌓인 노트)로 바꿨다 (2026-09-20 사용자 지적)
import noteAddSvg from '@material-symbols/svg-400/outlined/note_stack_add.svg?raw'
import createNewFolderSvg from '@material-symbols/svg-400/outlined/create_new_folder.svg?raw'
import uploadFileSvg from '@material-symbols/svg-400/outlined/upload_file.svg?raw'
import searchSvg from '@material-symbols/svg-400/outlined/search.svg?raw'
import settingsSvg from '@material-symbols/svg-400/outlined/settings.svg?raw'
import installDesktopSvg from '@material-symbols/svg-400/outlined/install_desktop.svg?raw'
import leftPanelCloseSvg from '@material-symbols/svg-400/outlined/left_panel_close.svg?raw'
import leftPanelOpenSvg from '@material-symbols/svg-400/outlined/left_panel_open.svg?raw'
import keepSvg from '@material-symbols/svg-400/outlined/keep.svg?raw'
import keepOffSvg from '@material-symbols/svg-400/outlined/keep_off.svg?raw'
import driveFileMoveSvg from '@material-symbols/svg-400/outlined/drive_file_move.svg?raw'
import deleteSvg from '@material-symbols/svg-400/outlined/delete.svg?raw'
import linkSvg from '@material-symbols/svg-400/outlined/link.svg?raw'
import linkOffSvg from '@material-symbols/svg-400/outlined/link_off.svg?raw'
import contentCopySvg from '@material-symbols/svg-400/outlined/content_copy.svg?raw'
import closeSvg from '@material-symbols/svg-400/outlined/close.svg?raw'
import moreHorizSvg from '@material-symbols/svg-400/outlined/more_horiz.svg?raw'
import refreshSvg from '@material-symbols/svg-400/outlined/refresh.svg?raw'
import formatAlignLeftSvg from '@material-symbols/svg-400/outlined/format_align_left.svg?raw'
import formatAlignCenterSvg from '@material-symbols/svg-400/outlined/format_align_center.svg?raw'
import formatAlignRightSvg from '@material-symbols/svg-400/outlined/format_align_right.svg?raw'
import brokenImageSvg from '@material-symbols/svg-400/outlined/broken_image.svg?raw'
import accountCircleSvg from '@material-symbols/svg-400/outlined/account_circle.svg?raw'
import loginSvg from '@material-symbols/svg-400/outlined/login.svg?raw'
import logoutSvg from '@material-symbols/svg-400/outlined/logout.svg?raw'
import checkSvg from '@material-symbols/svg-400/outlined/check.svg?raw'
import personAddSvg from '@material-symbols/svg-400/outlined/person_add.svg?raw'
import groupSvg from '@material-symbols/svg-400/outlined/group.svg?raw'
import keySvg from '@material-symbols/svg-400/outlined/key.svg?raw'
import tocSvg from '@material-symbols/svg-400/outlined/toc.svg?raw'
import openInNewSvg from '@material-symbols/svg-400/outlined/open_in_new.svg?raw'
import recenterSvg from '@material-symbols/svg-400/outlined/recenter.svg?raw'
import formatBoldSvg from '@material-symbols/svg-400/outlined/format_bold.svg?raw'
import keyboardArrowDownSvg from '@material-symbols/svg-400/outlined/keyboard_arrow_down.svg?raw'
import undoSvg from '@material-symbols/svg-400/outlined/undo.svg?raw'
import redoSvg from '@material-symbols/svg-400/outlined/redo.svg?raw'
import formatItalicSvg from '@material-symbols/svg-400/outlined/format_italic.svg?raw'
import strikethroughSSvg from '@material-symbols/svg-400/outlined/strikethrough_s.svg?raw'
import formatInkHighlighterSvg from '@material-symbols/svg-400/outlined/format_ink_highlighter.svg?raw'
import functionsSvg from '@material-symbols/svg-400/outlined/functions.svg?raw'
import calculateSvg from '@material-symbols/svg-400/outlined/calculate.svg?raw'
import commentSvg from '@material-symbols/svg-400/outlined/comment.svg?raw'
import formatClearSvg from '@material-symbols/svg-400/outlined/format_clear.svg?raw'
import formatListBulletedSvg from '@material-symbols/svg-400/outlined/format_list_bulleted.svg?raw'
import formatListNumberedSvg from '@material-symbols/svg-400/outlined/format_list_numbered.svg?raw'
import checklistSvg from '@material-symbols/svg-400/outlined/checklist.svg?raw'
import titleSvg from '@material-symbols/svg-400/outlined/title.svg?raw'
import notesSvg from '@material-symbols/svg-400/outlined/notes.svg?raw'
import formatQuoteSvg from '@material-symbols/svg-400/outlined/format_quote.svg?raw'
import superscriptSvg from '@material-symbols/svg-400/outlined/superscript.svg?raw'
import tableSvg from '@material-symbols/svg-400/outlined/table.svg?raw'
import stickyNote2Svg from '@material-symbols/svg-400/outlined/sticky_note_2.svg?raw'
import horizontalRuleSvg from '@material-symbols/svg-400/outlined/horizontal_rule.svg?raw'
import codeBlocksSvg from '@material-symbols/svg-400/outlined/code_blocks.svg?raw'
import textFormatSvg from '@material-symbols/svg-400/outlined/text_format.svg?raw'
import subjectSvg from '@material-symbols/svg-400/outlined/subject.svg?raw'
import addSvg from '@material-symbols/svg-400/outlined/add.svg?raw'
import helpSvg from '@material-symbols/svg-400/outlined/help.svg?raw'
import menuBookSvg from '@material-symbols/svg-400/outlined/menu_book.svg?raw'
import collapseAllSvg from '@material-symbols/svg-400/outlined/collapse_all.svg?raw'
// 내보내기 메뉴 `PDF (A4 인쇄)` (F-279.md 3.1)
import printSvg from '@material-symbols/svg-400/outlined/print.svg?raw'
// 사이드바 `지도` (F-292.md 6.2)
import hubSvg from '@material-symbols/svg-400/outlined/hub.svg?raw'
// 지도 머리 줄 `목록` 보기 (F-2011.md 2.2)
import listSvg from '@material-symbols/svg-400/outlined/list.svg?raw'
// 지도 머리 줄 `맞춤` (F-2011.md 2.1)
import fitScreenSvg from '@material-symbols/svg-400/outlined/fit_screen.svg?raw'
import lockSvg from '@material-symbols/svg-400/outlined/lock.svg?raw'
import lockOpenSvg from '@material-symbols/svg-400/outlined/lock_open.svg?raw'

type IconProps = { size?: number; className?: string }

function innerMarkupOf(raw: string): string {
  return raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

function makeIcon(raw: string) {
  const inner = innerMarkupOf(raw)
  return function Icon({ size = 18, className }: IconProps) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 -960 960 960"
        aria-hidden="true"
        focusable="false"
        style={{ flexShrink: 0 }}
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    )
  }
}

export const IconEdit = makeIcon(editSvg)
export const IconRaw = makeIcon(codeSvg)
export const IconView = makeIcon(visibilitySvg)
export const IconShare = makeIcon(iosShareSvg)
export const IconDownload = makeIcon(downloadSvg)
export const IconChevron = makeIcon(chevronRightSvg)
export const IconNoteAdd = makeIcon(noteAddSvg)
export const IconFolderAdd = makeIcon(createNewFolderSvg)
export const IconUpload = makeIcon(uploadFileSvg)
export const IconSearch = makeIcon(searchSvg)
export const IconSettings = makeIcon(settingsSvg)
export const IconInstall = makeIcon(installDesktopSvg)
export const IconPanelClose = makeIcon(leftPanelCloseSvg)
export const IconPanelOpen = makeIcon(leftPanelOpenSvg)
export const IconPin = makeIcon(keepSvg)
export const IconUnpin = makeIcon(keepOffSvg)
export const IconMove = makeIcon(driveFileMoveSvg)
export const IconDelete = makeIcon(deleteSvg)
export const IconLink = makeIcon(linkSvg)
export const IconLinkOff = makeIcon(linkOffSvg)
export const IconCopy = makeIcon(contentCopySvg)
export const IconClose = makeIcon(closeSvg)
export const IconMore = makeIcon(moreHorizSvg)
export const IconRefresh = makeIcon(refreshSvg)
export const IconAlignLeft = makeIcon(formatAlignLeftSvg)
export const IconAlignCenter = makeIcon(formatAlignCenterSvg)
export const IconAlignRight = makeIcon(formatAlignRightSvg)
export const IconBrokenImage = makeIcon(brokenImageSvg)
export const IconAccount = makeIcon(accountCircleSvg)
export const IconLogin = makeIcon(loginSvg)
export const IconLogout = makeIcon(logoutSvg)
export const IconCheck = makeIcon(checkSvg)
export const IconPersonAdd = makeIcon(personAddSvg)
export const IconGroup = makeIcon(groupSvg)
export const IconKey = makeIcon(keySvg)
export const IconToc = makeIcon(tocSvg)

// 상단바 탭바(F-233 3.4) — 링크 추가(위키링크)는 기존 IconLink 를 그대로 쓴다(명령이 다를 뿐 "연결" 개념은 같다)
export const IconAddLink = IconLink
export const IconExternalLink = makeIcon(openInNewSvg)
// 사이드바 문서 우클릭 메뉴 `새 탭에서 열기` (F-296.md 4.1) — IconExternalLink 와 같은 그림, 문맥이 달라 이름을 따로 둔다
export const IconOpenInNew = makeIcon(openInNewSvg)
// 지도 노드 우클릭 메뉴 `여기로 이동` (F-2003.md 8.3)
export const IconRecenter = makeIcon(recenterSvg)
export const IconBold = makeIcon(formatBoldSvg)
// 상단바 탭바 제목 드롭다운 표시 — 글자 ▾ 대신 (2026-09-23 tweak)
export const IconDropdown = makeIcon(keyboardArrowDownSvg)
// 상단바 탭바 되돌리기·다시 실행 — 모바일엔 단축키가 없다 (2026-09-23 tweak)
export const IconUndo = makeIcon(undoSvg)
export const IconRedo = makeIcon(redoSvg)
export const IconItalic = makeIcon(formatItalicSvg)
export const IconStrikethrough = makeIcon(strikethroughSSvg)
export const IconHighlight = makeIcon(formatInkHighlighterSvg)
export const IconInlineCode = makeIcon(codeSvg)
export const IconFunctions = makeIcon(functionsSvg)
export const IconCalculate = makeIcon(calculateSvg)
export const IconComment = makeIcon(commentSvg)
export const IconFormatClear = makeIcon(formatClearSvg)
export const IconBulletList = makeIcon(formatListBulletedSvg)
export const IconOrderedList = makeIcon(formatListNumberedSvg)
export const IconChecklist = makeIcon(checklistSvg)
export const IconTitle = makeIcon(titleSvg)
export const IconNotes = makeIcon(notesSvg)
export const IconQuote = makeIcon(formatQuoteSvg)
export const IconSuperscript = makeIcon(superscriptSvg)
export const IconTable = makeIcon(tableSvg)
export const IconCallout = makeIcon(stickyNote2Svg)
export const IconHorizontalRule = makeIcon(horizontalRuleSvg)
export const IconCodeBlock = makeIcon(codeBlocksSvg)
// 모바일 탭바 아이콘 — 서식·단락·삽입 탭 자체(F-233.md 3.6, 2026-09-16 재개정)
export const IconTabFormat = makeIcon(textFormatSvg)
export const IconTabBlock = makeIcon(subjectSvg)
export const IconTabInsert = makeIcon(addSvg)

// 사이드바 `도움말` 항목 (F-235.md 1장)
export const IconHelp = makeIcon(helpSvg)

// 사이드바 `사용법` 항목 — 사이트 /guides 로 나가는 링크 (F-276.md 4.4)
export const IconGuide = makeIcon(menuBookSvg)

// 사이드바 `모두 접기` (2026-09-20 사용자 요청)
export const IconCollapseAll = makeIcon(collapseAllSvg)

// 내보내기 메뉴 `PDF (A4 인쇄)` (F-279.md 3.1)
export const IconPrint = makeIcon(printSvg)

// 사이드바 `지도` (F-292.md 6.2)
export const IconMap = makeIcon(hubSvg)

// 지도 머리 줄 `목록` (F-2011.md 2.2)
export const IconList = makeIcon(listSvg)
// 지도 머리 줄 `맞춤` (F-2011.md 2.1)
export const IconFit = makeIcon(fitScreenSvg)
// 금고 문서·폴더 표시 (F-405 6.1)
export const IconLock = makeIcon(lockSvg)
// 금고에서 빼기 메뉴 (F-407 7.1)
export const IconLockOpen = makeIcon(lockOpenSvg)

// 아이콘만 보이는 상단바 버튼의 툴팁 (F-142 3.2). 문구는 버튼 aria-label 과 같다
type IconTooltipProps = { text: string; align?: 'start' | 'center' | 'end'; side?: boolean }

export function IconTooltip({ text, align = 'center', side }: IconTooltipProps) {
  const cls = side ? `icon-tooltip icon-tooltip--side` : `icon-tooltip icon-tooltip--${align}`
  return (
    <span className={cls} aria-hidden="true">
      {text}
    </span>
  )
}
