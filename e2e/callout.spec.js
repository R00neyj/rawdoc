// 콜아웃 종류 아이콘 (specs/features/F-148.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode, tokenAsRgb, rectOf } from './helpers.js'

// 임의의 CSS 색 표기를 canvas 로 읽어 실제 rgba 값을 얻는다 (e2e/topbar.spec.js 와 같은 방식)
async function colorOf(locator, prop) {
  return locator.evaluate((el, p) => {
    const cs = getComputedStyle(el)
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = cs[p]
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: a / 255 }
  }, prop)
}

function rgbOf(rgbString) {
  const [r, g, b] = rgbString.match(/\d+(\.\d+)?/g).map(Number)
  return { r, g, b }
}

async function expectSvgColor(page, svgLocator, tokenName) {
  const [fill, tokenRgb] = await Promise.all([colorOf(svgLocator, 'fill'), tokenAsRgb(page, tokenName)])
  const expected = rgbOf(tokenRgb)
  expect(fill.r).toBeCloseTo(expected.r, 0)
  expect(fill.g).toBeCloseTo(expected.g, 0)
  expect(fill.b).toBeCloseTo(expected.b, 0)
}

// note·info·todo 는 note 색 묶음, DANGER 는 danger 색 묶음, 모르는 이름도 note 색 묶음 (F-128 2.1)
const A2_DOC = `# 문서

> [!note] 노트 제목
> 본문

> [!tip] 팁 제목
> 본문

> [!warning] 경고 제목
> 본문

> [!DANGER] 위험 제목
> 본문

> [!unknown] 모르는 종류
> 본문

> [!info]
> 제목 없음
`

const KINDS = [
  { title: '노트 제목', token: '--callout-note' },
  { title: '팁 제목', token: '--callout-tip' },
  { title: '경고 제목', token: '--callout-warning' },
  { title: '위험 제목', token: '--callout-danger' },
  { title: '모르는 종류', token: '--callout-note' },
]

test.describe('F-148 A2 편집 모드', () => {
  test('머리 줄마다 svg 1개, 18×18, 색 = 콜아웃 색, 모르는 종류는 note 아이콘, [! 없음, 원문 불변', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: A2_DOC })

    // 커서를 콜아웃 밖(맨 앞 제목 줄)에 둔다 — 모든 콜아웃 머리 줄이 비활성 상태
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')

    for (const { title, token } of KINDS) {
      const line = page.locator('.cm-content .cm-line', { hasText: title })
      await expect(line).toHaveCount(1)
      await expect(line).not.toContainText('[!')

      const svg = line.locator('.md-callout-icon svg')
      await expect(svg).toHaveCount(1)
      const box = await svg.boundingBox()
      expect(Math.round(box.width)).toBe(18)
      expect(Math.round(box.height)).toBe(18)

      await expectSvgColor(page, svg, token)
    }

    // 제목 없는 [!info] — 위젯이 기본 제목 글자(Info)를 보여준다
    const infoLine = page.locator('.cm-content .cm-line', { hasText: 'Info' })
    await expect(infoLine).toHaveCount(1)
    await expect(infoLine.locator('.md-callout-icon svg')).toHaveCount(1)
    await expectSvgColor(page, infoLine.locator('.md-callout-icon svg'), '--callout-note')

    // 노트와 모르는 종류(unknown)는 같은 아이콘(edit) — svg 안쪽 마크업이 같다
    const noteSvgHtml = await page.locator('.cm-content .cm-line', { hasText: '노트 제목' }).locator('.md-callout-icon svg').innerHTML()
    const unknownSvgHtml = await page.locator('.cm-content .cm-line', { hasText: '모르는 종류' }).locator('.md-callout-icon svg').innerHTML()
    expect(unknownSvgHtml).toBe(noteSvgHtml)

    // 원문 불변
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toBe(A2_DOC)
  })
})

const A3_DOC = '> [!note] 제목\n> 본문\nx\n'

test.describe('F-148 A3 활성 줄', () => {
  test('커서가 머리 줄에 있으면 [!type] 이 보이고 아이콘이 없다, 나가면 다시 아이콘만', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: A3_DOC })

    const headerLine = page.locator('.cm-line.md-callout-title')

    // 다른 줄('x')에 커서 — 머리 줄은 비활성, 아이콘만
    await page.locator('.cm-content .cm-line', { hasText: 'x' }).click()
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)
    await expect(headerLine).not.toContainText('[!note]')

    // 머리 줄을 클릭 — 활성, 원문 그대로
    await headerLine.click()
    await expect(headerLine).toContainText('[!note]')
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(0)

    // 다시 다른 줄로 — 아이콘으로 복귀
    await page.locator('.cm-content .cm-line', { hasText: 'x' }).click()
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)
  })

  test('편집기 포커스를 해제하면 머리 줄에 커서가 있어도 아이콘만 보인다 (F-146 규칙)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: A3_DOC })

    const headerLine = page.locator('.cm-line.md-callout-title')
    await headerLine.click()
    await expect(headerLine).toContainText('[!note]')

    // 문서 칸 왼쪽 여백을 클릭해 포커스만 없앤다 (e2e/margin.spec.js 와 같은 방식)
    const scrollerRect = await rectOf(page.locator('.cm-scroller'))
    await page.mouse.click(scrollerRect.left + 10, scrollerRect.top + scrollerRect.height / 2)

    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)
    await expect(headerLine).not.toContainText('[!note]')
  })
})

test.describe('F-148 A4 보기 모드·공유 화면', () => {
  test('제목 앞에 아이콘이 보이고 크기·색이 편집 모드와 같다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: A3_DOC })

    await setViewMode(page, 'view')
    const title = page.locator('.viewer .markdown-callout-title')
    const svg = title.locator('.markdown-callout-icon svg')
    await expect(svg).toHaveCount(1)
    let box = await svg.boundingBox()
    expect(Math.round(box.width)).toBe(18)
    expect(Math.round(box.height)).toBe(18)
    await expectSvgColor(page, svg, '--callout-note')

    // 공유 화면도 같은 렌더러 (F-148 3.2)
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const hash = new URL(link).hash
    await page.evaluate((h) => {
      location.hash = h
    }, hash)
    await expect(page.locator('.shared-view')).toBeVisible()

    const sharedSvg = page.locator('.shared-view .markdown-callout-title .markdown-callout-icon svg')
    await expect(sharedSvg).toHaveCount(1)
    box = await sharedSvg.boundingBox()
    expect(Math.round(box.width)).toBe(18)
    expect(Math.round(box.height)).toBe(18)
  })
})

test.describe('F-148 A6 세 테마', () => {
  for (const theme of ['white', 'sepia', 'dark']) {
    test(`${theme} 테마 편집 모드 아이콘 색이 그 테마의 콜아웃 색과 같다`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem('md.theme', t), theme)
      await openApp(page)
      await importMarkdown(page, { content: A3_DOC })

      await page.locator('.cm-content .cm-line', { hasText: 'x' }).click() // 머리 줄 비활성
      const svg = page.locator('.cm-line.md-callout-title .md-callout-icon svg')
      await expect(svg).toHaveCount(1)
      await expectSvgColor(page, svg, '--callout-note')
    })
  }
})
