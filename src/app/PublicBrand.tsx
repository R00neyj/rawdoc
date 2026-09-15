// 공개 보기 화면 로고 묶음 — SidebarHead 의 brand-group 과 같은 마크업, 앱 첫 화면으로 링크 (specs/features/F-215.md 2.1)
import brand from '../brand'

export default function PublicBrand() {
  return (
    <a className="brand-group public-brand" href="/" aria-label={`${brand.name} 열기`}>
      <img className="brand-icon" src={brand.icon} alt="" width={20} height={20} />
      <span className="brand">{brand.name}</span>
    </a>
  )
}
