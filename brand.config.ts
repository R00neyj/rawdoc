// 제품명·짧은 이름·메인 컬러의 유일한 정의 위치 (specs/design.md 3.2, specs/architecture.md 5장)
// 코드·CSS·HTML·UI 문구에 이 값들을 직접 쓰지 않는다. 여기서만 읽는다
export type Brand = {
  name: string
  shortName: string
  accent: string
  icon: string
  ogImage: string
}

const brand: Brand = {
  name: 'Rawdoc',
  shortName: 'Rawdoc',
  accent: '#3B4890',
  icon: '/icons/icon-192.png',
  // 제품명이 들어간 이미지라 이름·색을 바꾸면 node scripts/make-og-image.mjs 로 다시 만든다
  ogImage: '/og-image.png',
}

export default brand
