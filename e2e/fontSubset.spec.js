// 서체 나눠 받기와 precache 줄이기 (specs/features/F-2040.md 7장)
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { importMarkdown, openApp, setPrefBeforeLoad, setViewMode } from './helpers.js'

const ZETTEL = readFileSync(new URL('../content/guides/zettelkasten.md', import.meta.url), 'utf-8')

async function precacheUrls(page) {
  const res = await page.request.get('/sw.js')
  expect(res.status()).toBe(200)
  const body = await res.text()
  return { body, urls: [...body.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]) }
}

// 받은 .woff2 응답을 모은다 — 본문 길이는 나중에 한꺼번에 기다린다
function collectFonts(page) {
  const fonts = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.endsWith('.woff2')) return
    fonts.push({ path: url.pathname, size: response.body().then((b) => b.length, () => 0) })
  })
  return fonts
}

async function openZettel(page) {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await openApp(page)
  await importMarkdown(page, { name: 'zettelkasten.md', content: ZETTEL })
  await expect(page.locator('.cm-content')).toContainText('제텔카스텐')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

test('F-2040 A1 precache 에 큰 서체 없음', async ({ page }) => {
  const { urls } = await precacheUrls(page)
  const woff2 = urls.filter((u) => u.endsWith('.woff2'))
  expect(woff2.length).toBeGreaterThan(0)
  for (const u of woff2) expect(u, u).toMatch(/^assets\/KaTeX_/)
  expect(urls.filter((u) => /PretendardVariable|noto-serif-kr|D2Coding/.test(u))).toEqual([])
})

test('F-2040 A2 precache 크기 상한', async ({ page }) => {
  const { urls } = await precacheUrls(page)
  let total = 0
  for (const u of urls) {
    const res = await page.request.get(`/${u}`)
    expect(res.status(), u).toBe(200)
    total += (await res.body()).length
  }
  expect(total).toBeLessThanOrEqual(10_485_760)
})

test('F-2040 A3 서체 런타임 캐시 규칙', async ({ page }) => {
  const { body } = await precacheUrls(page)
  expect(body).toContain('"fonts"')
  expect(body).toContain('CacheFirst')
})

test('F-2040 A4 조각 서체 CSS', async ({ page }) => {
  const html = await (await page.request.get('/')).text()
  const href = /assets\/index-[^"']+\.css/.exec(html)?.[0]
  expect(href).toBeTruthy()
  const css = await (await page.request.get(`/${href}`)).text()
  const faces = css.split('@font-face').slice(1)
  expect(faces.filter((f) => f.includes('PretendardVariable.subset.')).length).toBe(92)
  expect(css).not.toContain('noto-serif-kr-korean-')
  expect(css.match(/url\([^)]*noto-serif-kr-[^)]*\.woff\)/g)).toBeNull()
})

test('F-2040 A5 첫 방문 문서 한 편 서체 양', async ({ page }) => {
  const fonts = collectFonts(page)
  await openZettel(page)

  const sizes = await Promise.all(fonts.map((f) => f.size))
  const total = sizes.reduce((a, b) => a + b, 0)
  const paths = fonts.map((f) => f.path)
  expect(total, paths.join('\n')).toBeLessThanOrEqual(2_400_000)
  expect(paths.filter((p) => p.includes('PretendardVariable.subset.')).length).toBeGreaterThanOrEqual(1)
  expect(paths.filter((p) => /noto-serif-kr-\d+-700/.test(p)).length).toBeGreaterThanOrEqual(1)
  expect(paths.filter((p) => p.includes('PretendardVariable-'))).toEqual([])
  expect(paths.filter((p) => p.includes('noto-serif-kr-korean-'))).toEqual([])
})

test('F-2040 A7 서체가 실제로 적용됨', async ({ page }) => {
  await openZettel(page)
  expect(await page.evaluate(() => document.fonts.check('400 16px "Pretendard Variable"', '제텔카스텐'))).toBe(true)
  expect(await page.evaluate(() => document.fonts.check('700 16px "Noto Serif KR"', '제텔카스텐'))).toBe(true)

  await setViewMode(page, 'raw')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('400 14px D2Coding', '# abc')))
    .toBe(true)
})

test.describe('서비스 워커 허용', () => {
  test.use({ serviceWorkers: 'allow' })

  test('F-2040 A6 오프라인에서 본 글자', async ({ page, context }) => {
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await setPrefBeforeLoad(page, 'md.startScreen', 'last')
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

    await expect(page.locator('.cm-host .cm-editor').or(page.locator('.empty-state'))).toBeVisible()
    await importMarkdown(page, { name: 'zettelkasten.md', content: ZETTEL })
    await expect(page.locator('.cm-content')).toContainText('제텔카스텐')
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await page.waitForLoadState('networkidle')

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open('fonts')
          const keys = await cache.keys()
          return keys.filter((r) => r.url.includes('PretendardVariable.subset.')).length
        }),
      )
      .toBeGreaterThanOrEqual(1)

    await context.setOffline(true)
    await page.reload()
    await expect(page.locator('.cm-content')).toContainText('제텔카스텐')
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const status = await page.evaluate(() => {
      const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Pretendard Variable')
      return {
        error: faces.filter((f) => f.status === 'error').length,
        loaded: faces.filter((f) => f.status === 'loaded').length,
      }
    })
    expect(status.error).toBe(0)
    expect(status.loaded).toBeGreaterThanOrEqual(1)
    await context.setOffline(false)
  })
})
