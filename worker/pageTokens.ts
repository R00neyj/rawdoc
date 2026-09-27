// 랜딩(/)·로그인(/login) 공통 색·서체·형태 변수 — 앱 화이트 테마(src/styles/tokens.css) 값의 사본 한 벌 (specs/features/F-2033.md 6.3)
import brand from '../brand.config'

export const PAGE_TOKENS_CSS = `:root {
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
      }`

// 앱 다크 테마(tokens.css :root[data-theme='dark']) 값의 사본 — 랜딩 스토리 무대를 JS 없이도 어둡게 칠할 때 그 범위에만 건다
export const PAGE_DARK_VARS = `color-scheme: dark;
        --paper: #1a1917;
        --panel: #21201d;
        --ink: #e8e4dc;
        --ink-2: #bdb7ac;
        --muted: #8c877d;
        --rule: #36332e;
        --rule-2: #2a2825;
        --accent: color-mix(in srgb, ${brand.accent} 55%, white);`
