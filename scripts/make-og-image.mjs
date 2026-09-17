#!/usr/bin/env node
// OG·트위터 카드 이미지 생성 → public/og-image.png. 제품명·메인 컬러는 brand.config.ts, 나머지 색은 tokens.css 에서 읽는다
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import brand from '../brand.config.ts'

const root = new URL('../', import.meta.url)
const fileUrl = (path) => new URL(path, root).href
const icon = (name) =>
  readFileSync(fileURLToPath(new URL(`node_modules/@material-symbols/svg-400/outlined/${name}.svg`, root)), 'utf-8')
export const OG_SIZE = { width: 1200, height: 630 }
const outPath = fileURLToPath(new URL('public/og-image.png', root))
const logo = readFileSync(fileURLToPath(new URL(`public${brand.icon}`, root)), 'utf-8')

const html = `<!doctype html>
<html lang="ko" data-theme="white">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl('src/styles/tokens.css')}">
<style>
@font-face { font-family: 'Pretendard Variable'; src: url('${fileUrl('node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2')}') format('woff2'); font-weight: 45 920; }
@font-face { font-family: 'Noto Serif KR'; src: url('${fileUrl('node_modules/@fontsource/noto-serif-kr/files/noto-serif-kr-korean-900-normal.woff2')}') format('woff2'); font-weight: 900; }
@font-face { font-family: 'Noto Serif KR'; src: url('${fileUrl('node_modules/@fontsource/noto-serif-kr/files/noto-serif-kr-latin-900-normal.woff2')}') format('woff2'); font-weight: 900; unicode-range: U+0000-00FF; }
@font-face { font-family: 'Noto Serif KR'; src: url('${fileUrl('node_modules/@fontsource/noto-serif-kr/files/noto-serif-kr-korean-700-normal.woff2')}') format('woff2'); font-weight: 700; }
@font-face { font-family: 'Noto Serif KR'; src: url('${fileUrl('node_modules/@fontsource/noto-serif-kr/files/noto-serif-kr-latin-700-normal.woff2')}') format('woff2'); font-weight: 700; unicode-range: U+0000-00FF; }
:root { --brand-accent: ${brand.accent}; }
* { box-sizing: border-box; margin: 0; }
body {
  width: ${OG_SIZE.width}px; height: ${OG_SIZE.height}px; overflow: hidden; position: relative;
  background: var(--paper); color: var(--ink);
  font-family: var(--font-sans); letter-spacing: -0.02em; word-break: keep-all;
}
svg { width: 1em; height: 1em; fill: currentColor; display: block; }

.brand { position: absolute; top: 40px; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 12px; }
.brand-mark { width: 38px; height: 38px; }
.brand-mark svg { width: 100%; height: 100%; }
.brand-name { font-family: var(--font-serif); font-weight: 700; font-size: 32px; letter-spacing: -0.03em; }

.headline {
  position: absolute; top: 104px; left: 0; right: 0; text-align: center;
  font-family: var(--font-serif); font-weight: 900; font-size: 78px; line-height: 1.16; letter-spacing: -0.045em;
}
.pill {
  display: inline-flex; align-items: center; gap: 14px; vertical-align: 0.08em;
  height: 0.96em; padding: 0 0.3em 0 0.24em; margin-right: 0.12em; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  font-family: var(--font-mono); font-weight: 400; font-size: 70px; letter-spacing: 0; color: var(--accent);
}
.pill::before { content: ''; width: 0.36em; height: 0.36em; border-radius: 50%; background: var(--accent); }

.window {
  position: absolute; left: 96px; right: 96px; top: 340px; height: 320px;
  background: var(--panel); border: 1px solid var(--rule); border-radius: 16px; overflow: hidden;
  box-shadow: 0 24px 60px color-mix(in srgb, var(--ink) 10%, transparent);
  display: grid; grid-template-columns: 206px 1fr;
}
.side { background: var(--paper); border-right: 1px solid var(--rule); padding: 16px 12px; font-size: 14px; color: var(--ink-2); }
.side-brand { display: flex; align-items: center; gap: 8px; padding: 0 6px 16px; font-family: var(--font-serif); font-weight: 700; font-size: 17px; color: var(--ink); }
.side-brand .brand-mark { width: 22px; height: 22px; }
.side-row { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 8px; }
.side-row svg { font-size: 18px; }
.side-label { font-size: 11px; color: var(--muted); padding: 10px 8px 4px; }
.side-row.current { background: var(--panel); border: 1px solid var(--rule); color: var(--ink); font-weight: 600; padding-left: 30px; }
.side-row.sub { padding-left: 30px; }

.main { position: relative; }
.topbar { height: 56px; border-bottom: 1px solid var(--rule); display: flex; align-items: center; padding: 0 18px 0 26px; font-size: 15px; font-weight: 600; }
.modes { margin-left: auto; display: flex; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
.modes span { width: 34px; height: 30px; display: grid; place-items: center; font-size: 18px; color: var(--ink-2); }
.modes span.on { background: var(--ink); color: var(--panel); }

.doc { padding: 46px 0 0 104px; }
.line { display: flex; align-items: baseline; }
.ln { width: 34px; margin-left: -54px; margin-right: 20px; text-align: right; font-family: var(--font-mono); font-size: 13px; color: var(--muted); letter-spacing: 0; }
.mark { color: var(--accent); font-family: var(--font-mono); letter-spacing: 0; }
.h1 { font-family: var(--font-serif); font-weight: 700; font-size: 40px; letter-spacing: -0.03em; }
.h1 .mark { font-size: 36px; margin-right: 14px; }
.rule { height: 1px; background: var(--rule); margin: 14px 0 26px 0; width: 640px; }
.body { font-size: 19px; color: var(--ink); margin-bottom: 12px; }
.body .mark { font-size: 17px; margin-right: 10px; white-space: pre; }
.body b { font-weight: 700; }
</style>
</head>
<body>
  <div class="brand"><span class="brand-mark">${logo}</span><span class="brand-name">${brand.name}</span></div>

  <h1 class="headline">기호까지 그대로 남는<br><span class="pill">##</span>마크다운 편집기</h1>

  <div class="window">
    <aside class="side">
      <div class="side-brand"><span class="brand-mark">${logo}</span>${brand.name}</div>
      <div class="side-row">${icon('note_add')}새 문서</div>
      <div class="side-row">${icon('create_new_folder')}새 폴더</div>
      <div class="side-label">문서</div>
      <div class="side-row current">주간 회의록</div>
      <div class="side-row sub">사용법</div>
    </aside>
    <section class="main">
      <div class="topbar">주간 회의록
        <div class="modes"><span class="on">${icon('edit')}</span><span>${icon('code')}</span><span>${icon('visibility')}</span></div>
      </div>
      <div class="doc">
        <div class="line h1"><span class="ln">1</span><span class="mark">#</span>주간 회의록</div>
        <div class="rule"></div>
        <div class="line body"><span class="ln">3</span><span class="mark">- [x]</span>공유 링크 권한 확인</div>
        <div class="line body"><span class="ln">4</span><span class="mark">-</span><span class="mark" style="margin-right:0">**</span><b>원문 모드</b><span class="mark">**</span>전환 정리</div>
      </div>
    </section>
  </div>

</body>
</html>`

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: OG_SIZE, deviceScaleFactor: 2 })
// file:// 서체·CSS 를 읽으려면 about:blank 가 아니라 파일로 열어야 한다
const tmp = mkdtempSync(join(tmpdir(), 'og-image-'))
const htmlPath = join(tmp, 'og-image.html')
writeFileSync(htmlPath, html)
await page.goto(pathToFileURL(htmlPath).href)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: outPath })
await browser.close()
rmSync(tmp, { recursive: true, force: true })
console.log(outPath)
