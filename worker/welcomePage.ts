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
        max-width: 560px;
        margin: 0 auto;
        padding: 96px 24px 110px;
      }
      .word {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: -0.01em;
        text-transform: lowercase;
        color: #16171A;
        margin: 0 0 88px;
      }
      .mark {
        font-family: ui-monospace, 'D2Coding', 'JetBrains Mono', monospace;
        font-weight: 600;
        color: ${brand.accent};
        animation: rd-mark 1s ease 0.4s 1 backwards;
      }
      @keyframes rd-mark {
        from { color: #A9ACB3; }
        to { color: ${brand.accent}; }
      }
      @media (prefers-reduced-motion: reduce) {
        .mark { animation: none; }
      }
      h1 {
        font-size: clamp(1.9rem, 5vw, 2.5rem);
        line-height: 1.35;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin: 0 0 22px;
      }
      h1 .mark {
        font-size: 0.68em;
        margin-right: 0.15em;
      }
      .subhead {
        font-size: 1.1rem;
        line-height: 1.75;
        color: #40434D;
        max-width: 30em;
        margin: 0 0 44px;
        word-break: keep-all;
      }
      .excerpt {
        border-left: 2px solid ${brand.accent}55;
        padding: 2px 0 2px 20px;
        margin: 0 0 56px;
        font-family: ui-monospace, 'D2Coding', 'JetBrains Mono', monospace;
        font-size: 0.92rem;
        color: #40434D;
      }
      .excerpt p {
        margin: 0.5em 0;
      }
      .shot {
        width: 100%;
        display: block;
        border: 1px solid #E6E5E1;
        border-radius: 10px;
        margin: 0 0 12px;
      }
      .shot-caption {
        font-size: 0.9rem;
        color: #8B8F9A;
        margin: 0 0 64px;
      }
      .lead {
        margin: 0 0 16px;
      }
      .features {
        list-style: none;
        margin: 0 0 64px;
        padding: 0;
      }
      .features li {
        position: relative;
        padding-left: 20px;
        color: #40434D;
        margin: 0 0 14px;
        word-break: keep-all;
      }
      .features li::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0.65em;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${brand.accent};
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
        main { padding: 64px 20px 80px; }
        .word { margin-bottom: 56px; }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="word">${brand.name}</p>
      <h1><span class="mark">##</span> 원문 그대로 쓰는<br />한국어 마크다운 협업 도구</h1>
      <p class="subhead">이 문장의 <span class="mark">**</span>강조<span class="mark">**</span>처럼, 기호가 사라지지 않고 그대로 남습니다.</p>
      <div class="excerpt">
        <p><span class="mark">##</span> 회의록</p>
        <p>다음 회의는 <span class="mark">**</span>금요일 오후 2시<span class="mark">**</span>입니다</p>
      </div>
      <img class="shot" src="/welcome-screenshot.png" width="700" height="285" alt="실제 편집 화면. 제목 줄의 ## 기호가 강조색으로 표시되고 지워지지 않는다" />
      <p class="shot-caption">실제 편집 화면. 기호는 지워지지 않고, 강조색으로만 표시됩니다.</p>
      <p class="lead">그 외에 이런 것도 됩니다.</p>
      <ul class="features">
        <li>로그인 없이 로컬로 바로 시작하고, 필요하면 로그인해서 여러 기기에서 이어서 씁니다</li>
        <li>링크 하나로 공개 공유하거나 사람을 초대해 함께 씁니다. 편집 중인 문서는 자동으로 잠겨 내용이 겹치지 않습니다</li>
        <li>표, 콜아웃, 위키링크, 이미지 첨부까지 실제 문서에 쓰는 문법을 폭넓게 지원합니다</li>
        <li>설치하면 오프라인에서도 그대로 씁니다</li>
      </ul>
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
