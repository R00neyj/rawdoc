// 사이트 공통 머리·꼬리 — 랜딩(워커)·사이트 페이지(빌드) 둘 다 쓴다 (specs/features/F-272.md 5.1). 순수 함수. DOM·React·node:fs 를 import 하지 않는다

export type SiteLink = { path: string; label: string }

export const GUIDES_PATH = '/guides'

// F-273~F-276 이 자기 페이지를 만들면서 한 줄씩 더한다. 최종 순서: 사용법(F-276)·체인지로그(F-273)·도움말(F-274)
export const SITE_NAV: SiteLink[] = [
  { path: GUIDES_PATH, label: '사용법' },
  { path: '/changelog', label: '체인지로그' },
  { path: '/help', label: '도움말' },
]
// F-275 가 두 줄을 더한다. 순서: 개인정보 처리방침 → 이용약관
export const SITE_FOOTER_LINKS: SiteLink[] = [
  { path: '/privacy', label: '개인정보 처리방침' },
  { path: '/terms', label: '이용약관' },
]

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const SITE_CHROME_CSS = `
/* 폭은 앱 토큰에 없어 여기서 정의한다. rem 이라야 상속 글자 크기에 안 흔들린다 (F-272 5.1) */
:root {
  --site-page: 1060px;
  --site-read: 40rem;
}
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
/* 글 페이지 — 본문을 가운데에 띄우지 않고 머리·꼬리와 같은 왼쪽 선(로고 자리)에서 시작한다. 제목만 틀 끝까지 넓게 쓴다 */
.site-doc {
  --site-mark: color-mix(in srgb, var(--accent) 42%, var(--paper));
}
.site-doc > .site-article { margin: 0; }
.site-doc .markdown-body > h1:first-child {
  width: min(calc(100vw - 64px), calc(var(--site-page) - 64px));
  font-size: clamp(2.25rem, 1.5rem + 2.6vw, 3.5rem);
  line-height: 1.12;
  letter-spacing: -0.035em;
  margin: 56px 0 20px;
  padding: 0;
}
.site-doc .markdown-body > h1:first-child + p {
  font-size: 1.125rem;
  line-height: 1.7;
  color: var(--ink-2);
  margin-bottom: 44px;
}
.site-doc .markdown-body > h1:first-child + :not(p) { margin-top: 44px; }

/* 원문 기호를 여백에 건다 — 이 제품은 # 을 지우지 않는다. 글자선은 본문과 맞고 기호만 밖으로 나간다 */
.site-doc .markdown-body :is(h1, h2, h3) { position: relative; border-bottom: 0; }
.site-doc .markdown-body :is(h1, h2, h3)::before {
  position: absolute;
  right: 100%;
  margin-right: 0.4em;
  font-family: var(--font-mono);
  font-weight: 400;
  letter-spacing: 0;
  color: var(--site-mark);
}
.site-doc .markdown-body h1::before { content: '#'; }
.site-doc .markdown-body h2::before { content: '##'; }
.site-doc .markdown-body h3::before { content: '###'; }
.site-doc .markdown-body h2 {
  font-size: 1.5rem;
  letter-spacing: -0.02em;
  margin: 3.2rem 0 1rem;
  padding: 0;
}

/* 첫 단계 목록 기호도 여백으로 — 글줄이 문단과 같은 선에서 시작한다 */
.site-doc .markdown-body > ul { padding-left: 0; }
.site-doc .markdown-body > ul > li + li { margin-top: 0.5em; }
.site-doc .markdown-body > ul > li:not(.task-list-item)::before {
  content: '-';
  font-family: var(--font-mono);
  font-weight: 400;
  color: var(--site-mark);
}

.site-foot {
  /* 선은 글자 칸 폭만 — 머리·본문과 같은 좌우 선에서 끝난다 */
  background: linear-gradient(var(--rule), var(--rule)) no-repeat 32px 0 / calc(100% - 64px) 1px;
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
/* 사이트 글은 앱의 문서 칸이 아니라 <body>(--paper) 위에 놓이는데, 본문 바탕(markdown.css
   .markdown-body·표 tr)과 콜아웃 바탕(callout.css 의 color-mix 기준)은 --panel 을 쓴다.
   그대로 두면 본문만 다른 색 상자로 떠 보이므로 이 범위에서만 토큰 값을 바꾼다.
   markdown.css 쪽을 transparent 로 바꾸는 길은 F-164 2.1("문서 칸 바탕과 같은 계산값")과
   부딪혀 쓰지 않았다 (2026-09-21) */
.site-article.public-view { --panel: var(--paper); }
/* 여백이 기호를 받기에 좁으면 기호를 글줄 안으로 들인다 */
@media (max-width: 1120px) {
  .site-doc .markdown-body :is(h1, h2, h3)::before { position: static; margin-right: 0.35em; }
  .site-doc .markdown-body > ul { padding-left: var(--md-list-step); }
}
@media (max-width: 860px) {
  .site-doc .markdown-body > h1:first-child { width: auto; margin-top: 32px; }
  .site-head, .site-doc, .site-foot { padding-left: 16px; padding-right: 16px; }
  .site-head { gap: 12px; }
  .site-nav { gap: 14px; }
  .site-app { white-space: nowrap; padding: 8px 14px; }
  .site-foot { background-position: 16px 0; background-size: calc(100% - 32px) 1px; flex-wrap: wrap; }
}
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
