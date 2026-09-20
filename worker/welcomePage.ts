// 랜딩 페이지 / — GEO 대응을 위해 React 번들 대신 완결된 정적 HTML 문자열을 반환한다 (F-239.md 2장, F-271.md 4장)
import brand from '../brand.config'
import { APP_COOKIE, EARLY_APP_KEYS, LANDING_DONE_KEY, buildAppCookie } from '../src/lib/appEntry'

const siteUrl = 'https://rawdoc.app/'
const pageTitle = `한국어로 쓰는 마크다운 협업 도구 — ${brand.name}`
const subheadText = '##를 쳐도 기호가 사라지지 않고, 입력한 그대로 남습니다.'
const ogImageUrl = new URL(brand.ogImage, siteUrl).href
const ogUrl = siteUrl

// 조기 판정·CTA 클릭 모두 같은 쿠키 문자열을 쓴다 — 키 문자열을 여기 다시 적지 않는다 (3.2)
const cookieSecure = buildAppCookie({ secure: true })
const cookieInsecure = buildAppCookie({ secure: false })
const earlyKeysJson = JSON.stringify(EARLY_APP_KEYS)
const landingDoneKeyJson = JSON.stringify(LANDING_DONE_KEY)
const cookieSecureJson = JSON.stringify(cookieSecure)
const cookieInsecureJson = JSON.stringify(cookieInsecure)

// 두 값 쓰기 — 조기 판정 스크립트·CTA 클릭 스크립트가 함께 쓴다 (4.2·4.3)
const writeAppEntryJs = `function writeAppEntry() {
        try { localStorage.setItem(${landingDoneKeyJson}, '1') } catch (e) {}
        try {
          document.cookie = location.protocol === 'https:' ? ${cookieSecureJson} : ${cookieInsecureJson}
        } catch (e) {}
      }`

// 조기 판정(4.2) — 기존 사용자·공유 앱 해시는 곧바로 앱으로. 스타일보다 앞, <head> 맨 위에 둔다
const earlyScript = `<script>
      (function () {
        ${writeAppEntryJs}
        try {
          var keys = ${earlyKeysJson}
          var hasKey = false
          for (var i = 0; i < keys.length; i++) {
            if (localStorage.getItem(keys[i]) !== null) { hasKey = true; break }
          }
          var hasHash = /^#\\//.test(location.hash)
          if (!hasKey && !hasHash) return
          writeAppEntry()
          var reloaded = false
          try { reloaded = sessionStorage.getItem('md.landingReloaded') === '1' } catch (e) {}
          if (!reloaded) {
            try { sessionStorage.setItem('md.landingReloaded', '1') } catch (e) {}
            location.reload()
          } else {
            // 쿠키가 차단된 브라우저 — 무한 왕복 대신 랜딩에 머무르고 탈출구를 보여준다 (2.3)
            document.documentElement.setAttribute('data-cookie-escape', '1')
          }
        } catch (e) {}
      })()
    </script>`

// CTA 클릭(4.3) — 두 값을 쓴 뒤 로그인 없이 사용은 reload, 로그인은 기존 로그인 흐름으로
const ctaScript = `<script>
      (function () {
        ${writeAppEntryJs}
        function bind(selector, run) {
          var els = document.querySelectorAll(selector)
          for (var i = 0; i < els.length; i++) {
            els[i].addEventListener('click', function (ev) {
              ev.preventDefault()
              writeAppEntry()
              run()
            })
          }
        }
        bind('[data-cta="enter"]', function () { location.reload() })
        bind('[data-cta="login"]', function () { location.href = '/api/login?return=' })
      })()
    </script>`

export function renderWelcomePage(): Response {
  const html = `<!doctype html>
<html lang="ko">
  <head>
    ${earlyScript}
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
    <meta name="description" content="${subheadText}" />
    <meta name="theme-color" content="${brand.accent}" />
    <link rel="icon" href="${brand.icon}" />
    <link rel="canonical" href="${siteUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${pageTitle}" />
    <meta property="og:description" content="${subheadText}" />
    <meta property="og:image" content="${ogImageUrl}" />
    <meta property="og:url" content="${ogUrl}" />
    <meta property="og:locale" content="ko_KR" />
    <style>
      /* 색·서체·형태 값은 앱 화이트 테마(src/styles/tokens.css)와 같다. 워커가 돌려주는
         단일 HTML 이라 CSS 파일을 import 하지 않고 같은 값을 여기 다시 적는다 */
      :root {
        color-scheme: light;
        --accent: ${brand.accent};
        --paper: #faf8f4;
        --panel: #fffefb;
        --ink: #1c1b18;
        --ink-2: #4a4740;
        --muted: #8f8b82;
        --rule: #e8e4db;
        --rule-2: #f2efe8;
        --font-sans: 'Pretendard Variable', system-ui, sans-serif;
        --font-serif: 'Noto Serif KR', serif;
        --font-mono: 'D2Coding', 'Pretendard Variable', monospace;
        --font-display: var(--font-serif);
        --font-body: var(--font-sans);
        --tracking: -0.02em;
        --radius-control: 6px;
        --radius-dialog: 10px;
        --read-w: 40em;
        --page: 1060px;
      }
      * { box-sizing: border-box; letter-spacing: var(--tracking); }
      body {
        margin: 0;
        background: var(--paper);
        color: var(--ink);
        font-family: var(--font-body);
        font-size: 17px;
        line-height: 1.6;
        /* 한국어는 낱글자 단위로 끊으면 뜻이 달라진다 — 어절 단위로만 넘긴다 */
        word-break: keep-all;
        overflow-wrap: break-word;
        -webkit-font-smoothing: antialiased;
      }
      .wrap {
        max-width: var(--page);
        margin-left: auto;
        margin-right: auto;
        padding: 0 32px;
      }
      .bar { padding-top: 26px; padding-bottom: 52px; }
      .brand-group { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 20px; height: 20px; }
      .brand { font-family: var(--font-display); font-weight: 700; font-size: 16px; }
      /* 편집 화면의 마크다운 기호 강조(.md-mark) 와 같은 규칙 */
      .mark {
        color: var(--accent);
        font-family: var(--font-mono);
        --tracking: 0;
      }

      /* 히어로 = 편집 화면 그대로. 줄번호·서체·간격 비율은 앱 편집기와 같고 --fs 로만 확대한다 */
      .doc {
        background: var(--panel);
        border: 1px solid var(--rule);
        border-radius: var(--radius-dialog);
        padding: 30px 0 34px;
        overflow: hidden;
      }
      .doc-inner {
        --fs: 21px;
        --ln-fs: 0.72rem;
        --gut: 4.2rem;
        font-size: var(--fs);
        counter-reset: ln;
        padding: 0 34px;
      }
      /* 줄 상자는 본문 칸만 차지한다 — 제목 밑줄이 줄번호 칸까지 그어지지 않게 */
      .doc-inner > * {
        counter-increment: ln;
        position: relative;
        margin: 0 0 0 var(--gut);
      }
      .doc-inner > *::before {
        content: counter(ln);
        position: absolute;
        left: calc(-1 * var(--gut));
        top: calc((var(--fs) - var(--ln-fs)) * 1.6 / 2);
        width: calc(var(--gut) - 20px);
        font-family: var(--font-mono);
        font-size: var(--ln-fs);
        line-height: inherit;
        color: var(--muted);
        text-align: right;
        --tracking: 0;
        user-select: none;
      }
      .blank { min-height: 1.6em; }
      /* 편집기 데모가 붙으면 정적 문서 자리를 그대로 차지한다 (assets/welcome-demo.js) */
      #demo.cm-host {
        --doc-pad-top: 26px;
        --doc-pad-bottom: 26px;
        height: 430px;
        padding: 0;
      }
      /* 랜딩 문서에는 파일 제목 칸이 필요 없다 — 본문 첫 줄이 곧 제목이다 */
      #demo .doc-title-block { display: none; }
      h1 {
        font-family: var(--font-display);
        font-size: 2em;
        font-weight: 600;
        line-height: 1.35;
        padding-top: 0.2em;
        padding-bottom: 0.75em;
        border-bottom: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
      }
      .doc h1::before { top: calc(var(--fs) * 0.4 + (var(--fs) * 2.7 - var(--ln-fs) * 1.35) / 2); }
      .txt { max-width: var(--read-w); }
      .caret {
        display: inline-block;
        width: 1.5px;
        height: 1.15em;
        background: var(--ink);
        vertical-align: -0.2em;
        margin-left: 1px;
      }
      @media (prefers-reduced-motion: no-preference) {
        .caret.blink { animation: rd-blink 1.1s steps(1) infinite; }
        @keyframes rd-blink {
          0% { opacity: 0; }
          50% { opacity: 1; }
        }
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 20px;
        flex-wrap: wrap;
        margin-top: 34px;
      }
      .cta {
        display: inline-block;
        background: var(--accent);
        color: var(--panel);
        text-decoration: none;
        font-weight: 700;
        padding: 12px 26px;
        border-radius: var(--radius-control);
        transition: background-color 180ms cubic-bezier(0, 0, 0.2, 1);
      }
      .cta:hover { background: color-mix(in srgb, var(--accent) 86%, var(--ink)); }
      .cta:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
      .cta-secondary { background: transparent; color: var(--ink); border: 1px solid var(--rule); }
      .cta-secondary:hover { background: var(--rule-2); }
      .note { color: var(--ink-2); font-size: 0.95rem; }
      /* 쿠키를 저장하지 못하는 브라우저에서만 조기 판정 스크립트가 <html data-cookie-escape> 로 드러낸다 (2.3) */
      .cookie-escape { display: none; width: 100%; margin-top: 12px; color: var(--ink-2); font-size: 0.95rem; }
      html[data-cookie-escape='1'] .cookie-escape { display: block; }
      .cookie-escape a { color: var(--accent); }

      main section { margin-top: 104px; }
      h2 {
        font-family: var(--font-display);
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0 0 32px;
        padding-bottom: 0.5em;
        border-bottom: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
      }
      .feats {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        column-gap: 48px;
        row-gap: 32px;
      }
      .feats li { position: relative; padding-left: 20px; }
      .feats li::before {
        content: '\\2022';
        position: absolute;
        left: 0;
        color: var(--accent);
      }
      .feats h3 { font-size: 1rem; font-weight: 700; margin: 0 0 4px; }
      .feats p { margin: 0; color: var(--ink-2); font-size: 0.97rem; max-width: 26em; }
      .export p { margin: 0 0 28px; color: var(--ink-2); max-width: var(--read-w); }
      .export code {
        font-family: var(--font-mono);
        font-size: 0.92em;
        background: var(--rule-2);
        border-radius: 3px;
        padding: 1px 4px;
        --tracking: 0;
      }
      footer.wrap {
        margin-top: 112px;
        border-top: 1px solid var(--rule);
        color: var(--muted);
        font-size: 0.9rem;
        padding: 24px 32px 44px;
      }
      h2 + .feats, h2 + p { margin-top: 0; }
      /* 아직 없는 기능 — 지금 되는 것과 눈으로 구분되게 한 단계 물린다 */
      .soon h2, .soon h3 { color: var(--ink-2); }
      .soon .feats li::before { color: var(--muted); }
      main section.close { margin-top: 72px; }
      .close .actions { margin-top: 0; }

      @media (max-width: 760px) {
        body { font-size: 16px; }
        .wrap { padding: 0 20px; }
        .bar { padding-bottom: 36px; }
        .doc { padding: 22px 0 26px; }
        .doc-inner { --fs: 16px; --ln-fs: 0.66rem; --gut: 2.4rem; padding: 0 16px; }
        .doc-inner > *::before { width: calc(var(--gut) - 12px); }
        h1 { font-size: 1.8em; }
        .doc h1::before { top: calc(var(--fs) * 0.36 + (var(--fs) * 2.43 - var(--ln-fs) * 1.35) / 2); }
        h1 br { display: none; }
        main section { margin-top: 72px; }
        .feats { grid-template-columns: minmax(0, 1fr); row-gap: 24px; }
      }
    </style>
  </head>
  <body>
    <header class="wrap bar">
      <div class="brand-group">
        <img class="brand-icon" src="${brand.icon}" alt="" width="20" height="20" />
        <span class="brand">${brand.name}</span>
      </div>
    </header>
    <main>
      <div class="wrap">
        <div class="doc" id="demo">
          <div class="doc-inner">
            <h1 class="line"><span class="mark">#</span> 원문 그대로 쓰는 <br />한국어 마크다운 협업 도구</h1>
            <p class="blank" aria-hidden="true"></p>
            <p class="txt line"><span class="mark">##</span>를 쳐도 기호가 사라지지 않고, 입력한 그대로 남습니다.</p>
            <p class="blank" aria-hidden="true"></p>
            <p class="txt"><span class="line l1"><span class="mark">##</span> 회의록</span></p>
            <p class="txt"><span class="line l2">다음 회의는 <span class="mark">**</span>금요일 오후 2시<span class="mark">**</span>입니다</span></p>
            <p class="blank" aria-hidden="true"></p>
            <p class="txt"><span class="line l3"><span class="mark">-</span> 안건은 <span class="mark">[[</span>9월 로드맵<span class="mark">]]</span> 참고</span><span class="caret blink" aria-hidden="true"></span></p>
          </div>
        </div>
        <div class="actions">
          <a class="cta" href="/" data-cta="enter">로그인 없이 사용</a>
          <a class="cta cta-secondary" href="/api/login?return=" data-cta="login">로그인</a>
          <span class="note">설치도 로그인도 없이 시작합니다</span>
          <p class="cookie-escape">이 브라우저는 쿠키를 저장하지 못합니다. 아래 주소를 즐겨찾기에 두고 쓰세요 — <a href="/?app=1">앱으로 바로 가기</a></p>
        </div>
      </div>

      <section class="wrap">
        <h2>이런 것도 됩니다</h2>
        <ul class="feats">
          <li>
            <h3>로컬에서 바로 시작</h3>
            <p>문서는 브라우저에 저장됩니다. 필요할 때 로그인하면 여러 기기에서 이어서 씁니다</p>
          </li>
          <li>
            <h3>링크로 공유, 초대로 함께</h3>
            <p>편집 중인 문서는 자동으로 잠겨 서로의 내용이 겹치지 않습니다</p>
          </li>
          <li>
            <h3>실제로 쓰는 문법</h3>
            <p>표, 콜아웃, 위키링크, 이미지 첨부까지 문서에 필요한 문법을 지원합니다</p>
          </li>
          <li>
            <h3>설치하면 오프라인</h3>
            <p>브라우저에 설치해 네트워크가 없는 곳에서도 그대로 씁니다</p>
          </li>
        </ul>
      </section>

      <section class="wrap export">
        <h2>내보내도 원문 그대로</h2>
        <p>문서를 <code>.md</code> 로 내보내면 화면용으로 바꾼 문서가 아니라 직접 친 원문이 나옵니다. 기호 하나까지 같습니다.</p>
      </section>

      <section class="wrap soon">
        <h2>만들고 있습니다</h2>
        <ul class="feats">
          <li>
            <h3>동시 편집</h3>
            <p>초대한 사람과 한 문서를 같이 열고, 서로의 커서를 보면서 씁니다. 지금은 한 번에 한 명씩 편집합니다</p>
          </li>
          <li>
            <h3>댓글</h3>
            <p>문장을 골라 댓글을 답니다. 위에 줄을 더해도 댓글은 원래 문장을 계속 가리킵니다</p>
          </li>
        </ul>
      </section>

      <section class="wrap close">
        <div class="actions">
          <a class="cta" href="/" data-cta="enter">로그인 없이 사용</a>
          <span class="note">브라우저에서 바로 열립니다</span>
        </div>
      </section>
    </main>
    <footer class="wrap">${brand.name}</footer>
    <script>
      /* 예시 줄을 한글 조합 순서(초성 → 중성 → 종성)로 다시 쳐 보인다.
         완성된 글자는 이미 HTML 에 있고 이 스크립트는 그것을 읽어 되감을 뿐이라,
         스크립트가 없거나 크롤러가 읽으면 완성 문장이 그대로 보인다 (F-239.md 2장) */
      (function () {
        var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

        function stages(ch) {
          var code = ch.charCodeAt(0) - 0xac00
          if (code < 0 || code > 11171) return [ch]
          var jong = code % 28
          var jung = ((code - jong) / 28) % 21
          var cho = ((code - jong) / 28 - jung) / 21
          var out = [CHO.charAt(cho), String.fromCharCode(0xac00 + cho * 588 + jung * 28)]
          if (jong) out.push(ch)
          return out
        }

        function split(el) {
          var cells = []
          function walk(node) {
            if (node.nodeType === 3) {
              var frag = document.createDocumentFragment()
              for (var i = 0; i < node.data.length; i++) {
                var cell = document.createElement('span')
                cell.textContent = node.data.charAt(i)
                cell.style.visibility = 'hidden'
                frag.appendChild(cell)
                cells.push(cell)
              }
              node.parentNode.replaceChild(frag, node)
            } else {
              [].slice.call(node.childNodes).forEach(walk)
            }
          }
          ;[].slice.call(el.childNodes).forEach(walk)
          return cells
        }

        function type(cells, after) {
          var ci = 0
          function nextCell() {
            if (ci >= cells.length) return after()
            var cell = cells[ci]
            var done = cell.textContent
            var forms = stages(done)
            var si = 0
            cell.style.visibility = 'visible'
            function nextStage() {
              cell.textContent = forms[si]
              si += 1
              if (si < forms.length) return setTimeout(nextStage, 16)
              cell.textContent = done
              ci += 1
              setTimeout(nextCell, 10)
            }
            nextStage()
          }
          nextCell()
        }

        /* 히어로 문서는 welcome-demo.js 가 실제 편집기로 바꿔 치므로 여기서 건드리지 않는다.
           아래 섹션 제목만, 화면에 충분히 들어온 순간에 숨겼다가 바로 친다 —
           스크롤하지 않거나 관찰자가 없으면 완성 상태 그대로 남는다 */
        if (!window.IntersectionObserver) return
        var io = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return
              io.unobserve(entry.target)
              type(split(entry.target), function () {})
            })
          },
          { threshold: 1, rootMargin: '0px 0px -20% 0px' }
        )
        ;[].slice.call(document.querySelectorAll('main section h2')).forEach(function (h) {
          io.observe(h)
        })
      })()
    </script>
    ${ctaScript}
    <script type="module" src="/assets/welcome-demo.js"></script>
  </body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
