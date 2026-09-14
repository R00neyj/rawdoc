// 인라인 SVG 아이콘 (Google Material Symbols Outlined 400, specs/design.md 4장, F-142 2장)
// `?raw` 로 가져온 파일 콘텐츠에서 내부 마크업만 꺼내 쓴다. 색은 CSS `fill: currentColor` 만 쓴다
import editSvg from '@material-symbols/svg-400/outlined/edit.svg?raw'
import codeSvg from '@material-symbols/svg-400/outlined/code.svg?raw'
import visibilitySvg from '@material-symbols/svg-400/outlined/visibility.svg?raw'
import iosShareSvg from '@material-symbols/svg-400/outlined/ios_share.svg?raw'
import downloadSvg from '@material-symbols/svg-400/outlined/download.svg?raw'
import chevronRightSvg from '@material-symbols/svg-400/outlined/chevron_right.svg?raw'
import noteAddSvg from '@material-symbols/svg-400/outlined/note_add.svg?raw'
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
import contentCopySvg from '@material-symbols/svg-400/outlined/content_copy.svg?raw'
import closeSvg from '@material-symbols/svg-400/outlined/close.svg?raw'
import moreHorizSvg from '@material-symbols/svg-400/outlined/more_horiz.svg?raw'
import refreshSvg from '@material-symbols/svg-400/outlined/refresh.svg?raw'
import formatAlignLeftSvg from '@material-symbols/svg-400/outlined/format_align_left.svg?raw'
import formatAlignCenterSvg from '@material-symbols/svg-400/outlined/format_align_center.svg?raw'
import formatAlignRightSvg from '@material-symbols/svg-400/outlined/format_align_right.svg?raw'
import brokenImageSvg from '@material-symbols/svg-400/outlined/broken_image.svg?raw'

function innerMarkupOf(raw) {
  return raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

function makeIcon(raw) {
  const inner = innerMarkupOf(raw)
  return function Icon({ size = 18, className }) {
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
export const IconCopy = makeIcon(contentCopySvg)
export const IconClose = makeIcon(closeSvg)
export const IconMore = makeIcon(moreHorizSvg)
export const IconRefresh = makeIcon(refreshSvg)
export const IconAlignLeft = makeIcon(formatAlignLeftSvg)
export const IconAlignCenter = makeIcon(formatAlignCenterSvg)
export const IconAlignRight = makeIcon(formatAlignRightSvg)
export const IconBrokenImage = makeIcon(brokenImageSvg)

// 아이콘만 보이는 상단바 버튼의 툴팁 (F-142 3.2). 문구는 버튼 aria-label 과 같다
export function IconTooltip({ text, align = 'center', side }) {
  const cls = side ? `icon-tooltip icon-tooltip--side` : `icon-tooltip icon-tooltip--${align}`
  return (
    <span className={cls} aria-hidden="true">
      {text}
    </span>
  )
}
