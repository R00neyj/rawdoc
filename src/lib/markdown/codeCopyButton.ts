// 코드블록 복사 버튼 공용 생성 (F-210.md 2.5, F-240.md 3.4) — Viewer.tsx buildCopyButton 을 그대로 옮긴 것, 보기·편집 모드가 함께 쓴다
import contentCopySvg from '@material-symbols/svg-400/outlined/content_copy.svg?raw'
import checkSvg from '@material-symbols/svg-400/outlined/check.svg?raw'

const COPY_TOOLTIP = '코드 복사'
const COPY_FAIL_TOOLTIP = '복사하지 못했습니다'
const COPY_RESET_MS = 1500

// 누르면 아이콘을 1.5초 체크로 바꾸고, 실패하면 툴팁만 바꾼다
export function createCodeCopyButton(getCode: () => string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'code-copy-btn'
  btn.setAttribute('aria-label', COPY_TOOLTIP)
  btn.title = COPY_TOOLTIP
  btn.innerHTML = contentCopySvg
  btn.addEventListener('click', () => {
    function onSuccess() {
      btn.innerHTML = checkSvg
      btn.title = COPY_TOOLTIP
      setTimeout(() => {
        btn.innerHTML = contentCopySvg
      }, COPY_RESET_MS)
    }
    function onFail() {
      btn.title = COPY_FAIL_TOOLTIP
    }
    // 비보안 컨텍스트·미지원 브라우저는 navigator.clipboard 자체가 없어 호출이 동기적으로 던진다 (ShareMenu.tsx 등 다른 호출부와 동일하게 감싼다)
    try {
      navigator.clipboard.writeText(getCode()).then(onSuccess, onFail)
    } catch {
      onFail()
    }
  })
  return btn
}
