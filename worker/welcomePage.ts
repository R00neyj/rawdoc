// 마케팅 랜딩 페이지 /welcome — GEO 대응을 위해 React 번들 대신 완결된 정적 HTML 문자열을 반환한다 (F-239.md 2장)
import brand from '../brand.config'

const siteUrl = 'https://rawdoc.app/'
const pageTitle = `한국어로 쓰는 마크다운 협업 도구 — ${brand.name}`
const subheadText = '##를 쳐도 기호가 사라지지 않고, 입력한 그대로 남습니다.'
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
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #FBFBFA;
        color: #16171A;
        font-family: -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
        line-height: 1.6;
      }
      main {
        max-width: 600px;
        margin: 0 auto;
        padding: 88px 24px 96px;
      }
      .word {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #16171A;
        margin: 0 0 72px;
      }
      h1 {
        font-size: clamp(1.9rem, 5vw, 2.6rem);
        line-height: 1.28;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin: 0 0 20px;
      }
      .subhead {
        font-size: 1.1rem;
        line-height: 1.7;
        color: #40434D;
        max-width: 30em;
        margin: 0 0 40px;
      }
      .demo-frame {
        border-radius: 10px;
        overflow: hidden;
        margin: 0 0 40px;
      }
      .demo {
        background: #FFFFFF;
        border: 1px solid #E6E5E1;
        border-radius: 10px;
        padding: 18px 20px;
        animation: rd-reveal 1.6s steps(30, end) 0.15s 1 backwards;
      }
      @keyframes rd-reveal {
        from { clip-path: inset(0 100% 0 0); }
        to { clip-path: inset(0 0 0 0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .demo { animation: none; }
      }
      .demo-line {
        display: flex;
        gap: 16px;
      }
      .demo-line + .demo-line {
        margin-top: 2px;
      }
      .ln {
        flex: none;
        width: 1.2em;
        color: #8B8F9A;
        font-family: ui-monospace, 'D2Coding', 'JetBrains Mono', monospace;
        font-size: 0.9rem;
        text-align: right;
        user-select: none;
      }
      .code {
        font-family: ui-monospace, 'D2Coding', 'JetBrains Mono', monospace;
        font-size: 0.9rem;
        white-space: pre-wrap;
      }
      .tok {
        color: ${brand.accent};
        font-weight: 600;
      }
      .local-note {
        color: #40434D;
        margin: 0 0 32px;
      }
      .cta {
        display: inline-block;
        background: ${brand.accent};
        color: #FFFFFF;
        text-decoration: none;
        font-weight: 700;
        padding: 13px 26px;
        border-radius: 8px;
      }
      .cta:focus-visible {
        outline: 2px solid ${brand.accent};
        outline-offset: 3px;
      }
      @media (max-width: 480px) {
        main { padding: 56px 20px 72px; }
        .word { margin-bottom: 48px; }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="word">rawdoc</p>
      <h1>원문 그대로 쓰는<br />한국어 마크다운 협업 도구</h1>
      <p class="subhead">${subheadText}</p>
      <div class="demo-frame">
        <div class="demo">
          <div class="demo-line"><span class="ln">1</span><span class="code"><span class="tok">##</span> 소개</span></div>
          <div class="demo-line"><span class="ln">2</span><span class="code"></span></div>
          <div class="demo-line"><span class="ln">3</span><span class="code">이 문장은 <span class="tok">**</span>그대로<span class="tok">**</span> 남는다</span></div>
        </div>
      </div>
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
