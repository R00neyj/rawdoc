// 사용자 CSS 검사·컴파일·적용·탭 (specs/features/F-2094.md 7.5 → F-2095 → F-2096 순서로 이어 쓴다)
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 앱은 아직 컴파일러를 부르지 않으므로 모듈을 직접 묶어 가짜 출처 페이지에 넣는다 (7.5, M11)
async function bundleCompiler() {
  const result = await build({
    root: ROOT,
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: 'src/app/userCssCompile.ts', formats: ['iife'], name: 'UserCssCompile' },
    },
  })
  return (Array.isArray(result) ? result[0] : result).output[0].code
}

// 7.5 표 1~15행
const HOSTILE = String.raw`@import url(http://evil.test/imp.css);
@\69mport url(http://evil.test/esc-imp.css);
@namespace svg url(http://www.w3.org/2000/svg);
@property --p { syntax: '<url>'; inherits: false; initial-value: url(http://evil.test/prop.png) }
@function --f() { result: url(http://evil.test/fn.png) }
.j { background-image: --f() }
@font-face { font-family: Evil; src: url(http://evil.test/f.woff2) }
.a { font-family: Evil, Ok; background-image: var(--v) }
:root { --v: \75 rl(http://evil.test/cv.png); --w: url(http://evil.test/cw.png); --s: "http://evil.test/cs.png" }
.b { background-image: var(--w) }
.c { background-image: image-set(var(--s) 1x) }
.w { background-image: image(var(--s)) }
.d { background-image: \75 rl(http://evil.test/esc.png) }
.v { background-image: URL(http://evil.test/up.png) }
.e { background-image: image-set("http://evil.test/is.png" 1x) }
.x { background-image: -webkit-image-set(url(http://evil.test/wis.png) 1x) }
.f { background: red url(http://evil.test/bg.png) no-repeat; border-image: url(http://evil.test/bi.png) 30 }
.g { background-image: var(--nope, \75 rl(http://evil.test/vf.png)) }
.h { background-image: if(media(width > 1px): url(http://evil.test/if.png); else: none) }
.i { background-image: env(nope, url(http://evil.test/env.png)) }
.z { background: var(--nope, url(http://evil.test/sh.png)) }
.y { margin: var(--m, 7px); margin-top: 0; background: var(--nope2, url(http://evil.test/hidden.png)); background-color: red }
.k { & .l { background-image: url(http://evil.test/n.png) } color: blue; list-style-image: url(//evil.test/l.png) }
@media all { .m { background-image: url(http://evil.test/media.png) } }
@keyframes kf { from { background-image: url(http://evil.test/kf.png) } to { opacity: 1 } }
.n { animation: kf 10s infinite }
@page { @top-left { content: url(http://evil.test/m.png) } }
`
// 7.5 표 16행 — 글자 그대로 남아야 한다
const KEEP = String.raw`@layer a, b;
@font-face { font-family: Ok; src: local(Arial), url(data:font/woff2;base64,AAAA) }
.o { background-image: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=); filter: url(#x) }
.o::before { content: "\201C" }
:root { --ok: 12px }
.p { padding: var(--ok) }
`
const SOURCE = HOSTILE + KEEP
const HTML = `<!doctype html><html><head></head><body>${'abcdefghijklmnopqrstuvwxyz'
  .split('')
  .map((c) => `<div class="${c}"><span class="l">x</span></div>`)
  .join('')}</body></html>`

async function openFakeOrigin(browser, compilerCode) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const requests = []
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url === 'http://app.test/') return route.fulfill({ status: 200, contentType: 'text/html', body: HTML })
    requests.push(url)
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://app.test/')
  if (compilerCode) await page.addScriptTag({ content: compilerCode })
  return { context, page, evil: () => requests.filter((u) => u.includes('evil.test')) }
}

// 시트를 붙이고 모든 요소의 계산 스타일을 읽어 불러오기를 일으킨 뒤 글꼴을 기다린다
async function applySheet(page, css) {
  await page.evaluate(async (text) => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(text)
    document.adoptedStyleSheets = [sheet]
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      void [style.backgroundImage, style.fontFamily, style.borderImageSource, style.listStyleImage, style.animationName]
    }
    await document.fonts.ready
  }, css)
}

test('F-2094 A12 외부 주소를 부르는 스니펫을 컴파일해 적용해도 요청이 나가지 않고 남은 선언은 그대로 먹는다', async ({ browser }) => {
  const compilerCode = await bundleCompiler()

  const control = await openFakeOrigin(browser, null)
  await applySheet(control.page, SOURCE)
  for (const leak of ['cs.png', 'vf.png', 'if.png', 'env.png', 'sh.png']) {
    await expect.poll(() => control.evil().some((u) => u.endsWith(`/${leak}`)), { message: leak }).toBe(true)
  }
  await control.context.close()

  const { context, page, evil } = await openFakeOrigin(browser, compilerCode)
  const compiled = await page.evaluate((source) => {
    const out = window.UserCssCompile.compileUserCss(source)
    const check = new CSSStyleSheet()
    check.replaceSync(out.css)
    return { ...out, checkRuleCount: check.cssRules.length }
  }, SOURCE)
  await applySheet(page, compiled.css)
  await page.waitForTimeout(500)
  expect(evil()).toEqual([])

  expect(compiled.removed.map((r) => r.reason)).not.toContain('unstable')
  expect(compiled.css).not.toBe('')
  expect(compiled.ruleCount).toBe(compiled.checkRuleCount)
  expect(compiled.css).toContain(KEEP)
  const y = await page.locator('.y').evaluate((el) => {
    const style = getComputedStyle(el)
    return { marginLeft: style.marginLeft, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage }
  })
  expect(y).toEqual({ marginLeft: '7px', backgroundColor: 'rgb(255, 0, 0)', backgroundImage: 'none' })
  await context.close()
})
