// 서버 확인을 기다리는 메뉴 항목 자리 — 같은 버튼 틀을 써서 결과가 와도 줄 높이가 튀지 않는다
export default function MenuItemSkeleton({ iconSize, className }: { iconSize: number; className?: string }) {
  return (
    <li role="none" aria-hidden="true">
      <button type="button" tabIndex={-1} disabled className={className ? `${className} menu-item-skeleton` : 'menu-item-skeleton'}>
        <span className="menu-item-skeleton-icon" style={{ width: iconSize, height: iconSize }} />
        <span className="menu-item-skeleton-bar" />
      </button>
    </li>
  )
}
