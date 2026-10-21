// 문서 탭 켜짐 판정과 휴대폰 탭 버튼 숫자 — 넓은 화면은 설치 앱만, 휴대폰 폭은 브라우저에서도 켠다 (small 2026-10-22)
export function docTabsEnabled(input: { standalone: boolean; narrow: boolean; phone: boolean }): boolean {
  return input.phone || (input.standalone && !input.narrow)
}

export function tabCountLabel(count: number): string {
  return count > 9 ? '9+' : String(Math.max(0, count))
}
