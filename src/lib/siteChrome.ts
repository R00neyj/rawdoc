// 사이트 공통 머리·꼬리 — 랜딩(워커)·사이트 페이지(빌드) 둘 다 쓴다 (specs/features/F-272.md 5.1). 순수 함수. DOM·React·node:fs 를 import 하지 않는다

export type SiteLink = { path: string; label: string }

// F-273~F-276 이 자기 페이지를 만들면서 한 줄씩 더한다. 최종 순서: 사용법(F-276)·체인지로그(F-273)·도움말(F-274)
export const SITE_NAV: SiteLink[] = [{ path: '/changelog', label: '체인지로그' }]
export const SITE_FOOTER_LINKS: SiteLink[] = []

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const SITE_CHROME_CSS = `
.site-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: var(--site-page);
  margin: 0 auto;
  padding: 20px 32px;
}
.site-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
  text-decoration: none;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 16px;
}
.site-brand img { width: 20px; height: 20px; }
.site-nav {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
  font-family: var(--font-body);
  font-size: 14px;
}
.site-nav a { color: var(--ink-2); text-decoration: none; }
.site-nav a:hover { color: var(--ink); }
.site-nav a[aria-current='page'] { color: var(--accent); }
.site-app {
  display: inline-block;
  background: var(--accent);
  color: var(--panel);
  text-decoration: none;
  font-weight: 700;
  padding: 8px 18px;
  border-radius: var(--radius-control, 6px);
}
.site-main {
  max-width: var(--site-page);
  margin: 0 auto;
  padding: 0 32px 64px;
}
.site-article {
  max-width: var(--site-read);
  margin: 0 auto;
}
.site-foot {
  border-top: 1px solid var(--rule);
  color: var(--muted);
  font-size: 13px;
  max-width: var(--site-page);
  margin: 0 auto;
  padding: 24px 32px 44px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.site-foot a { color: var(--muted); }
.site-foot a:hover { color: var(--ink-2); }

/* app.css 의 .public-view(공개 보기 화면 S-5)는 화면 꽉 채우는 flex 열이다 — 사이트 글은 그 선택자만 빌려 쓰고 배치는 문서 흐름으로 되돌린다 (F-272 5.2) */
.site-article.public-view { display: block; height: auto; width: auto; background: none; }
`

export function renderSiteHeader(args: {
  brandName: string
  brandIcon: string
  current?: string
  appCta: 'link' | 'enter'
}): string {
  const nav = SITE_NAV.map((link) => {
    const current = link.path === args.current ? ' aria-current="page"' : ''
    return `<a href="${escapeHtml(link.path)}"${current}>${escapeHtml(link.label)}</a>`
  }).join('')
  const ctaAttr = args.appCta === 'enter' ? ' data-cta="enter"' : ''

  return `<header class="site-head">
  <a class="site-brand" href="/"><img src="${escapeHtml(args.brandIcon)}" alt="" width="20" height="20" />${escapeHtml(args.brandName)}</a>
  <nav class="site-nav">${nav}</nav>
  <a class="site-app" href="/"${ctaAttr}>앱 열기</a>
</header>`
}

export function renderSiteFooter(args: { brandName: string }): string {
  const links = SITE_FOOTER_LINKS.map(
    (link) => `<a href="${escapeHtml(link.path)}">${escapeHtml(link.label)}</a>`,
  ).join('')

  return `<footer class="site-foot">
  <span>${escapeHtml(args.brandName)}</span>${links}
</footer>`
}
