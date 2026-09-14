// 인라인 SVG 아이콘 (Google Material Symbols Outlined 400, specs/design.md 4장, F-142 2장)
// `?raw` 로 가져온 파일 콘텐츠에서 내부 마크업만 꺼내 쓴다. 색은 CSS `fill: currentColor` 만 쓴다
import editSvg from '@material-symbols/svg-400/outlined/edit.svg?raw'
import codeSvg from '@material-symbols/svg-400/outlined/code.svg?raw'
import visibilitySvg from '@material-symbols/svg-400/outlined/visibility.svg?raw'
import iosShareSvg from '@material-symbols/svg-400/outlined/ios_share.svg?raw'
import downloadSvg from '@material-symbols/svg-400/outlined/download.svg?raw'
import chevronRightSvg from '@material-symbols/svg-400/outlined/chevron_right.svg?raw'

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

// 아이콘만 보이는 상단바 버튼의 툴팁 (F-142 3.2). 문구는 버튼 aria-label 과 같다
export function IconTooltip({ text, align = 'center' }) {
  return (
    <span className={`icon-tooltip icon-tooltip--${align}`} aria-hidden="true">
      {text}
    </span>
  )
}
