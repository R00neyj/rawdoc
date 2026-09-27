// 랜딩 페이지 / — GEO 대응을 위해 React 번들 대신 완결된 정적 HTML 문자열을 반환한다 (F-239.md 2장, F-271.md 4장, F-272.md 5.4)
import brand from '../brand.config'
import { EARLY_APP_KEYS, LANDING_DONE_KEY, buildAppCookie } from '../src/lib/appEntry'
import { renderSiteHeader, renderSiteFooter, SITE_CHROME_CSS } from '../src/lib/siteChrome'
import { SITE_URL } from '../src/lib/siteMeta'
import {
  STORY_BASE_LINES,
  STORY_TERMINAL,
  STORY_WIKI_EDGES,
  STORY_WIKI_NODES,
} from '../src/welcome/storyDoc'
import { PAGE_DARK_VARS, PAGE_TOKENS_CSS } from './pageTokens'

const siteUrl = SITE_URL
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

// 사이트 페이지와 같은 머리·꼬리 (F-272.md 5.4). appCta:'enter' 는 data-cta="enter" 를 붙여 기존 CTA 클릭 스크립트(4.3)가 두 값을 쓰고 reload 하게 한다
const siteHeader = renderSiteHeader({ brandName: brand.name, brandIcon: brand.icon, appCta: 'enter' })
const siteFooter = renderSiteFooter({ brandName: brand.name })

// JS 가 켜졌다는 표시 — 등장 전에 숨길 글자(.tw)는 이 표시가 있을 때만 숨긴다. 크롤러·JS 꺼짐에는 완성 글자가 보인다 (F-239 2.1)
const jsFlagScript = `<script>document.documentElement.classList.add('js')</script>`

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// 원문 한 줄의 마크다운 기호에 강조색을 입힌다 — 편집기 .md-mark 와 같은 규칙. 정적(JS 꺼짐) 스토리 문서용
function markLine(line: string): string {
  const escaped = escapeHtml(line)
  return escaped
    .replace(/^(#{1,6} |&gt; \[![a-z]+\] |- \[[ x]\] |- )/, '<span class="mark">$1</span>')
    .replace(/(\*\*|\[\[|\]\])/g, '<span class="mark">$1</span>')
}

const storyStaticLines = STORY_BASE_LINES.map(
  (line) => `<div class="sl">${line ? markLine(line) : '&#8203;'}</div>`,
).join('')

const storyTerminal = STORY_TERMINAL.map(
  (cmd, i) => `<div class="tl" data-step="${i}"><span class="prompt">$</span> ${escapeHtml(cmd)}</div>`,
).join('')

const nodeById = new Map(STORY_WIKI_NODES.map((n) => [n.id, n]))
const storyWikiEdges = STORY_WIKI_EDGES.map(([a, b, step]) => {
  const from = nodeById.get(a)!
  const to = nodeById.get(b)!
  return `<line class="edge" data-step="${step}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`
}).join('')
const storyWikiNodes = STORY_WIKI_NODES.map(
  (n) =>
    `<g class="node${n.id === 'meeting' ? ' is-root' : ''}" data-step="${n.step}" transform="translate(${n.x} ${n.y})"><circle r="${n.id === 'meeting' ? 9 : 6}" /><text y="${n.y > 150 ? 24 : -16}">${escapeHtml(n.label)}</text></g>`,
).join('')

type Chapter = { title: string; body: string }

// 스토리 장면 — 순서가 곧 스크롤 순서다. 문장은 도움말·사용법 글·체인지로그에 적힌 사실만
const chapters: Chapter[] = [
  {
    title: '기호는 커서가 닿은 줄에만',
    body: '나머지 줄은 다듬어진 모습으로 보입니다. 기호는 숨었을 뿐, 지워지지 않습니다.',
  },
  {
    title: '한글은 조합되는 그대로',
    body: '초성, 중성, 받침이 차례로 붙습니다. 한국어로 쓰는 사람을 위해 만든 편집기입니다.',
  },
  {
    title: '초대한 사람과 한 문서를 같이',
    body: '서로 고친 내용과 커서가 바로 보입니다. 링크만 받은 사람은 로그인 없이 읽습니다.',
  },
  {
    title: '댓글은 문장에 붙습니다',
    body: '위에 줄이 늘어나도 댓글은 원래 문장을 따라갑니다. `@` 로 부르면 그 사람에게 알림이 갑니다.',
  },
  {
    title: '뒤집어 보면, 친 그대로',
    body: '원문 모드와 내보낸 `.md` 파일에는 입력한 글자가 한 바이트도 바뀌지 않고 남습니다.',
  },
  {
    title: 'AI 에게 위키를 맡기기',
    body: `명령줄 도구 \`${brand.cliName}\` 를 AI 코딩 도구에 쥐여 주면 문서를 읽고, 만들고, \`[[위키링크]]\` 로 잇습니다. 이어진 문서는 지도로 봅니다.`,
  },
]

// 본문 속 `…` 은 고정폭 <code> 로 — 단축키·문법·명령을 원문 글자로 보인다
function renderInline(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>')
}

const storyChapters = chapters
  .map(
    (ch, i) => `
            <article class="chapter" data-step="${i}">
              <h2>${ch.title}</h2>
              <p>${renderInline(ch.body)}</p>${
                i === chapters.length - 1
                  ? '\n              <a class="guide" href="/guides/cli">터미널에서 문서 읽고 쓰기</a>'
                  : ''
              }
            </article>`,
  )
  .join('')

type Feature = { title: string; body: string; guide?: { slug: string; title: string } }

// 스토리가 보여 주지 않은 나머지 기능 — 스토리와 겹치는 것(편집 모드·동시 편집·댓글·원문·명령줄)은 뺐다
const features: Feature[] = [
  {
    title: '표',
    body: '칸을 눌러 한 칸씩 고치고 `Tab`·`Enter` 로 옆 칸과 아래 칸으로 갑니다',
    guide: { slug: 'tables', title: '표 넣고 고치기' },
  },
  { title: '콜아웃·수식·다이어그램', body: '`> [!note]` 콜아웃, 수식, Mermaid 다이어그램을 문서 안에서 그립니다' },
  {
    title: '이미지',
    body: '붙여넣거나 끌어 놓아 넣고, 정렬과 크기를 조절합니다',
    guide: { slug: 'images', title: '문서에 이미지 넣기' },
  },
  {
    title: '명령 팔레트와 템플릿',
    body: '`Ctrl+P` 로 명령을 찾고, 회의록·일일 노트 같은 틀을 커서 자리에 넣습니다',
    guide: { slug: 'command-palette-templates', title: '명령 팔레트와 템플릿' },
  },
  {
    title: '모든 문서 검색',
    body: '`Ctrl+Shift+F` 로 제목·본문·속성을 찾고, 연 문서에서 이어 찾거나 바꿉니다',
    guide: { slug: 'search', title: '검색과 찾기·바꾸기' },
  },
  {
    title: '3D 지도',
    body: '위키링크로 이어진 문서를 3D 지도로 보고, 필터와 그룹으로 좁힙니다',
    guide: { slug: 'wiki-map', title: '지도로 문서 사이 연결 보기' },
  },
  {
    title: '로그인 없이 시작',
    body: '문서는 이 브라우저에 저장됩니다. Google·GitHub 로 로그인하면 여러 기기에서 이어서 씁니다',
    guide: { slug: 'account', title: '계정과 로그인' },
  },
  {
    title: '설치하면 오프라인',
    body: '네트워크가 없는 곳에서도 열고 고칩니다. 다시 연결되면 고친 내용이 올라갑니다',
    guide: { slug: 'offline-sync', title: '오프라인과 동기화' },
  },
  {
    title: '금고',
    body: '고른 문서만 브라우저에서 암호화해 저장합니다. 운영자도 읽을 수 없습니다',
    guide: { slug: 'encryption', title: '금고로 문서 암호화하기' },
  },
  {
    title: '내보내기와 가져오기',
    body: '`.md`·`.txt`·HTML·PDF 로 내보내고, 옵시디언 볼트와 오갑니다',
    guide: { slug: 'obsidian-vault', title: '옵시디언 볼트와 오가기' },
  },
]

const featureItems = features
  .map((item) => {
    const guide = item.guide ? `\n              <a class="guide" href="/guides/${item.guide.slug}">${item.guide.title}</a>` : ''
    return `
            <li>
              <h3>${item.title}</h3>
              <p>${renderInline(item.body)}</p>${guide}
            </li>`
  })
  .join('')

export function renderWelcomePage(): Response {
  const html = `<!doctype html>
<html lang="ko">
  <head>
    ${earlyScript}
    ${jsFlagScript}
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
      ${PAGE_TOKENS_CSS}
      :root {
        /* tokens.css 다크 테마가 --accent 를 이 값에서 밝혀 만든다 — 스토리가 html 을 다크로 바꿀 때 쓰인다 */
        --brand-accent: ${brand.accent};
        /* 여백에 거는 원문 기호 색 — 공개 글 페이지(.site-doc --site-mark)와 같은 섞기 */
        --mark-soft: color-mix(in srgb, var(--accent) 42%, var(--paper));
        --ease-out: cubic-bezier(0, 0, 0.2, 1);
      }
      * { box-sizing: border-box; letter-spacing: var(--tracking); }
      html { background: var(--paper); transition: background-color 600ms var(--ease-out); }
      body {
        margin: 0;
        background: var(--paper);
        color: var(--ink);
        transition: background-color 600ms var(--ease-out), color 600ms var(--ease-out);
        font-family: var(--font-body);
        font-size: 17px;
        line-height: 1.6;
        /* 한국어는 낱글자 단위로 끊으면 뜻이 달라진다 — 어절 단위로만 넘긴다 */
        word-break: keep-all;
        overflow-wrap: break-word;
        -webkit-font-smoothing: antialiased;
        transition: background-color 600ms var(--ease-out), color 600ms var(--ease-out);
      }
      .wrap {
        max-width: var(--page);
        margin-left: auto;
        margin-right: auto;
        padding: 0 32px;
      }
      /* 편집 화면의 마크다운 기호 강조(.md-mark) 와 같은 규칙 */
      .mark {
        color: var(--accent);
        font-family: var(--font-mono);
        font-weight: 400;
        --tracking: 0;
      }
      code {
        font-family: var(--font-mono);
        font-size: 0.9em;
        background: var(--rule-2);
        border-radius: 3px;
        padding: 1px 4px;
        --tracking: 0;
      }

      /* 등장 전 글자 숨김 — 스크립트가 칸으로 쪼갠 뒤 .tw-on 을 붙인다. 스크립트가 끝내 안 돌면 3.5초 뒤 보인다 */
      .js .tw { visibility: hidden; animation: tw-fallback 0s linear 3.5s forwards; }
      .js .tw.tw-on { visibility: visible; animation: none; }
      .js.tw-ready .tw { animation: none; } /* 타이핑 스크립트가 돌기 시작했으면 3.5초 대비책을 끈다 — 화면에 들어올 때까지 기다린다 */
      @keyframes tw-fallback { to { visibility: visible; } }

      /* 히어로 — 제목 한 줄이 곧 문서 첫 줄이다. # 은 지우지 않고 여백에 건다 */
      .hero {
        min-height: calc(100svh - 76px);
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding-top: 32px;
        padding-bottom: 88px;
        position: relative;
      }
      .hero h1 {
        position: relative;
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(2.5rem, 1.1rem + 5.4vw, 5.5rem);
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: -0.045em;
      }
      .hero h1 .hash { margin-right: 0.28em; font-size: 0.8em; vertical-align: 0.06em; }
      .caret {
        display: inline-block;
        width: 0.06em;
        min-width: 2px;
        height: 0.95em;
        margin-left: 0.06em;
        margin-right: -0.12em; /* 줄 폭을 차지하지 않게 — 마지막 글자 옆에 붙고 혼자 다음 줄로 넘어가지 않는다 */
        vertical-align: -0.1em;
        background: var(--accent);
      }
      @media (prefers-reduced-motion: no-preference) {
        .caret { animation: rd-blink 1.1s steps(1) infinite; }
        @keyframes rd-blink { 0% { opacity: 0; } 50% { opacity: 1; } }
      }
      .hero .sub {
        margin: 32px 0 0;
        max-width: 32em;
        color: var(--ink-2);
        font-size: clamp(1.1rem, 0.95rem + 0.6vw, 1.4rem);
        line-height: 1.55;
      }
      .js .hero .reveal { opacity: 0; transform: translateY(10px); }
      .hero.is-ready .reveal {
        opacity: 1;
        transform: none;
        transition: opacity 500ms var(--ease-out), transform 700ms var(--ease-out);
      }
      .hero.is-ready .actions.reveal { transition-delay: 120ms; }

      .actions {
        display: flex;
        align-items: center;
        gap: 12px 20px;
        flex-wrap: wrap;
        margin-top: 40px;
      }
      .cta {
        display: inline-block;
        background: var(--accent);
        color: var(--panel);
        text-decoration: none;
        font-weight: 700;
        padding: 13px 28px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-control);
        transition: background-color 180ms var(--ease-out), border-color 180ms var(--ease-out);
      }
      .cta:hover {
        background: color-mix(in srgb, var(--accent) 86%, var(--ink));
        border-color: color-mix(in srgb, var(--accent) 86%, var(--ink));
      }
      .cta:focus-visible, .guide:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
      .cta-secondary { background: transparent; color: var(--ink); border-color: var(--rule); }
      .cta-secondary:hover { background: var(--rule-2); border-color: var(--rule); }
      .note { color: var(--ink-2); font-size: 0.95rem; }
      /* 쿠키를 저장하지 못하는 브라우저에서만 조기 판정 스크립트가 <html data-cookie-escape> 로 드러낸다 (2.3) */
      .cookie-escape { display: none; width: 100%; margin: 0; color: var(--ink-2); font-size: 0.95rem; }
      html[data-cookie-escape='1'] .cookie-escape { display: block; }
      .cookie-escape a { color: var(--accent); }

      /* 스토리 무대 — JS 없이도 이 범위만 앱 다크 값으로 칠한다. JS 가 붙으면(.is-live) 스크롤로 조종된다 */
      .story {
        ${PAGE_DARK_VARS}
        --mark-soft: color-mix(in srgb, var(--accent) 50%, var(--paper));
        background: var(--paper);
        color: var(--ink);
        padding: 120px 0;
      }
      .stage-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        column-gap: 56px;
        align-items: start;
      }
      .rail { display: none; }
      .chapter + .chapter { margin-top: 30vh; }
      .chapter h2 {
        position: relative;
        margin: 0 0 16px;
        font-family: var(--font-display);
        font-size: clamp(1.45rem, 0.9rem + 1.3vw, 2.1rem);
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: -0.035em;
        white-space: nowrap;
      }
      .chapter h2::before {
        content: '##' / '';
        margin-right: 0.35em;
        font-family: var(--font-mono);
        font-weight: 400;
        font-size: 0.75em;
        color: var(--mark-soft);
        --tracking: 0;
      }
      .chapter p { margin: 0; max-width: 26em; color: var(--ink-2); font-size: 1.08rem; }
      .screen { position: sticky; top: 12vh; display: grid; gap: 24px; }
      .win {
        background: var(--panel);
        border: 1px solid var(--rule);
        border-radius: var(--radius-dialog);
        overflow: hidden;
        box-shadow: 0 40px 80px -40px rgba(0, 0, 0, 0.6);
      }
      .win-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 18px;
        border-bottom: 1px solid var(--rule);
        color: var(--muted);
        font-size: 13px;
      }
      .win-name { color: var(--ink-2); font-weight: 600; }
      .win-mode { margin-left: auto; display: flex; border: 1px solid var(--rule); border-radius: var(--radius-control); overflow: hidden; }
      .win-mode span { padding: 2px 10px; transition: background-color 200ms var(--ease-out), color 200ms var(--ease-out); }
      .win-mode .on { background: color-mix(in srgb, var(--ink) 12%, transparent); color: var(--ink); }
      .win-bytes { font-family: var(--font-mono); --tracking: 0; min-width: 7ch; text-align: right; }
      .win-body { position: relative; }
      .story-static {
        padding: 22px 26px 26px 0;
        font-size: 16px;
        line-height: 1.75;
        counter-reset: sl;
      }
      .sl { counter-increment: sl; display: flex; min-height: 1.75em; }
      .sl::before {
        content: counter(sl);
        flex: none;
        width: 52px;
        padding-right: 20px;
        text-align: right;
        color: var(--muted);
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 2.3;
        --tracking: 0;
      }
      .overlay { position: absolute; inset: 0; pointer-events: none; }
      /* 스토리 무대 장치 — 다른 사람 커서·댓글 앵커·말풍선. 색은 앱 접속자 색(--peer, peers.css)과 댓글 앵커 토큰 */
      .st-peer, .st-anchor, .st-bubble { position: absolute; left: 0; top: 0; opacity: 0; will-change: transform; }
      .st-peer { width: 2px; background: var(--peer); }
      .st-peer-label {
        position: absolute;
        bottom: 100%;
        left: -2px;
        padding: 0 5px;
        border-radius: 4px 4px 4px 0;
        background: var(--peer);
        color: var(--paper);
        font-size: 11px;
        font-weight: 600;
        line-height: 1.6;
        white-space: nowrap;
      }
      .st-anchor { background: var(--comment-anchor); border-bottom: 2px solid var(--comment-anchor-line); }
      .st-bubble {
        left: auto;
        right: 18px;
        width: min(250px, 70%);
        padding: 10px 12px;
        border: 1px solid var(--rule);
        border-radius: var(--radius-dialog);
        background: var(--panel);
        box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.7);
        font-size: 14px;
        line-height: 1.5;
      }
      .st-bubble p { margin: 4px 0 0; color: var(--ink); }
      .st-bubble-head { display: flex; align-items: center; gap: 8px; font-size: 13px; }
      .st-avatars { display: flex; margin-left: auto; }
      .st-avatars + .win-mode { margin-left: 0; }
      .st-avatar {
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--peer);
        color: var(--paper);
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }
      .st-avatars .st-avatar { border: 2px solid var(--panel); }
      .st-avatars .st-avatar + .st-avatar { margin-left: -6px; }
      .st-avatar-peer { opacity: 0; }

      .wiki { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
      .term, .map-box {
        background: var(--panel);
        border: 1px solid var(--rule);
        border-radius: var(--radius-dialog);
        overflow: hidden;
      }
      .term-bar { padding: 8px 14px; border-bottom: 1px solid var(--rule); color: var(--muted); font-size: 12px; }
      .term-body {
        margin: 0;
        padding: 14px 16px 18px;
        font-family: var(--font-mono);
        font-size: 13px;
        line-height: 1.9;
        --tracking: 0;
        color: var(--ink);
        white-space: pre;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .term-body .prompt { color: var(--accent); }
      .map { display: block; width: 100%; height: auto; max-height: 40svh; }
      .map .edge { stroke: var(--mark-soft); stroke-width: 1.5; }
      .map .node circle { fill: var(--panel); stroke: var(--accent); stroke-width: 2; }
      .map .node.is-root circle { fill: var(--accent); }
      .map .node text { fill: var(--ink-2); font-size: 13px; text-anchor: middle; font-family: var(--font-body); }

      /* 스토리 실행 중(.is-live) — 무대를 화면 높이에 고정하고 장면을 겹쳐 두고 바꾼다 */
      .story.is-live { padding: 0; }
      .story.is-live .stage { height: 100svh; display: flex; align-items: center; overflow: hidden; }
      .story.is-live .stage-grid { width: 100%; align-items: center; }
      .story.is-live .copy { position: relative; }
      .story.is-live .rail { display: flex; gap: 6px; list-style: none; margin: 0 0 36px; padding: 0; }
      .story.is-live .rail li { width: 22px; height: 3px; border-radius: 2px; background: var(--rule); overflow: hidden; }
      .story.is-live .rail li i { display: block; height: 100%; width: 100%; background: var(--accent); transform: scaleX(0); transform-origin: left; }
      .story.is-live .chapters { display: grid; }
      .story.is-live .chapter { grid-area: 1 / 1; margin: 0; visibility: hidden; }
      .story.is-live .screen { position: relative; top: auto; display: block; }
      .story.is-live .wiki { position: absolute; inset: 0; align-content: center; visibility: hidden; }
      #story-editor.cm-host { height: auto; padding: 0; }
      #story-editor .cm-editor, #story-editor .cm-scroller { height: auto; }
      #story-editor .doc-title-block { display: none; }
      /* 무대 편집기 — 앱의 위아래 여백(스크롤 여유)을 걷고 창 높이를 고정해 문서가 늘어도 창이 흔들리지 않게 한다 */
      #story-editor .cm-editor .cm-content { padding: 18px 0 28px; min-height: 0; }
      .story.is-live .win-body { height: clamp(340px, 60svh, 540px); overflow: hidden; }
      .st-caret { position: absolute; left: 0; top: 0; width: 2px; background: var(--ink); display: none; animation: st-blink 1.1s steps(1) infinite; }
      @keyframes st-blink { 50% { opacity: 0; } }

      /* 스토리 뒤 — 나머지 기능 */
      .sec { margin-top: 136px; }
      .sec h2 {
        position: relative;
        margin: 0 0 40px;
        font-family: var(--font-display);
        font-size: clamp(1.6rem, 1.2rem + 1.2vw, 2.2rem);
        font-weight: 700;
        letter-spacing: -0.035em;
        line-height: 1.25;
      }
      .sec h2::before {
        content: '##' / '';
        margin-right: 0.35em;
        font-family: var(--font-mono);
        font-weight: 400;
        font-size: 0.75em;
        color: var(--mark-soft);
        --tracking: 0;
      }
      .lead { margin: -24px 0 40px; max-width: var(--read-w); color: var(--ink-2); font-size: 1.0625rem; }
      .items {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        column-gap: 48px;
        row-gap: 36px;
      }
      .items li { position: relative; padding-left: 1.25em; }
      .items li::before {
        content: '-' / '';
        position: absolute;
        left: 0;
        top: 0;
        font-family: var(--font-mono);
        color: var(--mark-soft);
        --tracking: 0;
      }
      .items h3 { font-size: 1rem; font-weight: 700; margin: 0 0 4px; }
      .items p { margin: 0; color: var(--ink-2); font-size: 0.95rem; }
      .guide {
        display: inline-block;
        margin-top: 8px;
        color: var(--ink-2);
        font-size: 14px;
        text-decoration: underline;
        text-decoration-color: var(--rule);
        text-underline-offset: 4px;
        transition: color 180ms var(--ease-out), text-decoration-color 180ms var(--ease-out);
      }
      .guide:hover { color: var(--accent); text-decoration-color: currentColor; }
      .chapter .guide { margin-top: 16px; }

      .close { margin-top: 160px; margin-bottom: 120px; }
      .close h2 { font-size: clamp(2rem, 1.2rem + 3vw, 3.5rem); margin-bottom: 24px; }
      .close .lead { margin: 0 0 36px; }
      .close .actions { margin-top: 0; }

      /* 여백이 기호를 담을 만큼 넓을 때만 건다 — 글자선이 로고 왼쪽 선과 맞는다 */
      @media (min-width: 1160px) {
        .hero h1 .hash { position: absolute; right: 100%; }
        .sec h2::before, .chapter h2::before { position: absolute; right: 100%; bottom: 0.12em; margin-right: 0.4em; }
        .items li { padding-left: 0; }
        .items li::before { left: auto; right: 100%; margin-right: 0.6em; }
      }
      @media (max-width: 980px) {
        .items { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 860px) {
        body { font-size: 16px; }
        .wrap { padding: 0 16px; }
        .stage-grid { grid-template-columns: minmax(0, 1fr); row-gap: 40px; }
        .screen { position: static; }
        .chapter + .chapter { margin-top: 56px; }
        .story.is-live .win-body { height: clamp(280px, 46svh, 420px); }
        .term-body { font-size: 12px; }
        /* 좁은 창 스토리 — 편집기가 위, 장면 설명이 아래 */
        .story.is-live .stage { align-items: stretch; }
        .story.is-live .stage-grid { align-items: stretch; }
        .hero { min-height: auto; padding-top: 88px; padding-bottom: 72px; }
        .story.is-live .stage-grid { display: flex; flex-direction: column-reverse; justify-content: flex-end; gap: 20px; padding-top: 72px; padding-bottom: 24px; }
        .story.is-live .rail { margin-bottom: 16px; }
        .chapter h2 { font-size: min(1.45rem, 6.2vw); }
        .story.is-live .chapter h2 { margin-bottom: 8px; }
        .story.is-live .chapter p { font-size: 0.98rem; }
        .story.is-live .chapter .guide { display: none; }
        .story.is-live .story-static, .story.is-live #story-editor { font-size: 14px; }
        .story.is-live .wiki { align-content: start; }
        .sec { margin-top: 96px; }
        .items { grid-template-columns: minmax(0, 1fr); row-gap: 28px; }
        .close { margin-top: 112px; margin-bottom: 72px; }
      }
      ${SITE_CHROME_CSS}
    </style>
  </head>
  <body>
    ${siteHeader}
    <main>
      <section class="wrap hero" id="hero">
        <h1><span class="mark hash">#</span><span class="tw" data-tw="hero">원문 그대로 쓰는 <br />한국어 마크다운 협업 도구</span><span class="caret" aria-hidden="true"></span></h1>
        <p class="sub reveal"><span class="mark">##</span>를 쳐도 기호가 사라지지 않고, 입력한 그대로 남습니다.</p>
        <div class="actions reveal">
          <a class="cta" href="/" data-cta="enter">로그인 없이 사용</a>
          <a class="cta cta-secondary" href="/api/login?return=" data-cta="login">로그인</a>
          <span class="note">설치도 로그인도 없이 시작합니다</span>
          <p class="cookie-escape">이 브라우저는 쿠키를 저장하지 못합니다. 아래 주소를 즐겨찾기에 두고 쓰세요 — <a href="/?app=1">앱으로 바로 가기</a></p>
        </div>
      </section>

      <section class="story" id="story" aria-label="편집기가 보여 주는 기능">
        <div class="stage">
          <div class="wrap stage-grid">
            <div class="copy">
              <ol class="rail" aria-hidden="true">${chapters.map(() => '<li><i></i></li>').join('')}</ol>
              <div class="chapters">${storyChapters}
              </div>
            </div>
            <div class="screen">
              <div class="flip">
                <div class="win">
                  <div class="win-bar">
                    <span class="win-name">회의록</span>
                    <span class="win-mode" aria-hidden="true"><span class="on" data-mode="live">편집</span><span data-mode="raw">원문</span></span>
                    <span class="win-bytes" id="story-bytes"></span>
                  </div>
                  <div class="win-body">
                    <div id="story-editor" class="story-static">${storyStaticLines}</div>
                    <div class="overlay" id="story-overlay" aria-hidden="true"></div>
                  </div>
                </div>
              </div>
              <div class="wiki" id="story-wiki">
                <div class="term">
                  <div class="term-bar">터미널 — AI 코딩 도구가 실행</div>
                  <pre class="term-body">${storyTerminal}</pre>
                </div>
                <div class="map-box">
                  <svg class="map" viewBox="0 0 400 300" role="img" aria-label="위키링크로 이어진 문서 지도">${storyWikiEdges}${storyWikiNodes}</svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="wrap sec">
        <h2><span class="tw" data-tw="scroll">그 밖에 되는 것</span></h2>
        <ul class="items">${featureItems}
        </ul>
      </section>

      <section class="wrap sec close">
        <h2><span class="tw" data-tw="scroll">브라우저에서 바로 쓰기</span></h2>
        <p class="lead">설치도 가입도 없이 열립니다. 이 브라우저에서 쓰던 문서는 처음 로그인할 때 계정으로 옮겨집니다.</p>
        <div class="actions">
          <a class="cta" href="/" data-cta="enter">로그인 없이 사용</a>
          <a class="cta cta-secondary" href="/api/login?return=" data-cta="login">로그인</a>
        </div>
      </section>
    </main>
    ${siteFooter}
    <script>
      /* 완성 문장은 HTML 에 있다 — 칸으로 쪼개 숨겼다가 초성→중성→종성 순으로 드러낼 뿐이라 스크립트가 없으면 그대로 보인다 (F-239.md 2장) */
      (function () {
        var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        var hero = document.getElementById('hero')

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
          el.classList.add('tw-on')
          return cells
        }

        function type(cells, stageMs, charMs, after) {
          var ci = 0
          function nextCell() {
            if (ci >= cells.length) return after && after()
            var cell = cells[ci]
            var done = cell.textContent
            var forms = stages(done)
            var si = 0
            cell.style.visibility = 'visible'
            function nextStage() {
              cell.textContent = forms[si]
              si += 1
              if (si < forms.length) return setTimeout(nextStage, stageMs)
              cell.textContent = done
              ci += 1
              setTimeout(nextCell, charMs)
            }
            nextStage()
          }
          nextCell()
        }

        var targets = [].slice.call(document.querySelectorAll('.tw'))
        document.documentElement.classList.add('tw-ready')
        if (reduce) {
          targets.forEach(function (el) { el.classList.add('tw-on') })
          hero.classList.add('is-ready')
          return
        }

        var heroTitle = document.querySelector('[data-tw="hero"]')
        type(split(heroTitle), 34, 26)
        setTimeout(function () { hero.classList.add('is-ready') }, 900)

        var scrolled = targets.filter(function (el) { return el.getAttribute('data-tw') === 'scroll' })
        if (!window.IntersectionObserver) {
          scrolled.forEach(function (el) { el.classList.add('tw-on') })
          return
        }
        function start(el) {
          if (scrolled.indexOf(el) < 0) return
          scrolled.splice(scrolled.indexOf(el), 1)
          io.unobserve(el)
          type(split(el), 40, 36)
        }
        var io = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) { if (entry.isIntersecting) start(entry.target) })
          },
          // 화면 아래 끝에 걸리자마자 치면 읽기 전에 끝난다 — 제목이 화면 위쪽 60% 안으로 다 올라왔을 때 친다
          { threshold: 1, rootMargin: '0px 0px -40% 0px' }
        )
        scrolled.forEach(function (el) { io.observe(el) })
        // 키 큰 창에서는 맨 아래 제목이 그 선까지 못 올라온다 — 끝까지 내리면 남은 제목을 친다
        window.addEventListener('scroll', function () {
          if (window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 4) return
          scrolled.slice().forEach(start)
        }, { passive: true })
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
