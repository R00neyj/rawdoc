// 마케팅 랜딩 페이지 /welcome — GEO 대응을 위해 React 번들 대신 완결된 정적 HTML 문자열을 반환한다 (F-239.md 2장)
import brand from '../brand.config'

const siteUrl = 'https://rawdoc.app/'
const pageTitle = `한국어로 쓰는 마크다운 협업 도구 — ${brand.name}`
const subheadText = '##를 쳐도 기호가 사라지지 않고, 입력한 그대로 남는 한국어 마크다운 에디터입니다.'
const ogImageUrl = new URL(brand.ogImage, siteUrl).href
const ogUrl = new URL('welcome', siteUrl).href

export function renderWelcomePage(): Response {
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
    <meta name="description" content="${subheadText}" />
    <meta name="theme-color" content="${brand.accent}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${pageTitle}" />
    <meta property="og:description" content="${subheadText}" />
    <meta property="og:image" content="${ogImageUrl}" />
    <meta property="og:url" content="${ogUrl}" />
    <meta property="og:locale" content="ko_KR" />
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, 'Malgun Gothic', sans-serif;
        color: black;
        line-height: 1.6;
      }
      main {
        max-width: 640px;
        margin: 0 auto;
        padding: 4rem 1.5rem 3rem;
        text-align: center;
      }
      h1 {
        font-size: 2rem;
        line-height: 1.4;
        margin: 0 0 1rem;
      }
      .subhead {
        font-size: 1.1rem;
        color: color-mix(in srgb, black 70%, white);
        margin: 0 0 2rem;
      }
      .demo {
        text-align: left;
        background: color-mix(in srgb, ${brand.accent} 6%, white);
        border: 1px solid color-mix(in srgb, ${brand.accent} 25%, white);
        border-radius: 8px;
        padding: 1.25rem 1.5rem;
        margin: 0 auto 2rem;
        overflow: hidden;
      }
      .demo code {
        display: inline-block;
        white-space: pre;
        font-family: ui-monospace, 'Consolas', monospace;
        font-size: 0.95rem;
        clip-path: inset(0 100% 0 0);
        animation: rd-type 2.2s steps(24, end) 0.2s 1 forwards;
      }
      @keyframes rd-type {
        to { clip-path: inset(0 0 0 0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .demo code { animation: none; clip-path: none; }
      }
      .tok {
        color: color-mix(in srgb, ${brand.accent} 60%, white);
        font-weight: 600;
      }
      .local-note {
        color: color-mix(in srgb, black 60%, white);
        margin: 0 0 2rem;
      }
      .cta {
        display: inline-block;
        background: ${brand.accent};
        color: white;
        text-decoration: none;
        font-weight: 600;
        padding: 0.85rem 2rem;
        border-radius: 999px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>원문 그대로 쓰는<br />한국어 마크다운 협업 도구</h1>
      <p class="subhead">${subheadText}</p>
      <pre class="demo"><code><span class="tok">##</span> 소개

이 문장은 <span class="tok">**</span>그대로<span class="tok">**</span> 남는다</code></pre>
      <p class="local-note">설치 없이, 로그인 없이 바로 로컬로 시작하세요.</p>
      <a class="cta" href="/">지금 써보기</a>
    </main>
  </body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
