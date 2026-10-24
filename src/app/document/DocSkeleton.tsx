import { useEffect, useState } from 'react'

// 문서 본문을 불러오는 동안의 자리 표시 — 부팅 스켈레톤의 제목·본문 막대를 그대로 쓴다 (boot.css). 캐시된 문서가 깜빡이지 않게 늦게 띄운다
const SHOW_DELAY_MS = 150

export default function DocSkeleton() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  if (!shown) return null
  return (
    <div className="doc-skeleton" role="status" aria-label="불러오는 중…">
      <div className="boot-skeleton-doc-title boot-skeleton-bar" />
      <div className="boot-skeleton-doc-body">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="boot-skeleton-bar" />
        ))}
      </div>
    </div>
  )
}
