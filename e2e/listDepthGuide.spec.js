// 중첩 목록 깊이 안내선 (specs/features/F-236.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, readSavedContent } from './helpers.js'

// li 자신의 글머리·번호 기호 ::before 칸의 가로 가운데 (F-236 6장 — 칸은 justify-content:center 라 칸 가운데 = 글자 가운데, F-226 listView.spec.js 와 같은 측정 방법)
async function markerX(li) {
  return li.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el, '::before')
    return rect.left + parseFloat(cs.left) + parseFloat(cs.width) / 2
  })
}

// 중첩 ul/ol 자신에 그려지는 안내선(::before) 의 x·세로 범위·색·두께
async function guideOf(ul) {
  return ul.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el, '::before')
    return {
      x: rect.left + parseFloat(cs.left),
      width: parseFloat(cs.width),
      color: cs.backgroundColor,
      top: rect.top + parseFloat(cs.top || 0),
      bottom: rect.bottom - Math.abs(parseFloat(cs.bottom || 0)),
    }
  })
}

async function mutedRgb(page) {
  return page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--md-border-muted)'
    document.body.appendChild(probe)
    const rgb = getComputedStyle(probe).color
    probe.remove()
    return rgb
  })
}

test.describe('F-236 A1 보기 모드 2단계', () => {
  test('2단계 항목의 부모 목록에 1단계 조상 안내선 1개', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나\n' })
    await setViewMode(page, 'view')

    const items = page.locator('.markdown-body li')
    const nestedUl = page.locator('.markdown-body li ul').first()

    const [markerGa, guide, muted] = await Promise.all([markerX(items.first()), guideOf(nestedUl), mutedRgb(page)])
    expect(Math.abs(guide.x - markerGa)).toBeLessThanOrEqual(2)
    expect(guide.width).toBeCloseTo(1, 0)
    expect(guide.color).toBe(muted)
  })
})

test.describe('F-236 A2 보기 모드 3단계', () => {
  test('3단계 항목 왼쪽에 안내선 2개, 각각 조상 기호 x', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나\n    - 다\n' })
    await setViewMode(page, 'view')

    const items = page.locator('.markdown-body li')
    const uls = page.locator('.markdown-body li ul')
    await expect(uls).toHaveCount(2) // "나" 담은 ul(depth2), "다" 담은 ul(depth3)

    const markerGa = await markerX(items.nth(0))
    const markerNa = await markerX(items.nth(1))
    const guideDepth2 = await guideOf(uls.nth(0)) // 가 밑 ul — 1단계(가) 조상 안내선
    const guideDepth3 = await guideOf(uls.nth(1)) // 나 밑 ul — 2단계(나) 조상 안내선

    expect(Math.abs(guideDepth2.x - markerGa)).toBeLessThanOrEqual(2)
    expect(Math.abs(guideDepth3.x - markerNa)).toBeLessThanOrEqual(2)
  })
})

test.describe('F-236 A3 보기 모드 세로 범위', () => {
  test('안내선은 2단계 목록 마지막 항목까지만, 뒤 1단계 형제까지 새지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나1\n  - 나2\n- 다\n' })
    await setViewMode(page, 'view')

    const items = page.locator('.markdown-body li')
    const nestedUl = page.locator('.markdown-body li ul').first()

    const guide = await guideOf(nestedUl)
    const na1Top = await items.nth(1).evaluate((el) => el.getBoundingClientRect().top)
    const na2Bottom = await items.nth(2).evaluate((el) => el.getBoundingClientRect().bottom)
    const daTop = await items.nth(3).evaluate((el) => el.getBoundingClientRect().top)

    expect(guide.top).toBeLessThanOrEqual(na1Top + 1)
    expect(guide.bottom).toBeGreaterThanOrEqual(na2Bottom - 1)
    expect(guide.bottom).toBeLessThanOrEqual(daTop + 1)
  })
})

test.describe('F-236 A4 보기 모드 순서 목록', () => {
  test('ul 과 같은 규칙으로 안내선', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '1. 가\n   1. 나\n' })
    await setViewMode(page, 'view')

    const items = page.locator('.markdown-body li')
    const nestedOl = page.locator('.markdown-body li ol').first()

    const markerGa = await markerX(items.first())
    const guide = await guideOf(nestedOl)
    expect(Math.abs(guide.x - markerGa)).toBeLessThanOrEqual(2)
  })
})

// 편집 모드(라이브) — 조상 기호 x 와 ±4px (F-152 A5 와 같은 오차 기준)
async function editGuideLine(page, textFragment) {
  return page.evaluate((frag) => {
    const lines = [...document.querySelectorAll('.cm-line')]
    const line = lines.find((l) => l.textContent.trim().endsWith(frag))
    const cs = getComputedStyle(line)
    const bg = cs.backgroundImage
    const pos = cs.backgroundPositionX.split(',').map((v) => parseFloat(v))
    const rect = line.getBoundingClientRect()
    return { hasBg: bg !== 'none', count: bg === 'none' ? 0 : bg.split('gradient').length - 1, xs: pos.map((p) => rect.left + p) }
  }, textFragment)
}

// .md-bullet·.md-list-marker 칸의 가로 가운데 (F-236 6장, 칸은 min-width:2em + justify-content:center)
async function editMarkerX(page, textFragment) {
  return page.evaluate((frag) => {
    const lines = [...document.querySelectorAll('.cm-line')]
    const line = lines.find((l) => l.textContent.trim().endsWith(frag))
    const mark = line.querySelector('.md-bullet, .md-list-marker')
    const rect = mark.getBoundingClientRect()
    return rect.left + rect.width / 2
  }, textFragment)
}

test.describe('F-236 A5 편집 모드 2·3단계', () => {
  test('보기 모드와 같은 단계 수 안내선, 조상 기호 x 와 ±4px', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나\n    - 다\n' })
    await page.keyboard.press('Control+End')
    await setViewMode(page, 'live')

    const markerGa = await editMarkerX(page, '가')
    const markerNa = await editMarkerX(page, '나')
    const guideNa = await editGuideLine(page, '나') // 2단계(나) 줄 — 안내선 1개(1단계 조상)
    const guideDa = await editGuideLine(page, '다') // 3단계(다) 줄 — 안내선 2개(1·2단계 조상)

    expect(guideNa.count).toBe(1)
    expect(Math.abs(guideNa.xs[0] - markerGa)).toBeLessThanOrEqual(4)

    expect(guideDa.count).toBe(2)
    expect(Math.abs(guideDa.xs[0] - markerGa)).toBeLessThanOrEqual(4)
    expect(Math.abs(guideDa.xs[1] - markerNa)).toBeLessThanOrEqual(4)
  })
})

test.describe('F-236 A6 편집 모드 원문 모드', () => {
  test('원문 모드에서는 안내선이 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나\n    - 다\n' })
    await setViewMode(page, 'raw')

    const noGuide = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('.cm-line')]
      return lines.every((l) => getComputedStyle(l).backgroundImage === 'none')
    })
    expect(noGuide).toBe(true)
  })
})

test.describe('F-236 A7 원문 불변', () => {
  test('목록 줄 끝에 입력하면 원문이 입력한 글자만큼만 바뀐다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '- 가\n  - 나\n' })
    await setViewMode(page, 'live')
    await page.locator('.cm-line').filter({ hasText: '나' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('- 가\n  - 나!\n')
  })
})

// 6장 후속 — 안내선을 조상 기호 왼쪽이 아닌 가로 가운데로 (2026-09-18)
test.describe('F-236 A10 보기 모드 가운데 — ul', () => {
  test('안내선 x 가 1단계 • 기호의 가로 가운데 ±2px', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나\n' })
    await setViewMode(page, 'view')

    const items = page.locator('.markdown-body li')
    const nestedUl = page.locator('.markdown-body li ul').first()
    const [markerGa, guide] = await Promise.all([markerX(items.first()), guideOf(nestedUl)])
    expect(Math.abs(guide.x - markerGa)).toBeLessThanOrEqual(2)
  })
})

test.describe('F-236 A11 보기 모드 가운데 — ol', () => {
  test('안내선 x 가 1단계 1. 의 가로 가운데 ±2px', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '1. 가\n   1. 나\n' })
    await setViewMode(page, 'view')

    const items = page.locator('.markdown-body li')
    const nestedOl = page.locator('.markdown-body li ol').first()
    const [markerGa, guide] = await Promise.all([markerX(items.first()), guideOf(nestedOl)])
    expect(Math.abs(guide.x - markerGa)).toBeLessThanOrEqual(2)
  })
})

test.describe('F-236 A12 편집 모드 가운데', () => {
  test('보기 모드와 같은 x, ±4px', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나\n' })
    await page.keyboard.press('Control+End')
    await setViewMode(page, 'live')

    const markerGa = await editMarkerX(page, '가')
    const guideNa = await editGuideLine(page, '나')
    expect(guideNa.count).toBe(1)
    expect(Math.abs(guideNa.xs[0] - markerGa)).toBeLessThanOrEqual(4)
  })
})
