// 보기 모드 전환 스크롤 위치 유지 (specs/features/F-295.md 10장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, resizeWindow } from './helpers.js'

// `## 제목 N` + 빈 줄 + `본문 N …` 을 N = 0…n-1 로 이어 붙인 것 (F-295.md 10.1)
function sectionsDoc(n) {
  const parts = []
  for (let i = 0; i < n; i++) {
    parts.push(`## 제목 ${i}`)
    parts.push(`본문 ${i} `.repeat(20))
  }
  return parts.join('\n\n') + '\n'
}

// 제목 없이 `본문 N …` 만 n 개 (A5 — 맞출 근거가 제목뿐이면 실패해야 하는 경우)
function noHeadingDoc(n) {
  const parts = []
  for (let i = 0; i < n; i++) parts.push(`본문 ${i} `.repeat(20))
  return parts.join('\n\n') + '\n'
}

// 화면 위 끝을 지나거나 그 아래인 요소들 중 글자가 있는 첫 요소에서 구역 번호를 뽑는다 — 편집 모드는 문단 사이 빈 줄이 섞여 있어 건너뛴다 (10.1)
async function topSection(page, where) {
  const text = await page.evaluate((w) => {
    const root =
      w === 'view'
        ? document.querySelector('.content-area .viewer')
        : document.querySelector('.cm-scroller')
    if (!root) return null
    const rootTop = root.getBoundingClientRect().top
    const els =
      w === 'view'
        ? root.querySelectorAll('.markdown-body > *')
        : root.querySelectorAll('.cm-line')
    const visible = [...els].filter((el) => el.getBoundingClientRect().bottom > rootTop)
    for (const el of visible) {
      const t = el.textContent || ''
      if (/제목 \d+|본문 \d+/.test(t)) return t
    }
    return visible.length ? visible[0].textContent : null
  }, where)
  const m = /제목 (\d+)|본문 (\d+)/.exec(text || '')
  if (!m) return null
  return Number(m[1] ?? m[2])
}

// .viewer 는 scroll-behavior: smooth 라 scrollTop 대입은 애니메이션이 된다 — scrollTo({behavior:'instant'})로 즉시 반영한다 (F-295.md 3.3)
async function scrollTo(page, where, ratio) {
  const sel = where === 'view' ? '.content-area .viewer' : '.cm-scroller'
  await page.locator(sel).evaluate((el, r) => {
    el.scrollTo({ top: el.scrollHeight * r, behavior: 'instant' })
  }, ratio)
}

test.describe('F-295 A1 편집 → 보기', () => {
  test('전환 전 편집 화면 맨 위 구역이 보기 화면 맨 위에도 온다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: sectionsDoc(400) })
    await scrollTo(page, 'live', 0.4)
    const before = await topSection(page, 'live')
    expect(before).not.toBeNull()

    await setViewMode(page, 'view')
    await expect(page.locator('.content-area .viewer')).toBeVisible()

    await expect
      .poll(async () => {
        const after = await topSection(page, 'view')
        return after === null ? null : Math.abs(after - before)
      })
      .toBeLessThanOrEqual(1)

    const viewerScrollTop = await page.locator('.content-area .viewer').evaluate((el) => el.scrollTop)
    expect(viewerScrollTop).toBeGreaterThan(0)
  })
})

test.describe('F-295 A2 보기 → 편집', () => {
  test('보기 화면 맨 위 구역이 편집 화면 맨 위에도 온다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: sectionsDoc(400) })
    await scrollTo(page, 'live', 0.4)
    await setViewMode(page, 'view')
    await expect(page.locator('.content-area .viewer')).toBeVisible()

    await scrollTo(page, 'view', 0.7)
    const before = await topSection(page, 'view')
    expect(before).not.toBeNull()

    await setViewMode(page, 'live')
    await expect(page.locator('.cm-scroller')).toBeVisible()

    await expect
      .poll(async () => {
        const after = await topSection(page, 'live')
        return after === null ? null : Math.abs(after - before)
      })
      .toBeLessThanOrEqual(1)
  })
})

test.describe('F-295 A3 왕복 (버그 재현)', () => {
  test('편집 → 보기 → 편집, 처음 위치로 되돌아온다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: sectionsDoc(400) })
    await scrollTo(page, 'live', 0.4)
    const before = await topSection(page, 'live')
    expect(before).not.toBeNull()

    await setViewMode(page, 'view')
    await expect(page.locator('.content-area .viewer')).toBeVisible()
    await setViewMode(page, 'live')
    await expect(page.locator('.cm-scroller')).toBeVisible()

    await expect
      .poll(async () => {
        const after = await topSection(page, 'live')
        return after === null ? null : Math.abs(after - before)
      })
      .toBeLessThanOrEqual(1)
  })
})

test.describe('F-295 A4 맨 위', () => {
  test('스크롤 없이 보기 → 편집, 양쪽 다 0번 구역', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: sectionsDoc(400) })

    await setViewMode(page, 'view')
    const viewer = page.locator('.content-area .viewer')
    await expect(viewer).toBeVisible()
    expect(await topSection(page, 'view')).toBe(0)
    expect(await viewer.evaluate((el) => el.scrollTop)).toBe(0)

    await setViewMode(page, 'live')
    await expect(page.locator('.cm-scroller')).toBeVisible()
    await expect.poll(() => topSection(page, 'live')).toBe(0)
  })
})

test.describe('F-295 A5 제목 없는 문서', () => {
  test('제목이 없어도 최상위 블록으로 맞춘다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: noHeadingDoc(400) })
    await scrollTo(page, 'live', 0.4)
    const before = await topSection(page, 'live')
    expect(before).not.toBeNull()

    await setViewMode(page, 'view')
    await expect(page.locator('.content-area .viewer')).toBeVisible()

    await expect
      .poll(async () => {
        const after = await topSection(page, 'view')
        return after === null ? null : Math.abs(after - before)
      })
      .toBeLessThanOrEqual(1)
  })
})

test.describe('F-295 A6 원문 경로 회귀', () => {
  test('편집 → 원문 → 편집, 처음 위치로 되돌아온다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: sectionsDoc(400) })
    await scrollTo(page, 'live', 0.4)
    const before = await topSection(page, 'live')
    expect(before).not.toBeNull()

    await setViewMode(page, 'raw')
    await setViewMode(page, 'live')

    await expect
      .poll(async () => {
        const after = await topSection(page, 'live')
        return after === null ? null : Math.abs(after - before)
      })
      .toBeLessThanOrEqual(1)
  })
})

test.describe('F-295 A7 문서를 바꾸면 버린다', () => {
  test('보기에서 다른 문서로 옮기면 새 문서는 맨 위에서 시작한다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { name: 'b.md', content: sectionsDoc(50) })
    await importMarkdown(page, { name: 'a.md', content: sectionsDoc(400) })
    await scrollTo(page, 'live', 0.4)
    await setViewMode(page, 'view')
    await expect(page.locator('.content-area .viewer')).toBeVisible()

    // 문서 라벨이 F-296 으로 link 역할이 됐다 — 폴더는 button 그대로라 둘 다 받는다
    const sidebar = page.locator('.sidebar')
    await sidebar.getByRole('button', { name: 'b', exact: true }).or(sidebar.getByRole('link', { name: 'b', exact: true })).click()
    await setViewMode(page, 'live')
    await expect(page.locator('.cm-scroller')).toBeVisible()

    await expect.poll(() => topSection(page, 'live')).toBe(0)
  })
})

test.describe('F-295 A8 숨김 중 설정 변경', () => {
  test('보기 화면에서 줄 번호 설정을 바꿔도 편집 복귀 위치가 유지된다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: sectionsDoc(400) })
    await scrollTo(page, 'live', 0.4)
    const before = await topSection(page, 'live')
    expect(before).not.toBeNull()

    await setViewMode(page, 'view')
    await expect(page.locator('.content-area .viewer')).toBeVisible()

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.locator('dialog[aria-labelledby="settings-title"]').getByRole('tab', { name: '편집기' }).click()
    await page
      .locator('#line-numbers-label')
      .locator('..')
      .getByRole('radio', { name: '숨김', exact: true })
      .click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    await setViewMode(page, 'live')
    await expect(page.locator('.cm-scroller')).toBeVisible()

    await expect
      .poll(async () => {
        const after = await topSection(page, 'live')
        return after === null ? null : Math.abs(after - before)
      })
      .toBeLessThanOrEqual(1)
  })
})

test.describe('F-295 A9 목차 회귀 (F-144)', () => {
  test('보기 모드에서 목차 항목을 클릭하면 그 제목이 보인다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: sectionsDoc(400) })
    await setViewMode(page, 'view')
    await expect(page.locator('.content-area .viewer')).toBeVisible()

    const nav = page.locator('nav.outline')
    await nav.hover()
    const targetItem = page.locator('.outline-item', { hasText: /^제목 300$/ })
    await targetItem.click()

    const heading = page.locator('[data-source-line]').getByText('제목 300', { exact: true }).first()
    await expect(heading).toBeVisible()
  })
})
