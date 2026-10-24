// 설정 오른쪽 내용의 소묶음 카드 한 장 — 제목 위, 항목 아래 (A안 small 2026-10-22)
import type { ReactNode } from 'react'

export default function SettingsCard({ title, className, children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `settings-card ${className}` : 'settings-card'}>
      {title && <h4 className="settings-card-title">{title}</h4>}
      {children}
    </section>
  )
}
