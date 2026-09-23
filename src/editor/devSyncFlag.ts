// 개발 빌드 전용 두 탭 연결 플래그 (specs/features/F-303.md 9.1) — 첫 항 import.meta.env.DEV 가 운영 빌드에서 false 로 접혀 나머지가 빠진다
function linkParam(): string | null {
  if (typeof location === 'undefined') return null
  return new URLSearchParams(location.search).get('ysync')
}

export const DEV_YSYNC: boolean = import.meta.env.DEV && linkParam() !== null
export const DEV_YSYNC_NOGATE: boolean = DEV_YSYNC && linkParam() === 'nogate'
