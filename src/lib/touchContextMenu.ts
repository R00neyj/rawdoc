// 터치 길게 누르기에서 온 contextmenu 인지 — 이걸 preventDefault 하면 안드로이드에서 글자 선택과 OS 도구상자가 같이 사라진다
let lastPointerType = ''

export function rememberPointerType(type: string): void {
  lastPointerType = type
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => rememberPointerType(e.pointerType), { capture: true, passive: true })
}

// contextmenu 가 PointerEvent 가 아닌 브라우저는 마지막 pointerdown 으로 판단한다
export function isTouchContextMenu(event: MouseEvent): boolean {
  const type = (event as Partial<PointerEvent>).pointerType
  if (type) return type === 'touch'
  return lastPointerType === 'touch'
}
