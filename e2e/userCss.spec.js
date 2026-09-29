// 사용자 CSS 검사·컴파일·적용·탭 (specs/features/F-2094.md 7.5 → F-2095 → F-2096 순서로 이어 쓴다)
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { openApp, setPrefBeforeLoad, currentDocId, fakeImeCompose, fakeImeCommit } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

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

// ── F-2095 적용·부팅·안전 모드 (specs/features/F-2095.md 7.2) ──
const MAIN_JS_PATTERN = /\/assets\/index-[^/]+\.js$/

async function holdMainJs(page) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  await page.route(MAIN_JS_PATTERN, async (route) => {
    await gate
    await route.continue()
  })
  return release
}

// [이름, 원문, 켬] 목록 → md.userCss 값
function userCssValue(rows) {
  const snippets = rows.map(([name, css, enabled], i) => ({
    id: (i + 1).toString(16).padStart(16, '0'),
    name,
    css,
    enabled,
    updatedAt: 1,
  }))
  return JSON.stringify({ snippets })
}

const probeCss = (letter) => `:root:root { --probe-${letter}: 1 }`

async function userCssState(page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const style = getComputedStyle(root)
    const probe = (n) => style.getPropertyValue(`--probe-${n}`).trim()
    return {
      a: probe('a'),
      b: probe('b'),
      c: probe('c'),
      z: probe('z'),
      sheets: document.adoptedStyleSheets.length,
      mode: root.getAttribute('data-user-css'),
      rev: root.getAttribute('data-user-css-rev'),
    }
  })
}

const bootLocalLength = (page) =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('md.userCssBoot') ?? '').local.length
    } catch {
      return null
    }
  })

test('F-2095 A14 첫 칠 전에 부팅 시트가 붙고 앱이 같은 시트를 이어받으며 공개 보기에서는 빠진다', async ({ page }) => {
  await setPrefBeforeLoad(
    page,
    'md.userCss',
    userCssValue([
      ['A', probeCss('a'), true],
      ['B', probeCss('b'), false],
      ['C', probeCss('c'), true],
    ]),
  )
  await openApp(page)
  await expect.poll(() => bootLocalLength(page)).toBe(2)
  const docId = await currentDocId(page)

  const releaseJs = await holdMainJs(page)
  await page.reload({ waitUntil: 'commit' })
  await expect(page.locator('#boot-skeleton')).toBeVisible()
  expect(await page.locator('#root > *').count()).toBe(0)
  expect(await userCssState(page)).toMatchObject({ a: '1', b: '', c: '1', sheets: 2, mode: 'on', rev: '1' })
  await page.evaluate(() => {
    window.heldBootSheets = [...document.adoptedStyleSheets]
  })

  releaseJs()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  const handedOver = await page.evaluate(() => ({
    same: document.adoptedStyleSheets.length === 2 && document.adoptedStyleSheets.every((s, i) => s === window.heldBootSheets[i]),
    handoff: '__userCssBoot' in window,
  }))
  expect(handedOver).toEqual({ same: true, handoff: false })
  expect(await userCssState(page)).toMatchObject({ a: '1', b: '', c: '1', sheets: 2, mode: 'on', rev: '1' })

  await page.route('**/pub/docs/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: '공개 문서', content: '# 공개\n', lineEnding: 'lf', updatedAt: 1_700_000_000_000 }),
    }),
  )
  await page.evaluate(() => {
    location.hash = '#/p/tok123'
  })
  await expect(page.locator('.public-view-title')).toBeVisible()
  expect(await userCssState(page)).toMatchObject({ a: '', c: '', sheets: 0, mode: 'off' })

  await page.goBack()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/d/${docId}`)
  await expect.poll(async () => (await userCssState(page)).a).toBe('1')
  expect(await userCssState(page)).toMatchObject({ c: '1', sheets: 2, mode: 'on' })
})

test('F-2095 A15 ?safe 로 열면 사용자 CSS 없이 열리고 다시 켜기가 주소에서 safe 만 빼고 적용한다', async ({ page }) => {
  await setPrefBeforeLoad(page, 'md.userCss', userCssValue([['A', probeCss('a'), true]]))
  await openApp(page)
  await expect.poll(() => bootLocalLength(page)).toBe(1)
  const docId = await currentDocId(page)
  const readKeys = () => page.evaluate(() => [localStorage.getItem('md.userCss'), localStorage.getItem('md.userCssBoot')])
  const before = await readKeys()

  await page.goto(`/?app=1&safe#/d/${docId}`)
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  const reenable = page.getByRole('button', { name: '다시 켜기' })
  await expect(reenable).toBeVisible()
  expect(await userCssState(page)).toMatchObject({ a: '', sheets: 0, mode: 'safe' })
  expect(await readKeys()).toEqual(before)

  await reenable.click()
  await expect.poll(() => page.evaluate(() => location.search)).toBe('?app=1')
  expect(await page.evaluate(() => location.hash)).toBe(`#/d/${docId}`)
  await expect.poll(async () => (await userCssState(page)).a).toBe('1')
  expect((await userCssState(page)).mode).toBe('on')
})

test('F-2095 A16 다른 탭에서 바꾼 사용자 CSS 는 한글 조합이 끝난 뒤 적용된다', async ({ page }) => {
  // B 가 문서를 쥐고, A 는 같은 출처의 도움말 화면 — 같은 문서를 두 탭이 열면 편집 잠금에 걸린다
  const pageB = page
  await openApp(pageB)
  const pageA = await pageB.context().newPage()
  await pageA.goto('/#/help')
  await expect(pageA.locator('html[data-user-css]')).toHaveCount(1)

  await pageB.bringToFront()
  await pageB.locator('.cm-host .cm-content').click()
  expect(await pageB.evaluate(() => [document.hasFocus(), document.activeElement?.classList.contains('cm-content')])).toEqual([true, true])
  const cdp = await fakeImeCompose(pageB, '한')

  const writeZ = (enabled) =>
    pageA.evaluate((value) => localStorage.setItem('md.userCss', value), userCssValue([['Z', probeCss('z'), enabled]]))
  await writeZ(true)
  await pageB.waitForTimeout(500)
  expect((await userCssState(pageB)).z).toBe('')

  await fakeImeCommit(cdp, '한')
  await expect.poll(async () => (await userCssState(pageB)).z).toBe('1')

  await writeZ(false)
  await expect.poll(async () => (await userCssState(pageB)).z).toBe('')
})

async function openCssTab(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator('dialog[open]').filter({ has: page.locator('#settings-title') })
  await dialog.getByRole('tab', { name: '사용자 CSS' }).click()
  return dialog
}

const probeValue = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

test('F-2096 A10 설정에서 만든 스니펫이 바로 적용되고 다시 읽어도 남으며 끄고 지우면 빠진다', async ({ page }) => {
  await openApp(page)
  let dialog = await openCssTab(page)
  await expect(dialog.getByText('스니펫이 없습니다.')).toBeVisible()
  await dialog.getByRole('button', { name: '새 스니펫' }).click()

  const edit = page.locator('dialog[aria-labelledby="user-css-edit-title"]')
  const content = edit.locator('.cm-content')
  await expect(content).toBeFocused()
  await page.keyboard.insertText(':root:root { --probe-t: 1 }')
  await expect.poll(() => probeValue(page, '--probe-t')).toBe('1')
  const names = await page.evaluate(() => JSON.parse(localStorage.getItem('md.userCss')).snippets.map((s) => s.name))
  expect(names).toEqual(['스니펫 1'])

  await page.keyboard.press('Escape')
  await expect(edit).toHaveCount(0)
  await expect(dialog.locator('.user-css-row').getByRole('button', { name: '편집' })).toBeFocused()

  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  await expect.poll(() => probeValue(page, '--probe-t')).toBe('1')

  dialog = await openCssTab(page)
  await dialog.getByRole('checkbox', { name: '스니펫 1' }).uncheck()
  await expect.poll(() => probeValue(page, '--probe-t')).toBe('')
  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  expect(await probeValue(page, '--probe-t')).toBe('')

  dialog = await openCssTab(page)
  await dialog.locator('.user-css-row').getByRole('button', { name: '삭제' }).click()
  await page.locator('dialog[aria-labelledby="user-css-delete-title"][open]').getByRole('button', { name: '삭제' }).click()
  await expect(dialog.getByText('스니펫이 없습니다.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '새 스니펫' })).toBeFocused()
})

test('F-2096 A11 CSS 편집 중 한글 조합이 끝나기 전에는 저장하지 않고 끝나면 적용한다', async ({ page }) => {
  const seed = userCssValue([['조합', ':root:root { --probe-k: 1 }', true]])
  await setPrefBeforeLoad(page, 'md.userCss', seed)
  await openApp(page)
  const dialog = await openCssTab(page)
  await dialog.locator('.user-css-row').getByRole('button', { name: '편집' }).click()
  const edit = page.locator('dialog[aria-labelledby="user-css-edit-title"]')
  const content = edit.locator('.cm-content')
  await expect(content).toBeFocused()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')

  const cdp = await fakeImeCompose(page, '가')
  await page.waitForTimeout(900)
  expect(await probeValue(page, '--probe-k')).toBe('1')
  expect(await page.evaluate(() => localStorage.getItem('md.userCss'))).toBe(seed)

  await fakeImeCommit(cdp, '가')
  await expect.poll(() => probeValue(page, '--probe-k')).toBe('1가')
})

test('F-2099 A14 첫 로그인 때 로컬 스니펫이 계정에 붙고 다른 기기에서 받으며 끄면 따라간다', async ({ browser }) => {
  const shared = { snippets: [], rev: 0 }
  const seed = userCssValue([['내 색', ':root:root { --probe-m: 1 }', true]])
  const open = async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await fakeServer(page, { userCss: shared })
    await setPrefBeforeLoad(page, 'md.userCss', seed)
    await openApp(page)
    return { context, page }
  }
  const a = await open()
  await expect.poll(() => shared.rev, { timeout: 10_000 }).toBe(1)
  expect(shared.snippets.map((s) => s.name)).toEqual(['내 색'])
  await expect.poll(() => probeValue(a.page, '--probe-m')).toBe('1')

  const b = await open()
  await expect.poll(() => probeValue(b.page, '--probe-m')).toBe('1')
  expect(shared.snippets).toHaveLength(1)
  const dialog = await openCssTab(b.page)
  await expect(dialog.getByText('계정에 저장해 로그인한 기기 모두에 적용합니다.')).toBeVisible()
  await dialog.getByRole('checkbox', { name: '내 색' }).uncheck()
  await expect.poll(() => probeValue(b.page, '--probe-m')).toBe('')
  await expect.poll(() => shared.rev, { timeout: 10_000 }).toBe(2)
  expect(shared.snippets[0].enabled).toBe(false)

  await a.page.reload()
  await expect(a.page.locator('.cm-host .cm-editor')).toBeVisible()
  await expect.poll(() => probeValue(a.page, '--probe-m')).toBe('')
  await a.context.close()
  await b.context.close()
})
