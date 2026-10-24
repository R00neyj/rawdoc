// 새 문서 템플릿 원문 읽기 시한 — App.tsx 에서 옮김 (F-2078, F-2037 4.2)
export const TEMPLATE_READ_TIMEOUT_MS = 3000

// 3,000ms 를 넘기면 실패로 본다(4.2-3) — 정한 값, 잰 값이 아니다
export function withTemplateReadTimeout(promise: Promise<string | null>): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TEMPLATE_READ_TIMEOUT_MS)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}
